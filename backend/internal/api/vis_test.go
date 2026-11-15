package api

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stellify/earth-explorer/backend/internal/visgrid"
)

// writeFrame stores a synthetic 8x16 global frame (test input, not a measurement).
func writeFrame(t *testing.T, dir, variable, month string, value func(i, j int) float32) {
	t.Helper()
	h := visgrid.Header{Dataset: "power-merra2", Variable: variable, Units: "C", Time: month, NLat: 8, NLon: 16}
	for i := 0; i <= 8; i++ {
		h.LatEdges = append(h.LatEdges, -90+22.5*float64(i))
	}
	for j := 0; j <= 16; j++ {
		h.LonEdges = append(h.LonEdges, -191.25+22.5*float64(j))
	}
	for i := 0; i < 8; i++ {
		h.Lat = append(h.Lat, -78.75+22.5*float64(i))
	}
	for j := 0; j < 16; j++ {
		h.Lon = append(h.Lon, -180+22.5*float64(j))
	}
	g := &visgrid.Grid{H: h, Values: make([]float32, 128)}
	for i := 0; i < 8; i++ {
		for j := 0; j < 16; j++ {
			g.Values[i*16+j] = value(i, j)
		}
	}
	d := filepath.Join(dir, "power-merra2", variable)
	os.MkdirAll(d, 0o755)
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	zw.Write(visgrid.Encode(g, 0.01))
	zw.Close()
	os.WriteFile(filepath.Join(d, month+".eeg.gz"), buf.Bytes(), 0o644)
	os.WriteFile(filepath.Join(d, "meta.json"), []byte(`{"dataset":"power-merra2","variable":"`+variable+`","units":"C","months":[]}`), 0o644)
}

func TestVisEndpoints(t *testing.T) {
	dir := t.TempDir()
	for y := 1991; y <= 2020; y++ {
		writeFrame(t, dir, "t2m", itoa(y)+"-07", func(i, j int) float32 { return 10 }) // climatology = 10
	}
	writeFrame(t, dir, "t2m", "2024-07", func(i, j int) float32 {
		if i == 0 && j == 0 {
			return float32(math.NaN())
		}
		return 12.5
	})
	s := &Server{Vis: visgrid.NewStore(dir, 64)}
	srv := httptest.NewServer(s.Routes())
	defer srv.Close()

	// Catalog lists t2m with its months; wind is absent (no components ingested).
	resp, _ := http.Get(srv.URL + "/api/v1/vis/catalog")
	var cat struct {
		Variables []struct {
			ID, First, Last string
			Count           int
			Missing         []string
		}
	}
	json.NewDecoder(resp.Body).Decode(&cat)
	resp.Body.Close()
	if len(cat.Variables) != 1 || cat.Variables[0].ID != "t2m" || cat.Variables[0].Count != 31 || cat.Variables[0].First != "1991-07" || cat.Variables[0].Last != "2024-07" || len(cat.Variables[0].Missing) != 366 {
		t.Fatalf("catalog %+v", cat)
	}

	get := func(q string) (*visgrid.Grid, *http.Response) {
		req, _ := http.NewRequest("GET", srv.URL+"/api/v1/vis/grid?"+q, nil)
		req.Header.Set("Accept-Encoding", "gzip")
		r, err := http.DefaultTransport.RoundTrip(req)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		if r.StatusCode != 200 {
			return nil, r
		}
		zr, err := gzip.NewReader(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(zr)
		g, err := visgrid.Decode(b)
		if err != nil {
			t.Fatal(err)
		}
		return g, r
	}
	// Planet: 4x4 block mean -> 2x4 cells.
	g, r := get("var=t2m&month=2024-07&lod=planet")
	if g == nil || g.H.NLat != 2 || g.H.NLon != 4 || r.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("planet frame %v %v", g, r.StatusCode)
	}
	if v := g.Values[0]; math.Abs(float64(v)-12.5) > 0.006 {
		t.Fatalf("block mean with one missing cell = %v", v)
	}
	// Anomaly against the 1991–2020 July mean (10): +2.5.
	a, _ := get("var=t2m&month=2024-07&lod=planet&kind=anomaly")
	if a == nil || math.Abs(float64(a.Values[3])-2.5) > 0.006 || a.H.Kind != "anomaly" {
		t.Fatalf("anomaly %+v", a)
	}
	// Region across the antimeridian keeps native cells.
	rg, _ := get("var=t2m&month=2024-07&lod=region&bbox=150,-10,-150,40")
	if rg == nil || rg.H.LOD != "native subset" || rg.H.NLon != 3 || rg.H.Lon[0] != 157.5 || rg.H.Lon[1] != 180 || rg.H.Lon[2] != 202.5 {
		t.Fatalf("region %+v", rg)
	}
	for _, q := range []string{"var=nope&month=2024-07", "var=t2m&month=2024", "var=t2m&month=2023-07", "var=t2m&month=2024-07&lod=region&bbox=0,0,90,90", "var=wind10m&month=2024-07"} {
		if g, r := get(q); g != nil || r.StatusCode < 400 {
			t.Errorf("%s: expected an error, got %d", q, r.StatusCode)
		}
	}
}

func itoa(i int) string {
	return string(rune('0'+i/1000)) + string(rune('0'+i/100%10)) + string(rune('0'+i/10%10)) + string(rune('0'+i%10))
}

func TestAnnualFramesVersioningAndPackHelpers(t *testing.T) {
	dir := t.TempDir()
	for m := 1; m <= 12; m++ {
		mm := m
		writeFrame(t, dir, "t2m", "2024-"+itoa(m)[2:], func(i, j int) float32 { return float32(mm) }) // 1..12 -> mean 6.5
	}
	s := &Server{Vis: visgrid.NewStore(dir, 64)}
	srv := httptest.NewServer(s.Routes())
	defer srv.Close()
	req, _ := http.NewRequest("GET", srv.URL+FrameURL("t2m", "2024", "value", "planet", ""), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("status %d cache %q", resp.StatusCode, resp.Header.Get("Cache-Control"))
	}
	g, err := visgrid.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	if g.H.Time != "2024" || math.Abs(float64(g.Values[0])-6.5) > 0.006 {
		t.Fatalf("annual frame time %s value %v", g.H.Time, g.Values[0])
	}
	// An incomplete year is refused rather than averaged over fewer months.
	r2, _ := http.Get(srv.URL + "/api/v1/vis/grid?var=t2m&month=2023&lod=planet")
	if r2.StatusCode != 404 {
		t.Fatalf("incomplete year: %d", r2.StatusCode)
	}
	if got := periods("2024-11", "2025-02"); len(got) != 4 || got[0] != "2024-11" || got[3] != "2025-02" {
		t.Fatalf("periods %v", got)
	}
	if u := FrameURL("t2m", "2024-07", "value", "region", "45.00,30.00,90.00,60.00"); u != "/api/v1/vis/grid?var=t2m&month=2024-07&kind=value&lod=region&bbox=45.00,30.00,90.00,60.00&v=power-v10" {
		t.Fatalf("frame url %s", u)
	}
}

// Offline derived packs rely on three frame kinds agreeing: value − climatology = anomaly.
func TestClimatologyFramesMatchAnomalies(t *testing.T) {
	dir := t.TempDir()
	for y := 1991; y <= 2020; y++ {
		yy := y
		// Synthetic July field: 5 + (year − 1991) × 0.1, so the 1991–2020 mean is 6.45.
		writeFrame(t, dir, "t2m", itoa(y)+"-07", func(i, j int) float32 { return 5 + float32(yy-1991)*0.1 })
	}
	writeFrame(t, dir, "t2m", "2024-07", func(i, j int) float32 { return 9 })
	s := &Server{Vis: visgrid.NewStore(dir, 64)}
	srv := httptest.NewServer(s.Routes())
	defer srv.Close()
	get := func(month, kind string) (*visgrid.Grid, int) {
		resp, err := http.Get(srv.URL + FrameURL("t2m", month, kind, "region", "0.00,0.00,45.00,45.00"))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != 200 {
			return nil, resp.StatusCode
		}
		g, err := visgrid.Decode(b)
		if err != nil {
			t.Fatal(err)
		}
		return g, 200
	}
	clim, _ := get("1991-07", "climatology")
	value, _ := get("2024-07", "value")
	anom, _ := get("2024-07", "anomaly")
	if clim == nil || value == nil || anom == nil {
		t.Fatalf("frames: %v %v %v", clim, value, anom)
	}
	if clim.H.Kind != "climatology" || clim.H.Time != "1991-2020/07" || clim.H.Baseline == "" {
		t.Fatalf("climatology header %+v", clim.H)
	}
	if len(clim.Values) == 0 || len(clim.Values) != len(value.Values) || len(clim.Values) != len(anom.Values) {
		t.Fatalf("cell counts %d %d %d", len(clim.Values), len(value.Values), len(anom.Values))
	}
	for i := range clim.Values {
		if math.Abs(float64(clim.Values[i])-6.45) > 0.011 {
			t.Fatalf("climatology[%d] = %v, want 6.45", i, clim.Values[i])
		}
		// Each frame is quantised separately (step ≤ 0.01), hence the tolerance.
		if d := float64(value.Values[i] - clim.Values[i] - anom.Values[i]); math.Abs(d) > 0.021 {
			t.Fatalf("cell %d: value %v − climatology %v ≠ anomaly %v", i, value.Values[i], clim.Values[i], anom.Values[i])
		}
	}
	// The climatology frame must not turn later value requests into climatology (shared grid header).
	if again, _ := get("2024-07", "value"); again == nil || again.H.Kind == "climatology" {
		t.Fatalf("value frame after climatology: %+v", again)
	}
	// Only 1991-MM is a valid key; a calendar month without the 30 baseline years is refused.
	if g, code := get("2024-07", "climatology"); g != nil || code != 400 {
		t.Fatalf("2024-07 climatology: %d", code)
	}
	if g, code := get("1991-08", "climatology"); g != nil || code < 400 {
		t.Fatalf("August climatology without data: %d", code)
	}
}
