package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/cache"
	"github.com/stellify/earth-explorer/backend/internal/fetch"
	"github.com/stellify/earth-explorer/backend/internal/gibs"
	"github.com/stellify/earth-explorer/backend/internal/httpx"
	"github.com/stellify/earth-explorer/backend/internal/power"
	"github.com/stellify/earth-explorer/backend/internal/quakes"
)

// Upstreams are emulated by local servers that replay REAL responses saved in
// data/fixtures (see data/fixtures/README.md). No measurement is invented.

func mustRead(t *testing.T, p string) []byte {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type env struct {
	srv        *httptest.Server
	powerCalls atomic.Int32
	powerFail  atomic.Bool
}

func setup(t *testing.T) *env {
	t.Helper()
	e := &env{}
	powerBody := mustRead(t, "../../../data/fixtures/power_monthly_T2M_PRECTOTCORR_38.56N_68.78E_1981-2025.json")
	capsBody := mustRead(t, "../gibs/testdata/capabilities_subset.xml")
	usgsBody := mustRead(t, "../../../data/fixtures/usgs_fdsn_tajikistan_2020-2024_M5.geojson")
	regionalBody := mustRead(t, "../../../data/fixtures/power_regional_T2M_34-44N_64-74E_2024.json")

	up := http.NewServeMux()
	up.HandleFunc("/power/api/temporal/monthly/point", func(w http.ResponseWriter, r *http.Request) {
		e.powerCalls.Add(1)
		if e.powerFail.Load() {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Write(powerBody)
	})
	up.HandleFunc("/power/api/temporal/monthly/regional", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("latitude-min") != "34.00" || q.Get("longitude-max") != "74.00" || q.Get("start") != "2024" {
			http.Error(w, "unexpected box "+r.URL.RawQuery, http.StatusBadRequest)
			return
		}
		w.Write(regionalBody)
	})
	up.HandleFunc("/caps.xml", func(w http.ResponseWriter, r *http.Request) { w.Write(capsBody) })
	up.HandleFunc("/usgs", func(w http.ResponseWriter, r *http.Request) { w.Write(usgsBody) })
	upstream := httptest.NewServer(up)
	t.Cleanup(upstream.Close)

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	now := func() time.Time { return time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC) }
	fast := func(name string) *fetch.Client {
		c := fetch.New(name, 5*time.Second, log)
		c.BaseDelay = time.Millisecond
		return c
	}
	s := &Server{
		Log: log, Started: now(), Now: now,
		Power:  &power.Client{Base: upstream.URL + "/power", HTTP: fast("POWER"), Cache: cache.New(10, time.Hour, ""), Now: now},
		GIBS:   &gibs.Service{URL: upstream.URL + "/caps.xml", HTTP: fast("GIBS"), Cache: cache.New(10, time.Hour, ""), Log: log},
		Quakes: &quakes.Client{Base: upstream.URL + "/usgs", HTTP: fast("USGS"), Cache: cache.New(10, time.Hour, ""), Now: now},
	}
	e.srv = httptest.NewServer(httpx.Middleware(s.Routes(), log, "", 10*time.Second))
	t.Cleanup(e.srv.Close)
	return e
}

func get(t *testing.T, e *env, path string, wantStatus int) map[string]any {
	t.Helper()
	resp, err := http.Get(e.srv.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var m map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		t.Fatalf("%s: invalid JSON: %v", path, err)
	}
	if resp.StatusCode != wantStatus {
		t.Fatalf("%s: status %d, want %d: %v", path, resp.StatusCode, wantStatus, m)
	}
	return m
}

func TestTrendsEndToEnd(t *testing.T) {
	e := setup(t)
	m := get(t, e, "/api/v1/trends?variable=t2m&lat=38.56&lon=68.78&start=1981&end=2025", 200)
	res := m["result"].(map[string]any)
	tr := res["trend"].(map[string]any)
	v := tr["verdict"].(map[string]any)["code"]
	if v != "significant_increase" {
		t.Fatalf("verdict %v", v)
	}
	prov := res["provenance"].(map[string]any)
	if prov["api_version"] != "v2.10.0" || prov["parameter"] != "T2M" {
		t.Fatalf("provenance %v", prov)
	}
	if len(res["points"].([]any)) != 540 {
		t.Fatal("expected 540 monthly points")
	}
	// Second call is served from cache.
	get(t, e, "/api/v1/trends?variable=t2m&lat=38.56&lon=68.78&start=1981&end=2025", 200)
	if e.powerCalls.Load() != 1 {
		t.Fatalf("expected 1 upstream call, got %d", e.powerCalls.Load())
	}
}

func TestValidation(t *testing.T) {
	e := setup(t)
	cases := map[string]string{
		"/api/v1/trends?variable=nope&lat=1&lon=1":                                       "unknown_variable",
		"/api/v1/trends?variable=t2m&lat=91&lon=1":                                       "out_of_range",
		"/api/v1/trends?variable=t2m&lon=1":                                              "missing_parameter",
		"/api/v1/trends?variable=t2m&lat=abc&lon=1":                                      "invalid_parameter",
		"/api/v1/trends?variable=t2m&lat=1&lon=1&start=2020&end=2010":                    "invalid_range",
		"/api/v1/trends?variable=t2m&lat=1&lon=1&end=2026":                               "out_of_range", // current year not complete
		"/api/v1/trends?variable=t2m&lat=1&lon=1&alpha=0.2":                              "invalid_parameter",
		"/api/v1/compare?variable=t2m&lat=1&lon=1&period_a=1981-1983&period_b=2000-2010": "invalid_parameter",
		"/api/v1/earthquakes?minlat=10&maxlat=5&minlon=0&maxlon=1":                       "invalid_parameter",
		"/api/v1/earthquakes?minlat=0&maxlat=5&minlon=0&maxlon=1&limit=50000":            "out_of_range",
		"/api/v1/layers/Foo/availability?date=2020-01-01":                                "unknown_layer",
		"/api/v1/layers/MERRA2_2m_Air_Temperature_Monthly/availability?date=2020-1-1":    "invalid_parameter",
	}
	for path, code := range cases {
		resp, err := http.Get(e.srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		var m struct{ Error httpx.APIError }
		json.NewDecoder(resp.Body).Decode(&m)
		resp.Body.Close()
		if m.Error.Code != code || resp.StatusCode < 400 {
			t.Errorf("%s: got %d %q, want %q", path, resp.StatusCode, m.Error.Code, code)
		}
	}
}

func TestUpstreamOutageIsReported(t *testing.T) {
	e := setup(t)
	e.powerFail.Store(true)
	m := get(t, e, "/api/v1/timeseries?variable=t2m&lat=10&lon=10&start=1990&end=2020", 502)
	if m["error"].(map[string]any)["code"] != "upstream_error" {
		t.Fatalf("got %v", m)
	}
	if e.powerCalls.Load() != 3 { // 1 try + 2 retries
		t.Fatalf("expected 3 attempts, got %d", e.powerCalls.Load())
	}
}

func TestLayersAvailabilityQuakesCompare(t *testing.T) {
	e := setup(t)
	l := get(t, e, "/api/v1/layers", 200)
	if len(l["layers"].([]any)) != 5 {
		t.Fatalf("expected the 5 curated layers in the fixture, got %d", len(l["layers"].([]any)))
	}
	a := get(t, e, "/api/v1/layers/MERRA2_2m_Air_Temperature_Monthly/availability?date=1985-07-15", 200)
	if a["availability"].(map[string]any)["shown"] != "1985-07-01" {
		t.Fatalf("availability %v", a)
	}
	q := get(t, e, "/api/v1/earthquakes?minlat=36.6&maxlat=41.1&minlon=67.3&maxlon=75.2&start=2020-01-01&end=2024-12-31&minmag=5", 200)
	evs := q["events"].([]any)
	if len(evs) == 0 {
		t.Fatal("no events")
	}
	ev := evs[0].(map[string]any)
	if _, ok := ev["depth_km"]; !ok || !strings.HasPrefix(q["source"].(string), "U.S. Geological Survey") {
		t.Fatalf("event %v", ev)
	}
	c := get(t, e, "/api/v1/compare?variable=t2m&lat=38.56&lon=68.78&period_a=1981-1990&period_b=2016-2025", 200)
	if c["difference"].(map[string]any)["b_minus_a"] == nil {
		t.Fatalf("compare %v", c)
	}
	h := get(t, e, "/api/v1/health", 200)
	if h["status"] != "ok" {
		t.Fatal(h)
	}
	get(t, e, "/api/v1/unknown", 404)
}

func TestGridFromRealRegionalResponse(t *testing.T) {
	e := setup(t)
	m := get(t, e, "/api/v1/grid?variable=t2m&lat=38.56&lon=68.78&year=2024", 200)
	g := m["grid"].(map[string]any)
	cells := g["cells"].([]any)
	if len(cells) != 336 || g["dlat"].(float64) != 0.5 || g["dlon"].(float64) != 0.625 {
		t.Fatalf("grid: %d cells, dlat %v dlon %v", len(cells), g["dlat"], g["dlon"])
	}
	c0 := cells[0].(map[string]any)
	months := c0["months"].([]any)
	// First node of the real response: 34.0N 64.375E, January 2024 = -1.15 C.
	if c0["lat"].(float64) != 34 || c0["lon"].(float64) != 64.375 || months[0].(float64) != -1.15 {
		t.Fatalf("first cell %v", c0)
	}
	get(t, e, "/api/v1/grid?variable=t2m&lat=38.56&lon=68.78&year=1970", 400)
	get(t, e, "/api/v1/grid?variable=nope&lat=1&lon=1", 400)
}
