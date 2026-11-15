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
- About 2 GB of free memory during the image build (the frontend build is the heavy step).

## Deploy

```bash
git clone https://github.com/stellify-org/earth-explorer.git
cd earth-explorer
./scripts/deploy.sh
```

The script builds both images, starts the stack in the background and waits until
`http://localhost:$WEB_PORT/api/v1/health` answers. It exits with a non-zero code and prints the
container logs if the health check does not pass within two minutes.

To update a running installation, pull the new revision and run the script again.

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

Without `data/grids` the application works, but the Scientific visualization panel lists no variables.
Build the grids once on any machine with Python 3.12 or newer and copy the directory to the server:

```bash
make grids
```

This takes about 7 minutes and 150 MB of disk space per variable.

The grids are not in the repository (they are large and reproducible). Two ways to get them onto the server:

- build them there with `make grids`, when the server has a better link to NASA than your machine;
- copy a local build: `make sync-grids DEST=user@host:/path/to/earth-explorer`. The copy is resumable;
  `BWLIMIT=500` caps it at 500 KiB/s. Restart the API afterwards (`docker compose restart api`).

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
