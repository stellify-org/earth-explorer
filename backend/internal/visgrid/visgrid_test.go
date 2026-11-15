package visgrid

import (
	"math"
	"os"
	"testing"
)

// A synthetic 4x8 global-style grid (values are test inputs, not measurements).
func synth() *Grid {
	h := Header{NLat: 4, NLon: 8, Variable: "test", Units: "1"}
	h.Lat = []float64{-67.5, -22.5, 22.5, 67.5}
	h.LatEdges = []float64{-90, -45, 0, 45, 90}
	for j := 0; j < 8; j++ {
		h.Lon = append(h.Lon, -180+22.5+45*float64(j))
		h.LonEdges = append(h.LonEdges, -180+45*float64(j))
	}
	h.LonEdges = append(h.LonEdges, 180)
	g := &Grid{H: h, Values: make([]float32, 32)}
	for i := range g.Values {
		g.Values[i] = float32(i)
	}
	return g
}

func TestEncodeDecodeRoundTripAndNoData(t *testing.T) {
	g := synth()
	g.Values[5] = float32(math.NaN())
	d, err := Decode(Encode(g, 0.01))
	if err != nil {
		t.Fatal(err)
	}
	for i, v := range g.Values {
		got := d.Values[i]
		if math.IsNaN(float64(v)) != math.IsNaN(float64(got)) {
			t.Fatalf("nodata mismatch at %d", i)
		}
		if !math.IsNaN(float64(v)) && math.Abs(float64(got-v)) > 0.005+1e-6 {
			t.Fatalf("value %d: %v vs %v (quantisation must be <= step/2)", i, got, v)
		}
	}
}

func TestCoarsenIsAreaWeightedAndExact(t *testing.T) {
	g := synth()
	c := Coarsen(g, 2)
	if c.H.NLat != 2 || c.H.NLon != 4 {
		t.Fatalf("shape %dx%d", c.H.NLat, c.H.NLon)
	}
	// Block (rows 0-1, cols 0-1): values 0,1,8,9 with band areas sin(-45)-sin(-90) and sin(0)-sin(-45).
	w0 := math.Sin(-math.Pi/4) - math.Sin(-math.Pi/2)
	w1 := math.Sin(0) - math.Sin(-math.Pi/4)
	want := (w0*(0+1) + w1*(8+9)) / (2*w0 + 2*w1)
	if math.Abs(float64(c.Values[0])-want) > 1e-5 {
		t.Fatalf("coarse value %v want %v", c.Values[0], want)
	}
	if c.H.LatEdges[0] != -90 || c.H.LatEdges[2] != 90 || c.H.LonEdges[4] != 180 {
		t.Fatalf("edges %v %v", c.H.LatEdges, c.H.LonEdges)
	}
	// Less than half the area valid -> missing.
	g.Values[0], g.Values[1], g.Values[8] = float32(math.NaN()), float32(math.NaN()), float32(math.NaN())
	if v := Coarsen(g, 2).Values[0]; !math.IsNaN(float64(v)) {
		t.Fatalf("expected missing, got %v", v)
	}
}

func TestSubsetAcrossAntimeridian(t *testing.T) {
	g := synth()
	s, err := Subset(g, 150, -90, -150, 0) // crosses 180°
	if err != nil {
		t.Fatal(err)
	}
	if s.H.NLon != 2 || s.H.NLat != 2 {
		t.Fatalf("shape %dx%d lon %v", s.H.NLat, s.H.NLon, s.H.Lon)
	}
	if s.H.Lon[0] != 157.5 || s.H.Lon[1] != 202.5 || s.H.LonEdges[2] != 225 {
		t.Fatalf("expected unwrapped increasing longitudes, got %v edges %v", s.H.Lon, s.H.LonEdges)
	}
	if s.Values[0] != 7 || s.Values[1] != 0 {
		t.Fatalf("values %v", s.Values)
	}
}

// Real file produced by science/vis/build_grids.py (if the ingest has run).
func TestRealT2MFrame(t *testing.T) {
	st := NewStore("../../../data/grids", 4)
	g, err := st.Native("power-merra2", "t2m", "2024-07")
	if err != nil {
		if _, e := os.Stat("../../../data/grids/power-merra2/t2m/2024-07.eeg.gz"); e != nil {
			t.Skip("grids not ingested on this machine")
		}
		t.Fatal(err)
	}
	if g.H.NLat != 361 || g.H.NLon != 576 || !g.H.Wraps || g.H.Units != "C" {
		t.Fatalf("header %+v", g.H)
	}
	var i, j int
	for i = range g.H.Lat {
		if g.H.Lat[i] == 38.5 {
			break
		}
	}
	for j = range g.H.Lon {
		if g.H.Lon[j] == 68.75 {
			break
		}
	}
	// Value read independently with xarray from the source Zarr: 27.37 °C (2024-07, 38.5N 68.75E).
	if v := g.Values[i*576+j]; math.Abs(float64(v)-27.37) > 0.006 {
		t.Fatalf("node value %v", v)
	}
	c := Coarsen(g, 4)
	if c.H.NLat != 91 || c.H.NLon != 144 {
		t.Fatalf("coarse %dx%d", c.H.NLat, c.H.NLon)
	}
}
