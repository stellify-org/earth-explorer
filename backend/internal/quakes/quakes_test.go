package quakes

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/cache"
	"github.com/stellify/earth-explorer/backend/internal/fetch"
)

func TestSnapshotSurvivesRestartAndUpstreamFailure(t *testing.T) {
	body, err := os.ReadFile("../../../data/fixtures/usgs_fdsn_tajikistan_2020-2024_M5.geojson")
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) > 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Write(body)
	}))
	defer upstream.Close()
	dir := t.TempDir()
	retrieved := time.Date(2026, 11, 13, 0, 0, 0, 0, time.UTC)
	makeClient := func() *Client {
		f := fetch.New("USGS", time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)))
		f.MaxRetries = 0
		return &Client{Base: upstream.URL, HTTP: f, Cache: cache.New(2, 10*time.Minute, dir), Now: func() time.Time { return retrieved }}
	}
	q := Query{MinLat: 36, MaxLat: 42, MinLon: 67, MaxLon: 76, MinMag: 5, Limit: 2000, Start: time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC), End: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)}
	first, err := makeClient().Search(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	if first.Stale || first.Count == 0 {
		t.Fatalf("unexpected initial result: %+v", first)
	}
	// A new client represents a server restart: fresh disk snapshot needs no USGS call.
	fresh, err := makeClient().Search(context.Background(), q)
	if err != nil || calls.Load() != 1 || fresh.Stale {
		t.Fatalf("restart: result=%+v err=%v calls=%d", fresh, err, calls.Load())
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.bin"))
	if len(files) != 1 {
		t.Fatalf("expected disk snapshot, got %v", files)
	}
	past := time.Now().Add(-time.Hour)
	if err := os.Chtimes(files[0], past, past); err != nil {
		t.Fatal(err)
	}
	stale, err := makeClient().Search(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	if !stale.Stale || stale.Count != first.Count || stale.Retrieved != first.Retrieved || stale.RequestURL != first.RequestURL {
		t.Fatalf("stale snapshot lost provenance: %+v", stale)
	}
	if !strings.Contains(strings.Join(stale.Notes, " "), "previously retrieved catalogue snapshot") {
		t.Fatal("missing stale notice")
	}
}
