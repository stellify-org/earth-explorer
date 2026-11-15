package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/analysis"
	"github.com/stellify/earth-explorer/backend/internal/catalog"
	"github.com/stellify/earth-explorer/backend/internal/events"
	"github.com/stellify/earth-explorer/backend/internal/evidence"
	"github.com/stellify/earth-explorer/backend/internal/fetch"
	"github.com/stellify/earth-explorer/backend/internal/gibs"
	"github.com/stellify/earth-explorer/backend/internal/httpx"
	"github.com/stellify/earth-explorer/backend/internal/power"
	"github.com/stellify/earth-explorer/backend/internal/quakes"
	"github.com/stellify/earth-explorer/backend/internal/series"
	"github.com/stellify/earth-explorer/backend/internal/stats"
	"github.com/stellify/earth-explorer/backend/internal/visgrid"
)

var Version = "0.1.0-dev"

type Server struct {
	Power        *power.Client
	GIBS         *gibs.Service
	Quakes       *quakes.Client
	Events       *events.Client
	Evidence     *evidence.Client
	Vis          *visgrid.Store
	Log          *slog.Logger
	Started      time.Time
	Now          func() time.Time
	PackCacheDir string
	packMu       sync.Mutex
	packCache    []Pack
	frames       frameCache
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", s.health)
	mux.HandleFunc("GET /api/v1/datasets", s.datasets)
	mux.HandleFunc("GET /api/v1/layers", s.layers)
	mux.HandleFunc("GET /api/v1/layers/{id}/availability", s.availability)
	mux.HandleFunc("GET /api/v1/timeseries", s.timeseries)
	mux.HandleFunc("GET /api/v1/trends", s.trends)
	mux.HandleFunc("GET /api/v1/compare", s.compare)
	mux.HandleFunc("GET /api/v1/grid", s.grid)
	mux.HandleFunc("GET /api/v1/vis/catalog", s.visCatalog)
	mux.HandleFunc("GET /api/v1/vis/grid", s.visGrid)
	mux.HandleFunc("GET /api/v1/packs", s.packs)
	mux.HandleFunc("GET /api/v1/earthquakes", s.earthquakes)
	mux.HandleFunc("GET /api/v1/events", s.eventList)
	mux.HandleFunc("GET /api/v1/events/{id}", s.eventDetail)
	mux.HandleFunc("GET /api/v1/evidence/earthquake/{id}", s.quakeEvidence)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		httpx.Error(w, http.StatusNotFound, "not_found", "no such endpoint: "+r.Method+" "+r.URL.Path, "")
	})
	return mux
}

func (s *Server) upstreamError(w http.ResponseWriter, err error) {
	var ue *fetch.UpstreamError
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		httpx.Error(w, http.StatusGatewayTimeout, "upstream_timeout", "the upstream data service did not answer in time; please retry", "")
	case errors.As(err, &ue):
		httpx.Error(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("%s returned HTTP %d", ue.Service, ue.Status), "")
	case errors.Is(err, power.ErrUnitMismatch):
		httpx.Error(w, http.StatusBadGateway, "upstream_contract_changed", err.Error(), "")
	default:
		s.Log.Error("upstream failure", "err", err)
		httpx.Error(w, http.StatusBadGateway, "upstream_unavailable", "the upstream data service is unavailable: "+err.Error(), "")
	}
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ready, gerr := s.GIBS.Ready()
	g := map[string]any{"capabilities_loaded": ready}
	if gerr != nil {
		g["last_error"] = gerr.Error()
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"status": "ok", "version": Version, "uptime_s": int(time.Since(s.Started).Seconds()),
		"gibs": g, "power_cache": s.Power.Cache.Stats(),
		"upstream": map[string]any{"power": s.Power.HTTP.Status(), "gibs": s.GIBS.HTTP.Status(), "usgs": s.Quakes.HTTP.Status(), "eonet": s.eonetStatus()},
	})
}

func (s *Server) datasets(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"variables": catalog.Variables(),
		"data_kinds": map[catalog.DataKind]string{
			catalog.KindObservation: "Direct in-situ measurement",
			catalog.KindRetrieval:   "Satellite-derived retrieval",
			catalog.KindReanalysis:  "Reanalysis: weather model constrained by assimilated observations",
			catalog.KindModel:       "Model estimate (not directly measured)",
			catalog.KindProjection:  "Climate projection under a scenario (not an observation)",
			catalog.KindDerived:     "Re-packaged reanalysis product (here: NASA POWER, based on MERRA-2)",
			catalog.KindImagery:     "Colour-mapped imagery for visual context only (never a measurement)",
			catalog.KindCatalog:     "Catalogue of discrete detected events",
		},
	})
}

func (s *Server) layers(w http.ResponseWriter, r *http.Request) {
	ls, err := s.GIBS.Layers(r.Context())
	if err != nil {
		s.upstreamError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"layers": ls, "source": gibs.CapabilitiesURL})
}

func (s *Server) availability(w http.ResponseWriter, r *http.Request) {
	l, err := s.GIBS.Find(r.Context(), r.PathValue("id"))
	if errors.Is(err, gibs.ErrUnknownLayer) {
		httpx.Error(w, http.StatusNotFound, "unknown_layer", "layer is not in the curated list", "id")
		return
	}
	if err != nil {
		s.upstreamError(w, err)
		return
	}
	if !l.TimeEnabled {
		httpx.JSON(w, http.StatusOK, map[string]any{"layer": l.ID, "time_enabled": false})
		return
	}
	date := r.URL.Query().Get("date")
	a, err := gibs.Snap(l.Intervals, date)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_parameter", err.Error(), "date")
		return
	}
	if r.URL.Query().Get("verify") == "1" {
		if act, err := s.GIBS.ResolveActual(r.Context(), l, a.Shown); err == nil {
			a.Actual = act
		} else {
			s.Log.Warn("gibs verify failed", "err", err)
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"layer": l.ID, "time_enabled": true, "availability": a, "intervals_maybe_truncated": l.MaybeTruncated})
}

type pointRequest struct {
	v          catalog.Variable
	lat, lon   float64
	start, end int
}

func (s *Server) parsePoint(w http.ResponseWriter, r *http.Request) (*pointRequest, bool) {
	id := r.URL.Query().Get("variable")
	v, ok := catalog.ByID(id)
	if !ok {
		ids := []string{}
		for _, x := range catalog.Variables() {
			ids = append(ids, x.ID)
		}
		httpx.Error(w, http.StatusBadRequest, "unknown_variable", "variable must be one of: "+strings.Join(ids, ", "), "variable")
		return nil, false
	}
	lat, e := httpx.Float(r, "lat", -90, 90)
	if e != nil {
		httpx.Fail(w, e)
		return nil, false
	}
	lon, e := httpx.Float(r, "lon", -180, 180)
	if e != nil {
		httpx.Fail(w, e)
		return nil, false
	}
	last := s.Power.LastCompleteYear()
	start, e := httpx.Int(r, "start", v.CoverageStart, v.CoverageStart, last)
	if e != nil {
		httpx.Fail(w, e)
		return nil, false
	}
	end, e := httpx.Int(r, "end", last, v.CoverageStart, last)
	if e != nil {
		httpx.Fail(w, e)
		return nil, false
	}
	if start > end {
		httpx.Error(w, http.StatusBadRequest, "invalid_range", "start must not be after end", "start")
		return nil, false
	}
	return &pointRequest{v: v, lat: lat, lon: lon, start: start, end: end}, true
}

func (s *Server) fetchSeries(ctx context.Context, p *pointRequest, start, end int) (*series.Monthly, error) {
	return s.Power.MonthlyPoint(ctx, p.v.ProviderParameter, p.v.Units, p.lat, p.lon, start, end)
}

type location struct {
	Lat           float64  `json:"lat"`
	Lon           float64  `json:"lon"`
	ElevationM    *float64 `json:"elevation_m,omitempty"`
	ElevationNote string   `json:"elevation_note,omitempty"`
	CellNote      string   `json:"cell_note"`
}

func loc(p *pointRequest, sr *series.Monthly) location {
	l := location{Lat: p.lat, Lon: p.lon, ElevationM: sr.ElevationM,
		CellNote: "Values represent the data-grid cell containing this point (" + p.v.SpatialResolution + "), not a station at this exact location."}
	if sr.ElevationM != nil {
		l.ElevationNote = "Elevation as reported by NASA POWER for this location (model grid context), not a surveyed point elevation."
	}
	return l
}

func (s *Server) timeseries(w http.ResponseWriter, r *http.Request) {
	p, ok := s.parsePoint(w, r)
	if !ok {
		return
	}
	sr, err := s.fetchSeries(r.Context(), p, p.start, p.end)
	if err != nil {
		s.upstreamError(w, err)
		return
	}
	res := analysis.Prepare(sr)
	httpx.JSON(w, http.StatusOK, map[string]any{"variable": p.v, "location": loc(p, sr), "result": res})
}

func (s *Server) trends(w http.ResponseWriter, r *http.Request) {
	p, ok := s.parsePoint(w, r)
	if !ok {
		return
	}
	alpha := 0.05
	if a := r.URL.Query().Get("alpha"); a != "" {
		f, err := strconv.ParseFloat(a, 64)
		if err != nil || (f != 0.01 && f != 0.05 && f != 0.10) {
			httpx.Error(w, http.StatusBadRequest, "invalid_parameter", "alpha must be 0.01, 0.05 or 0.10", "alpha")
			return
		}
		alpha = f
	}
	sr, err := s.fetchSeries(r.Context(), p, p.start, p.end)
	if err != nil {
		s.upstreamError(w, err)
		return
	}
	res := analysis.Analyze(sr, analysis.Options{Alpha: alpha, UnitsLabel: p.v.UnitsLabel, VarName: strings.ToLower(p.v.Name[:1]) + p.v.Name[1:], Now: s.Now()})
	res.Warnings = append(res.Warnings, p.v.Limitations...)
	httpx.JSON(w, http.StatusOK, map[string]any{"variable": p.v, "location": loc(p, sr), "result": res})
}

func parsePeriod(s string) (int, int, error) {
	parts := strings.Split(s, "-")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("expected YYYY-YYYY")
	}
	a, err1 := strconv.Atoi(parts[0])
	b, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || a > b {
		return 0, 0, fmt.Errorf("expected YYYY-YYYY with start <= end")
	}
	return a, b, nil
}

func (s *Server) compare(w http.ResponseWriter, r *http.Request) {
	p, ok := s.parsePoint(w, r)
	if !ok {
		return
	}
	last := s.Power.LastCompleteYear()
	var per [2][2]int
	for i, name := range []string{"period_a", "period_b"} {
		a, b, err := parsePeriod(r.URL.Query().Get(name))
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_parameter", name+": "+err.Error(), name)
			return
		}
		if a < p.v.CoverageStart || b > last {
			httpx.Error(w, http.StatusBadRequest, "out_of_range", fmt.Sprintf("%s must lie within %d-%d", name, p.v.CoverageStart, last), name)
			return
		}
		if b-a+1 < 5 {
			httpx.Error(w, http.StatusBadRequest, "invalid_parameter", name+" must span at least 5 years", name)
			return
		}
		per[i] = [2]int{a, b}
	}
	sr, err := s.fetchSeries(r.Context(), p, min(per[0][0], per[1][0]), max(per[0][1], per[1][1]))
	if err != nil {
		s.upstreamError(w, err)
		return
	}
	prep := analysis.Prepare(sr)
	pick := func(a, b int) []float64 {
		var out []float64
		for _, x := range prep.Annual {
			if x.Year >= a && x.Year <= b {
				out = append(out, float64(x.Mean))
			}
		}
		return out
	}
	A, B := pick(per[0][0], per[0][1]), pick(per[1][0], per[1][1])
	wr, err := stats.Welch(A, B, 0.05)
	if err != nil {
		httpx.Error(w, http.StatusUnprocessableEntity, "insufficient_data", "not enough complete years in one of the periods", "")
		return
	}
	n := func(x float64) analysis.Num { return analysis.Num(x) }
	overlap := !(per[0][1] < per[1][0] || per[1][1] < per[0][0])
	notes := []string{
		"Descriptive comparison of annual means (each year must have 12 valid months).",
		"Welch's t-test treats annual means as independent; in a trending, autocorrelated series this is an approximation. Use Trend Detective for the rate of change.",
	}
	if overlap {
		notes = append(notes, "The two periods overlap, so they are not independent samples.")
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"variable": p.v, "location": loc(p, sr),
		"period_a":   map[string]any{"start": per[0][0], "end": per[0][1], "n_years": wr.NA, "mean": n(wr.MeanA)},
		"period_b":   map[string]any{"start": per[1][0], "end": per[1][1], "n_years": wr.NB, "mean": n(wr.MeanB)},
		"difference": map[string]any{"b_minus_a": n(wr.Diff), "ci_low": n(wr.CILow), "ci_high": n(wr.CIHigh), "p_value": n(wr.P), "df": n(wr.DF), "test": "Welch two-sample t-test on annual means"},
		"units":      p.v.UnitsLabel, "notes": notes, "provenance": sr.Provenance,
	})
}

func (s *Server) earthquakes(w http.ResponseWriter, r *http.Request) {
	q := quakes.Query{}
	var e *httpx.APIError
	if q.MinLat, e = httpx.Float(r, "minlat", -90, 90); e != nil {
		httpx.Fail(w, e)
		return
	}
	if q.MaxLat, e = httpx.Float(r, "maxlat", -90, 90); e != nil {
		httpx.Fail(w, e)
		return
	}
	if q.MinLon, e = httpx.Float(r, "minlon", -360, 360); e != nil {
		httpx.Fail(w, e)
		return
	}
	if q.MaxLon, e = httpx.Float(r, "maxlon", -360, 360); e != nil {
		httpx.Fail(w, e)
		return
	}
	minmag := 4.5
	if v := r.URL.Query().Get("minmag"); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || math.IsNaN(f) {
			httpx.Error(w, http.StatusBadRequest, "invalid_parameter", "minmag must be a number", "minmag")
			return
		}
		minmag = f
	}
	q.MinMag = minmag
	var err error
	now := s.Now().UTC()
	q.End, q.Start = now, now.AddDate(-1, 0, 0)
	if v := r.URL.Query().Get("start"); v != "" {
		if q.Start, err = time.Parse("2006-01-02", v); err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_parameter", "start must be YYYY-MM-DD", "start")
			return
		}
	}
	if v := r.URL.Query().Get("end"); v != "" {
		if q.End, err = time.Parse("2006-01-02", v); err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_parameter", "end must be YYYY-MM-DD", "end")
			return
		}
		q.End = q.End.Add(24*time.Hour - time.Second)
	}
	if q.Limit, e = httpx.Int(r, "limit", 2000, 1, quakes.MaxLimit); e != nil {
		httpx.Fail(w, e)
		return
	}
	if err := q.Validate(); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_parameter", err.Error(), "")
		return
	}
	res, err := s.Quakes.Search(r.Context(), q)
	if err != nil {
		s.upstreamError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (s *Server) eonetStatus() map[string]any {
	if s.Events == nil {
		return map[string]any{"reachable": nil}
	}
	return s.Events.HTTP.Status()
}

func (s *Server) eventList(w http.ResponseWriter, r *http.Request) {
	days, e := httpx.Int(r, "days", 30, 1, events.MaxDays)
	if e != nil {
		httpx.Fail(w, e)
		return
	}
	res, err := s.Events.Search(r.Context(), days, r.URL.Query().Get("category"))
	if err != nil {
		var ue *fetch.UpstreamError
		if !errors.As(err, &ue) && strings.HasPrefix(err.Error(), "category ") {
			httpx.Error(w, http.StatusBadRequest, "invalid_parameter", err.Error(), "category")
			return
		}
		s.upstreamError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (s *Server) eventDetail(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !events.ValidID(id) {
		httpx.Error(w, http.StatusBadRequest, "invalid_parameter", "id must look like EONET_12345", "id")
		return
	}
	res, err := s.Events.Get(r.Context(), id)
	if err != nil {
		var ue *fetch.UpstreamError
		if errors.As(err, &ue) && ue.Status == http.StatusNotFound {
			httpx.Error(w, http.StatusNotFound, "unknown_event", "NASA EONET has no event with this id", "id")
			return
		}
		s.upstreamError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (s *Server) quakeEvidence(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if s.Evidence == nil || !evidence.ValidQuakeID(id) {
		httpx.Error(w, http.StatusBadRequest, "invalid_parameter", "id must be a USGS event id such as us100044k6", "id")
		return
	}
	res, err := s.Evidence.Earthquake(r.Context(), id)
	if err != nil {
		if errors.Is(err, evidence.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "unknown_event", "USGS has no earthquake with this id", "id")
			return
		}
		s.upstreamError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (s *Server) grid(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("variable")
	v, ok := catalog.ByID(id)
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "unknown_variable", "unknown variable", "variable")
		return
	}
	lat, e := httpx.Float(r, "lat", -90, 90)
	if e != nil {
		httpx.Fail(w, e)
		return
	}
	lon, e := httpx.Float(r, "lon", -180, 180)
	if e != nil {
		httpx.Fail(w, e)
		return
	}
	last := s.Power.LastCompleteYear()
	year, e := httpx.Int(r, "year", last, v.CoverageStart, last)
	if e != nil {
		httpx.Fail(w, e)
		return
	}
	la0, la1, lo0, lo1 := power.RegionBox(lat, lon)
	g, err := s.Power.Regional(r.Context(), v.ProviderParameter, v.Units, la0, la1, lo0, lo1, year)
	if err != nil {
		s.upstreamError(w, err)
		return
	}
	notes := []string{
		"Each cell is one node of the source grid (cell centre ± half the spacing). Values are monthly means as provided by NASA POWER.",
		"Colours are a display aid computed from these values; hover or click to read the number.",
	}
	if g.Provenance.Stale {
		notes = append(notes, "NASA POWER could not be reached; this is an older cached copy.")
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"variable": v, "grid": g, "notes": notes})
}
