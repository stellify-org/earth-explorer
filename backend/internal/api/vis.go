package api

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/stellify/earth-explorer/backend/internal/httpx"
	"github.com/stellify/earth-explorer/backend/internal/visgrid"
)

const DataVersion = "power-v10"

const CoarseFactor = 4

const MaxRegionDeg = 60.0

type frameCache struct {
	mu       sync.Mutex
	items    map[string][]byte
	order    []string
	inflight map[string]*sync.WaitGroup
}

func (c *frameCache) getOrCompute(k string, fn func() ([]byte, error)) ([]byte, error) {
	for {
		c.mu.Lock()
		if b, ok := c.items[k]; ok {
			c.mu.Unlock()
			return b, nil
		}
		if wg, ok := c.inflight[k]; ok {
			c.mu.Unlock()
			wg.Wait()
			continue
		}
		if c.inflight == nil {
			c.inflight = map[string]*sync.WaitGroup{}
		}
		wg := &sync.WaitGroup{}
		wg.Add(1)
		c.inflight[k] = wg
		c.mu.Unlock()
		b, err := fn()
		if err == nil {
			c.put(k, b)
		}
		c.mu.Lock()
		delete(c.inflight, k)
		c.mu.Unlock()
		wg.Done()
		return b, err
	}
}

func (c *frameCache) get(k string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	b, ok := c.items[k]
	return b, ok
}

func (c *frameCache) put(k string, b []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.items == nil {
		c.items = map[string][]byte{}
	}
	if _, ok := c.items[k]; !ok {
		c.order = append(c.order, k)
	}
	c.items[k] = b
	for len(c.order) > 300 {
		delete(c.items, c.order[0])
		c.order = c.order[1:]
	}
}

var components = map[string]string{"u10m": "power-merra2", "v10m": "power-merra2"}

func (s *Server) visCatalog(w http.ResponseWriter, r *http.Request) {
	if s.Vis == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "vis_unavailable", "scientific grids are not configured on this server", "")
		return
	}
	type entry struct {
		visgrid.VisVariable

		First      string   `json:"first"`
		Last       string   `json:"last"`
		Missing    []string `json:"missing"`
		Count      int      `json:"count"`
		LongName   string   `json:"long_name,omitempty"`
		Definition string   `json:"definition,omitempty"`
		Source     string   `json:"source"`
	}
	var out []entry
	for _, v := range visgrid.Catalog {
		ids := []string{v.ID}
		if len(v.Vector) == 2 {
			ids = v.Vector
		}
		var months []string
		var meta *visgrid.Meta
		for k, id := range ids {
			m, err := s.Vis.Meta(v.Dataset, id)
			if err != nil {
				months = nil
				break
			}
			meta = m
			if k == 0 {
				months = m.Months
			} else {
				months = intersect(months, m.Months)
			}
		}
		if len(months) == 0 {
			continue
		}
		first, last, missing := compact(months)
		e := entry{VisVariable: v, First: first, Last: last, Missing: missing, Count: len(months), Source: "NASA POWER Analysis-Ready Data (MERRA-2 based), s3://nasa-power/merra2/spatial/power_merra2_monthly_spatial_utc.zarr"}
		if meta != nil && len(v.Vector) == 0 {
			e.LongName, e.Definition = meta.LongName, meta.Definition
		}
		out = append(out, e)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"variables": out,
		"version":   DataVersion,
		"lod": map[string]any{
			"planet": fmt.Sprintf("area-weighted %dx%d block mean of native cells (2° x 2.5°)", CoarseFactor, CoarseFactor),
			"region": fmt.Sprintf("native 0.5° x 0.625° cells, up to %g° x %g°", MaxRegionDeg, MaxRegionDeg),
		},
		"citation":  "NASA POWER Project (NASA Langley Research Center), data version 10, derived from MERRA-2 (GMAO; Gelaro et al. 2017, doi:10.1175/JCLI-D-16-0758.1). Accessed via the Registry of Open Data on AWS.",
		"precision": "Frames are quantised to uint16 with a step of max(0.01, range/65534) in the variable's units; the source itself is stored at 0.01 resolution.",
	})
}

func intersect(a, b []string) []string {
	set := map[string]bool{}
	for _, x := range b {
		set[x] = true
	}
	var out []string
	for _, x := range a {
		if set[x] {
			out = append(out, x)
		}
	}
	return out
}

func parseBBox(s string) (w, so, e, n float64, err error) {
	p := strings.Split(s, ",")
	if len(p) != 4 {
		return 0, 0, 0, 0, errors.New("bbox must be west,south,east,north")
	}
	v := make([]float64, 4)
	for i := range p {
		if v[i], err = strconv.ParseFloat(p[i], 64); err != nil || math.IsNaN(v[i]) {
			return 0, 0, 0, 0, errors.New("bbox values must be numbers")
		}
	}
	w, so, e, n = v[0], v[1], v[2], v[3]
	if so < -90 || n > 90 || so >= n || w < -180 || w > 180 || e < -180 || e > 180 {
		return 0, 0, 0, 0, errors.New("bbox out of range")
	}
	span := e - w
	if span < 0 {
		span += 360
	}
	if n-so > MaxRegionDeg || span > MaxRegionDeg {
		return 0, 0, 0, 0, fmt.Errorf("bbox larger than %g degrees", MaxRegionDeg)
	}
	return w, so, e, n, nil
}

func (s *Server) visGrid(w http.ResponseWriter, r *http.Request) {
	if s.Vis == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "vis_unavailable", "scientific grids are not configured on this server", "")
		return
	}
	q := r.URL.Query()
	id := q.Get("var")
	dataset := components[id]
	v, isVar := visgrid.FindVar(id)
	if isVar {
		if len(v.Vector) > 0 {
			httpx.Error(w, http.StatusBadRequest, "vector_variable", "request the components "+strings.Join(v.Vector, " and ")+" for a vector variable", "var")
			return
		}
		dataset = v.Dataset
	}
	if dataset == "" {
		httpx.Error(w, http.StatusBadRequest, "unknown_variable", "unknown visualisation variable", "var")
		return
	}
	month := q.Get("month")
	if !(len(month) == 7 && month[4] == '-') && len(month) != 4 {
		httpx.Error(w, http.StatusBadRequest, "invalid_parameter", "month must be YYYY-MM (monthly) or YYYY (annual mean)", "month")
		return
	}
	kind := q.Get("kind")
	if kind == "" {
		kind = "value"
	}
	if kind != "value" && kind != "anomaly" && kind != "climatology" {
		httpx.Error(w, http.StatusBadRequest, "invalid_parameter", "kind must be value, anomaly or climatology", "kind")
		return
	}
	if kind == "climatology" && (len(month) != 7 || month[:4] != "1991" || month[5:] < "01" || month[5:] > "12" || !isVar || !v.Anomaly) {
		httpx.Error(w, http.StatusBadRequest, "invalid_parameter", "climatology uses 1991-MM as the calendar-month key for the 1991-2020 baseline", "month")
		return
	}
	if kind == "anomaly" && !(isVar && v.Anomaly) {
		httpx.Error(w, http.StatusBadRequest, "invalid_parameter", "anomalies are not offered for this variable", "kind")
		return
	}
	lod := q.Get("lod")
	if lod == "" {
		lod = "planet"
	}
	var bw, bs, be, bn float64
	switch lod {
	case "planet":
	case "region":
		var err error
		if bw, bs, be, bn, err = parseBBox(q.Get("bbox")); err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_parameter", err.Error(), "bbox")
			return
		}
	default:
		httpx.Error(w, http.StatusBadRequest, "invalid_parameter", "lod must be planet or region", "lod")
		return
	}
	key := strings.Join([]string{dataset, id, month, kind, lod, q.Get("bbox")}, "|")
	sum := sha256.Sum256([]byte(key + DataVersion))
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	gz, err := s.visFrame(frameReq{dataset, id, month, kind, lod, bw, bs, be, bn, q.Get("bbox")})
	if err != nil {
		var nf *noData
		if errors.As(err, &nf) {
			httpx.Error(w, http.StatusNotFound, "no_data", nf.msg, nf.field)
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "internal_error", err.Error(), "")
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	if q.Get("v") == DataVersion {

		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=604800")
	}
	w.Header().Set("ETag", etag)
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Content-Length", strconv.Itoa(len(gz)))
		w.Write(gz)
		return
	}
	zr, _ := gzip.NewReader(bytes.NewReader(gz))
	var raw bytes.Buffer
	raw.ReadFrom(zr)
	w.Write(raw.Bytes())
}

type frameReq struct {
	dataset, id, month, kind, lod string
	w, s, e, n                    float64
	bbox                          string
}

type noData struct{ msg, field string }

func (e *noData) Error() string { return e.msg }

func (s *Server) annual(dataset, id, year string) (*visgrid.Grid, error) {
	var sum []float64
	var cnt []int
	var tmpl *visgrid.Grid
	for m := 1; m <= 12; m++ {
		g, err := s.Vis.Native(dataset, id, fmt.Sprintf("%s-%02d", year, m))
		if err != nil {
			return nil, &noData{fmt.Sprintf("annual mean %s needs all 12 months; %s-%02d is missing", year, year, m), "month"}
		}
		if sum == nil {
			sum, cnt, tmpl = make([]float64, len(g.Values)), make([]int, len(g.Values)), g
		}
		for i, v := range g.Values {
			if !math.IsNaN(float64(v)) {
				sum[i] += float64(v)
				cnt[i]++
			}
		}
	}
	out := &visgrid.Grid{H: tmpl.H, Values: make([]float32, len(sum))}
	for i := range sum {
		if cnt[i] == 12 {
			out.Values[i] = float32(sum[i] / 12)
		} else {
			out.Values[i] = float32(math.NaN())
		}
	}
	out.H.Time = year
	out.H.Aggregation = "annual mean of 12 monthly means (unweighted by month length)"
	return out, nil
}

func (s *Server) annualClimatology(dataset, id string) (*visgrid.Grid, error) {
	var out *visgrid.Grid
	for m := 1; m <= 12; m++ {
		c, err := s.Vis.Climatology(dataset, id, fmt.Sprintf("%02d", m))
		if err != nil {
			return nil, &noData{err.Error(), "kind"}
		}
		if out == nil {
			out = &visgrid.Grid{H: c.H, Values: make([]float32, len(c.Values))}
		}
		for i, v := range c.Values {
			out.Values[i] += v / 12
		}
	}
	return out, nil
}

func (s *Server) visFrame(f frameReq) ([]byte, error) {
	key := strings.Join([]string{f.dataset, f.id, f.month, f.kind, f.lod, f.bbox}, "|")
	return s.frames.getOrCompute(key, func() ([]byte, error) {
		var g *visgrid.Grid
		var err error
		annual := len(f.month) == 4
		if f.kind == "climatology" {
			g, err = s.Vis.Climatology(f.dataset, f.id, f.month[5:])
			if err != nil {
				return nil, &noData{err.Error(), "kind"}
			}

			g = &visgrid.Grid{H: g.H, Values: g.Values}
			g.H.Kind, g.H.Baseline = "climatology", "1991-2020 mean of the same calendar month"
			g.H.Time = "1991-2020/" + f.month[5:]
		} else if annual {
			g, err = s.annual(f.dataset, f.id, f.month)
		} else {
			g, err = s.Vis.Native(f.dataset, f.id, f.month)
			if errors.Is(err, visgrid.ErrNotFound) {
				return nil, &noData{fmt.Sprintf("no %s grid for %s on this server", f.id, f.month), "month"}
			}
		}
		if err != nil {
			return nil, err
		}
		if f.kind == "anomaly" {
			var c *visgrid.Grid
			if annual {
				c, err = s.annualClimatology(f.dataset, f.id)
			} else {
				c, err = s.Vis.Climatology(f.dataset, f.id, f.month[5:])
			}
			if err != nil {
				return nil, &noData{err.Error(), "kind"}
			}
			agg := g.H.Aggregation
			g = visgrid.Anomaly(g, c)
			g.H.Aggregation = agg
			if annual {
				g.H.Baseline = "1991-2020 mean (annual)"
			}
		}
		if f.lod == "planet" {
			agg := g.H.Aggregation
			g = visgrid.Coarsen(g, CoarseFactor)
			if annual {
				g.H.Aggregation = agg + "; then " + g.H.Aggregation
			}
		} else if g, err = visgrid.Subset(g, f.w, f.s, f.e, f.n); err != nil {
			return nil, &noData{err.Error(), "bbox"}
		}
		var buf bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&buf, 6)
		zw.Write(visgrid.Encode(g, 0.01))
		zw.Close()
		return buf.Bytes(), nil
	})
}

func compact(months []string) (string, string, []string) {
	have := map[string]bool{}
	for _, m := range months {
		have[m] = true
	}
	first, last := months[0], months[len(months)-1]
	missing := []string{}
	for _, m := range periods(first, last) {
		if !have[m] {
			missing = append(missing, m)
		}
	}
	return first, last, missing
}
