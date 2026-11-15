# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/earth-explorer-api ./cmd/server

FROM python:3.12-slim AS grids
RUN pip install --no-cache-dir "numpy>=2.5" "xarray>=2025" "zarr>=3" "s3fs>=2025"
COPY --from=science-vis build_grids.py fetch-grids.sh /app/
ARG GRID_VARS="t2m precip u10m v10m soilwet qv2m rh2m"
ARG GRIDS_REFRESH=
RUN --mount=type=cache,target=/grids-store,sharing=locked /app/fetch-grids.sh /grids-store /grids

FROM alpine:3.22
RUN apk add --no-cache ca-certificates wget && adduser -D -u 10001 app && mkdir -p /data/cache /data/grids && chown -R app:app /data
COPY --from=build /out/earth-explorer-api /usr/local/bin/earth-explorer-api
COPY --from=grids /grids /data/grids
USER app
ENV PORT=8787 CACHE_DIR=/data/cache
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8787/api/v1/health >/dev/null || exit 1
ENTRYPOINT ["earth-explorer-api"]
