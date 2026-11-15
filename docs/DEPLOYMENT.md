# Deployment

Earth Explorer runs as two containers defined in `docker-compose.yml`, plus a one-off `grids` container
that downloads the numeric grids on every `docker compose up` and exits:

| Service | Image built from | Role | Memory limit |
|---|---|---|---|
| `api` | `backend/` | Go API on port 8787 inside the Compose network | 256 MB |
| `web` | `frontend/` | Caddy: static SPA with precompressed Brotli/gzip, reverse proxy for `/api` | 128 MB |

Only `web` publishes a port. No credentials or secrets are needed: NASA POWER, NASA GIBS, NASA EONET and
USGS ComCat are open services. The API needs outbound HTTPS to them.

## Requirements

- Docker Engine with the Compose plugin (`docker compose version`).
- `curl` for the health check in `scripts/deploy.sh`.
- Outbound HTTPS to AWS S3 (`us-west-2`) and HTTP to `igppweb.ucsd.edu` for the data download, and about
  1 GB of free disk space for the grids.
- About 2 GB of free memory during the image build (the frontend build is the heavy step).

## Deploy

```bash
git clone https://github.com/stellify-org/earth-explorer.git
cd earth-explorer
./scripts/deploy.sh
```

The script builds the images, starts the stack in the background and waits until
`http://localhost:$WEB_PORT/api/v1/health` answers. It exits with a non-zero code and prints the
container logs if the health check does not pass within two minutes. Then it verifies the data
(`scripts/fetch-data.sh verify`).

The data that is not in the repository is downloaded by Docker itself, so `docker compose up -d --build`
is enough (see [Data and volumes](#data-and-volumes)). `docker compose restart` does not build images or
run the `grids` container and therefore downloads nothing.

To update a running installation, pull the new revision and run the script (or `docker compose up -d
--build`) again. Data that is already in place is not downloaded again.

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

Neither the grids nor CRUST1.0 are in the repository, and no credentials are needed to get them.
`docker compose up -d --build` downloads both:

- **Numeric grids.** The `grids` service (`science/vis/Dockerfile`) runs `science/vis/build_grids.py`
  into `./data/grids` and exits; `api` starts after it has finished. Months already written are skipped,
  so the first start downloads everything and later starts only add new months (about half a minute).
  If the download fails and there are no grids yet, the container exits with a non-zero code and `api`
  is not started; run `docker compose up -d` again to resume. If it fails while grids from an earlier
  run are present, it prints a warning and the stack starts with the existing data.
  `docker compose logs grids` shows the progress. `GRID_VARS` selects the variables
  (default `t2m precip u10m v10m soilwet qv2m rh2m`).
- **CRUST1.0.** A stage of `frontend/Dockerfile` runs `science/geo/build_crust1.py`, which downloads the
  archive from the authors' site, checks its SHA-256 and writes `crust1.bin` (4 665 600 bytes) and
  `meta.json` into the `web` image. The layer is cached, so the archive is downloaded once per build cache.

Check the result with `scripts/fetch-data.sh verify`: it tests `/api/v1/health`, the number of packs in
`/api/v1/packs` (`PACKS_EXPECTED`, default 15) and the size of `/crust1/crust1.bin`.

For a run without Docker, `make data` (`scripts/fetch-data.sh`) downloads the same data on the host into
`frontend/public/crust1` and `data/grids`; it needs Python 3.12 or newer.

Numeric grids: 7 variables, 883 MB, 3850 files, monthly from 1981-01, from the NASA POWER archive on the
Registry of Open Data on AWS (anonymous access). They are runtime data mounted into `api`, not part of
an image. Without them the application works, but the Scientific visualization panel lists no variables
and `/api/v1/packs` is empty. The first `/api/v1/packs` request after a restart reads the manifests and
can take tens of seconds.

The CRUST1.0 model has no explicit redistribution licence, so every installation downloads it from the
authors' site. Do not commit it and do not push the `web` image to a public registry.

When the server has a poor link to AWS, build the grids on another machine and copy them:
`make sync-grids DEST=user@host:/path/to/earth-explorer`. The copy is resumable; `BWLIMIT=500` caps it at
500 KiB/s. Restart the API afterwards (`docker compose restart api`). The `grids` container then finds the
months in place and downloads nothing.

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
