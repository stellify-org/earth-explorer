# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/earth-explorer-api ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache ca-certificates wget && adduser -D -u 10001 app && mkdir -p /data/cache /data/grids && chown -R app:app /data
COPY --from=build /out/earth-explorer-api /usr/local/bin/earth-explorer-api
USER app
ENV PORT=8787 CACHE_DIR=/data/cache
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8787/api/v1/health >/dev/null || exit 1
ENTRYPOINT ["earth-explorer-api"]
