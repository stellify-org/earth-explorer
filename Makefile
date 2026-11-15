SHELL := /bin/bash
WEB_PORT ?= 8080
URL ?= http://localhost:$(WEB_PORT)/
PY := science/.venv/bin/python
GRID_VARS ?= t2m precip u10m v10m soilwet qv2m rh2m

.DEFAULT_GOAL := help
.PHONY: help up down restart logs ps deploy install api web build test test-backend test-frontend test-science smoke e2e venv data grids sync-grids warm clean

help:
	@echo "make up             build and start the app in Docker on port $(WEB_PORT)"
	@echo "make down           stop the Docker stack"
	@echo "make logs           follow container logs"
	@echo "make deploy         server deployment with a health check (scripts/deploy.sh)"
	@echo "make install        install frontend dependencies"
	@echo "make api            run the Go API on :8787 without Docker"
	@echo "make web            run the Vite dev server on :5173 (proxies /api to :8787)"
	@echo "make build          production build of the frontend"
	@echo "make test           backend and frontend tests"
	@echo "make test-science   Python reference tests"
	@echo "make smoke          live check against a running API"
	@echo "make e2e            Playwright regression against URL=$(URL)"
	@echo "make data           fetch CRUST1.0 and the numeric grids, then verify (scripts/fetch-data.sh)"
	@echo "make grids          ingest numeric grids into data/grids (GRID_VARS=...)"
	@echo "make sync-grids     copy data/grids to a server (DEST=user@host:/path)"
	@echo "make warm           fill the API cache of a running installation"
	@echo "make clean          remove build output"

up:
	mkdir -p data/grids
	WEB_PORT=$(WEB_PORT) docker compose up --build -d
	@echo "http://localhost:$(WEB_PORT)"

down:
	docker compose down

restart: down up

logs:
	docker compose logs -f --tail=100

ps:
	docker compose ps

deploy:
	WEB_PORT=$(WEB_PORT) ./scripts/deploy.sh

install:
	cd frontend && npm ci

api:
	cd backend && go run ./cmd/server

web: frontend/node_modules
	cd frontend && npm run dev

frontend/node_modules:
	cd frontend && npm ci

build: frontend/node_modules
	cd frontend && npm run build

test: test-backend test-frontend

test-backend:
	cd backend && go vet ./... && go test ./...

test-frontend: frontend/node_modules
	cd frontend && npm run typecheck && npm test

venv: $(PY)

$(PY):
	python3 -m venv science/.venv
	science/.venv/bin/pip install -r science/requirements.txt

test-science: venv
	$(PY) -I -m pytest science/tests -q

smoke:
	tests/smoke.sh

e2e:
	node tests/e2e/mode-switch.mjs $(URL)

data:
	WEB_PORT=$(WEB_PORT) GRID_VARS="$(GRID_VARS)" ./scripts/fetch-data.sh

grids: venv
	$(PY) -I science/vis/build_grids.py data/grids $(GRID_VARS)

sync-grids:
	./scripts/sync-grids.sh $(DEST)

warm:
	WEB_PORT=$(WEB_PORT) ./scripts/warm-cache.sh

clean:
	rm -rf frontend/dist frontend/tsconfig.tsbuildinfo backend/bin
