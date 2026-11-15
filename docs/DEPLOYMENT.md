# Deployment

Earth Explorer runs as two containers defined in `docker-compose.yml`:

| Service | Image built from | Role | Memory limit |
|---|---|---|---|
| `api` | `backend/` | Go API on port 8787 inside the Compose network | 256 MB |
| `web` | `frontend/` | Caddy: static SPA with precompressed Brotli/gzip, reverse proxy for `/api` | 128 MB |

Only `web` publishes a port. No credentials or secrets are needed: NASA POWER, NASA GIBS, NASA EONET and
USGS ComCat are open services. The API needs outbound HTTPS to them.

## Requirements

- Docker Engine with the Compose plugin (`docker compose version`).
- `curl` for the health check in `scripts/deploy.sh`.
- Python 3.12 or newer with the `venv` module for the data download. Without it `scripts/fetch-data.sh`
  runs the same steps in a one-off `python:3.12-slim` container.
- Outbound HTTPS to AWS S3 (`us-west-2`) and HTTP to `igppweb.ucsd.edu` for the data download, and about
  2 GB of free disk space (grids 883 MB, Python environment about 700 MB).
- About 2 GB of free memory during the image build (the frontend build is the heavy step).

## Deploy

```bash
git clone https://github.com/stellify-org/earth-explorer.git
cd earth-explorer
./scripts/deploy.sh
```

The script downloads CRUST1.0, builds both images, starts the stack in the background and waits until
`http://localhost:$WEB_PORT/api/v1/health` answers. It exits with a non-zero code and prints the
container logs if the health check does not pass within two minutes. Then it downloads the numeric
grids, restarts the API and verifies the installation (see [Data and volumes](#data-and-volumes)).
The application is already reachable while the grids are downloading.

To update a running installation, pull the new revision and run the script again. Data that is already
in place is not downloaded again.

## Configuration

Set variables in the environment or in a `.env` file next to `docker-compose.yml` (see `.env.example`).

| Variable | Default | Meaning |
|---|---|---|
| `WEB_PORT` | `8088` | Host port published by the `web` container |
| `LOG_LEVEL` | `info` | API log level |

Example: `WEB_PORT=80 ./scripts/deploy.sh`.

## TLS and a public domain

The `web` container serves plain HTTP on the published port. Put it behind the existing reverse proxy or
load balancer that terminates TLS and forward all paths to `WEB_PORT`. The service worker and offline
mode work only on HTTPS (or `localhost`), so a public installation needs TLS.

## Data and volumes

| Path | Kind | Content |
|---|---|---|
| `api-cache` | named volume, `/data/cache` in `api` | Cached upstream API responses; safe to delete, it is refilled on demand |
| `./data/grids` | bind mount, read-only, `/data/grids` in `api` | Optional numeric grids for the Scientific visualization panel |

| `frontend/public/crust1` | static files baked into the `web` image | CRUST1.0 crust model for the X-Ray Earth mode |

Neither the grids nor CRUST1.0 are in the repository. `scripts/fetch-data.sh` downloads both; no
credentials are needed. `scripts/deploy.sh` calls it, and it can be run on its own:

```bash
make data
```

| Step | What it does |
|---|---|
| `scripts/fetch-data.sh crust` | Runs `science/geo/build_crust1.py`: downloads the archive from the authors' site, checks its SHA-256 and writes `crust1.bin` (4 665 600 bytes) and `meta.json`. Skipped when the files are in place |
| `scripts/fetch-data.sh grids` | Creates `science/.venv` when needed and runs `science/vis/build_grids.py` for `GRID_VARS`. Months already written are skipped, so only new months are downloaded. The output is also written to `data/fetch-grids.log` |
| `scripts/fetch-data.sh verify` | Checks `/api/v1/health`, the number of packs in `/api/v1/packs` and the size of `/crust1/crust1.bin` |
| `scripts/fetch-data.sh` | All of the above. Between the download and the verification it rebuilds `web` if the running image has no CRUST1.0 and restarts `api` if it does not list the expected packs |

The script exits with a non-zero code when a step fails; run it again to resume. It can run on a schedule
to pick up new months.

| Variable | Default | Meaning |
|---|---|---|
| `GRID_VARS` | `t2m precip u10m v10m soilwet qv2m rh2m` | Grid variables to download |
| `PACKS_EXPECTED` | `15` | Number of packs `/api/v1/packs` must list; change it together with `GRID_VARS` |
| `PY_IMAGE` | `python:3.12-slim` | Image used when the host has no Python 3.12 |

Numeric grids: 7 variables, 883 MB, 3850 files, monthly from 1981-01, from the NASA POWER archive on the
Registry of Open Data on AWS (anonymous access). They are runtime data mounted into `api`, not part of
an image. Without them the application works, but the Scientific visualization panel lists no variables
and `/api/v1/packs` is empty. The first `/api/v1/packs` request after a restart reads the manifests and
can take tens of seconds.

CRUST1.0 is static frontend content: it has to be in `frontend/public/crust1` before `docker compose
build web`. The model has no explicit redistribution licence, so every installation downloads it from
the authors' site. Do not commit it and do not push the `web` image to a public registry.

When the server has a poor link to AWS, build the grids on another machine and copy them:
`make sync-grids DEST=user@host:/path/to/earth-explorer`. The copy is resumable; `BWLIMIT=500` caps it at
500 KiB/s. Restart the API afterwards (`docker compose restart api`).

## Warming the cache

The first request for a point goes server → NASA POWER and can take many seconds. After a deploy run

```bash
make warm
```

It calls the catalogue routes, `/events`, `/packs` and `/trends` for a list of points
(Dushanbe, Khujand, Bokhtar, Khorog, Tashkent, Almaty, Bishkek) and the variables `t2m` and `precip`.
Override them with `WARM_POINTS="lat,lon lat,lon"` and `WARM_VARS="t2m precip rh2m"`. The responses
stay in the `api-cache` volume (POWER: 7 days), so they survive container restarts. `data/cache` of a
development machine is not copied to the server: cache age is taken from file time.

## Operations

```bash
docker compose ps
docker compose logs -f --tail=100
docker compose restart api
docker compose down
```

Health endpoint: `GET /api/v1/health`. The `web` container starts only after `api` reports healthy.

## Local run

`make help` lists the commands for a local start with or without Docker.
