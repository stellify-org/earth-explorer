package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/api"
	"github.com/stellify/earth-explorer/backend/internal/cache"
	"github.com/stellify/earth-explorer/backend/internal/events"
	"github.com/stellify/earth-explorer/backend/internal/evidence"
	"github.com/stellify/earth-explorer/backend/internal/fetch"
	"github.com/stellify/earth-explorer/backend/internal/gibs"
	"github.com/stellify/earth-explorer/backend/internal/httpx"
	"github.com/stellify/earth-explorer/backend/internal/power"
	"github.com/stellify/earth-explorer/backend/internal/quakes"
	"github.com/stellify/earth-explorer/backend/internal/visgrid"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	level := slog.LevelInfo
	if strings.EqualFold(env("LOG_LEVEL", "info"), "debug") {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	cacheDir := env("CACHE_DIR", filepath.Join("..", "data", "cache"))
	addr := ":" + env("PORT", "8787")

	now := time.Now
	srv := &api.Server{
		Log: log, Started: now(), Now: now,
		PackCacheDir: filepath.Join(cacheDir, "packs"),
		Power: &power.Client{
			Base: env("POWER_BASE_URL", power.DefaultBase),
			HTTP: fetch.New("NASA POWER", 45*time.Second, log),

			Cache: cache.New(500, 7*24*time.Hour, filepath.Join(cacheDir, "power")),
			Now:   now,
		},
		GIBS: &gibs.Service{
			URL:   env("GIBS_CAPABILITIES_URL", gibs.CapabilitiesURL),
			HTTP:  fetch.New("NASA GIBS", 60*time.Second, log),
			Cache: cache.New(2000, 6*time.Hour, filepath.Join(cacheDir, "gibs")),
			Log:   log,
		},

		Vis: visgrid.NewStore(env("GRIDS_DIR", filepath.Join("..", "data", "grids")), 48),
		Quakes: &quakes.Client{
			Base:  env("USGS_BASE_URL", quakes.DefaultBase),
			HTTP:  fetch.New("USGS ComCat", 45*time.Second, log),
			Cache: cache.New(200, 10*time.Minute, filepath.Join(cacheDir, "quakes")),
			Now:   now,
		},

		Events: &events.Client{
			Base:  env("EONET_BASE_URL", events.DefaultBase),
			HTTP:  fetch.New("NASA EONET", 75*time.Second, log),
			Cache: cache.New(100, 30*time.Minute, filepath.Join(cacheDir, "events")),
			Now:   now,
		},

		Evidence: &evidence.Client{
			Base:  env("USGS_BASE_URL", evidence.DefaultBase),
			HTTP:  fetch.New("USGS ShakeMap", 45*time.Second, log),
			Cache: cache.New(100, 24*time.Hour, filepath.Join(cacheDir, "evidence")),
			Now:   now,
		},
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		if _, err := srv.GIBS.Layers(ctx); err != nil {
			log.Warn("gibs capabilities warm-up failed", "err", err)
		} else {
			log.Info("gibs capabilities loaded")
		}
	}()

	go func() {
		time.Sleep(5 * time.Second)
		t0 := time.Now()
		srv.WarmPacks()
		log.Info("data pack manifests ready", "ms", time.Since(t0).Milliseconds())
	}()

	h := httpx.Middleware(srv.Routes(), log, env("CORS_ORIGIN", ""), 90*time.Second)
	hs := &http.Server{Addr: addr, Handler: h, ReadHeaderTimeout: 10 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 120 * time.Second}

	go func() {
		log.Info("listening", "addr", addr, "cache_dir", cacheDir, "version", api.Version)
		if err := hs.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = hs.Shutdown(ctx)
	log.Info("stopped")
}
