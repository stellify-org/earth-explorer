# syntax=docker/dockerfile:1
FROM python:3.12-alpine AS crust
COPY --from=science-geo build_crust1.py /repo/science/geo/build_crust1.py
RUN python -I /repo/science/geo/build_crust1.py

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
COPY --from=crust /repo/frontend/public/crust1 ./public/crust1
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
