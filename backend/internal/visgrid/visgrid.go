package visgrid

import (
	"bytes"
	"compress/gzip"
	"container/list"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

const NoData = 0xFFFF

type Header struct {
	Format      string         `json:"format"`
	Dataset     string         `json:"dataset"`
	Variable    string         `json:"variable"`
	Parameter   string         `json:"parameter"`
	LongName    string         `json:"long_name"`
	Units       string         `json:"units"`
	Time        string         `json:"time"`
	Kind        string         `json:"kind,omitempty"`
	Baseline    string         `json:"baseline,omitempty"`
	NLat        int            `json:"nlat"`
	NLon        int            `json:"nlon"`
	Lat         []float64      `json:"lat"`
	Lon         []float64      `json:"lon"`
	LatEdges    []float64      `json:"lat_edges"`
	LonEdges    []float64      `json:"lon_edges"`
	LOD         string         `json:"lod"`
	Aggregation string         `json:"aggregation"`
	Source      map[string]any `json:"source"`
	Offset      float64        `json:"offset"`
	Scale       float64        `json:"scale"`
	NoData      int            `json:"nodata"`
	Stats       map[string]any `json:"stats"`
	Wraps       bool           `json:"wraps_longitude"`
}

type Grid struct {
	H      Header
	Values []float32
}

func Decode(b []byte) (*Grid, error) {
	if len(b) < 8 || string(b[:4]) != "EEG1" {
		return nil, errors.New("visgrid: not an eegrid/1 frame")
	}
	n := int(binary.LittleEndian.Uint32(b[4:8]))
	if 8+n > len(b) {
		return nil, errors.New("visgrid: truncated header")
	}
	var h Header
	if err := json.Unmarshal(bytes.TrimRight(b[8:8+n], "\x00"), &h); err != nil {
		return nil, fmt.Errorf("visgrid: header: %w", err)
	}
	data := b[8+n:]
	if len(data) != 2*h.NLat*h.NLon {
		return nil, fmt.Errorf("visgrid: expected %d values, got %d bytes", h.NLat*h.NLon, len(data))
	}
	g := &Grid{H: h, Values: make([]float32, h.NLat*h.NLon)}
	for i := range g.Values {
		q := binary.LittleEndian.Uint16(data[2*i:])
		if q == NoData {
			g.Values[i] = float32(math.NaN())
		} else {
			g.Values[i] = float32(h.Offset + float64(q)*h.Scale)
		}
	}
	return g, nil
}

func Encode(g *Grid, minStep float64) []byte {
	lo, hi, valid := math.Inf(1), math.Inf(-1), 0
	for _, v := range g.Values {
		f := float64(v)
		if math.IsNaN(f) {
			continue
		}
		valid++
		lo, hi = math.Min(lo, f), math.Max(hi, f)
	}
	if valid == 0 {
		lo, hi = 0, 0
	}
	scale := minStep
	if r := (hi - lo) / 65534; r > scale {
		scale = r
	}
	h := g.H
	h.Format, h.Offset, h.Scale, h.NoData = "eegrid/1", lo, scale, NoData
	h.Stats = map[string]any{"min": lo, "max": hi, "valid": valid, "cells": len(g.Values)}
	hb, _ := json.Marshal(h)
	pad := (8 + len(hb)) % 2
	out := make([]byte, 8+len(hb)+pad+2*len(g.Values))
	copy(out, "EEG1")
	binary.LittleEndian.PutUint32(out[4:], uint32(len(hb)+pad))
	copy(out[8:], hb)
	d := out[8+len(hb)+pad:]
	for i, v := range g.Values {
		q := uint16(NoData)
		if f := float64(v); !math.IsNaN(f) {
			q = uint16(math.Min(65534, math.Max(0, math.Round((f-lo)/scale))))
		}
		binary.LittleEndian.PutUint16(d[2*i:], q)
	}
	return out
}

type Meta struct {
	Dataset    string         `json:"dataset"`
	Variable   string         `json:"variable"`
	Parameter  string         `json:"parameter"`
	LongName   string         `json:"long_name"`
	Definition string         `json:"definition"`
	Units      string         `json:"units"`
	Months     []string       `json:"months"`
	Grid       map[string]any `json:"grid"`
	Source     string         `json:"source"`
}

type Store struct {
	Dir string

	mu    sync.Mutex
	lru   *list.List
	items map[string]*list.Element
	max   int
	clim  map[string]*Grid
}

type entry struct {
	key string
	g   *Grid
}

func NewStore(dir string, maxFrames int) *Store {
	return &Store{Dir: dir, lru: list.New(), items: map[string]*list.Element{}, max: maxFrames, clim: map[string]*Grid{}}
}

var ErrNotFound = errors.New("visgrid: not available")

func (s *Store) Meta(dataset, variable string) (*Meta, error) {
	b, err := os.ReadFile(filepath.Join(s.Dir, dataset, variable, "meta.json"))
	if err != nil {
		return nil, ErrNotFound
	}
	var m Meta
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}

	files, _ := filepath.Glob(filepath.Join(s.Dir, dataset, variable, "*.eeg.gz"))
	m.Months = m.Months[:0]
	for _, f := range files {
		base := filepath.Base(f)
		m.Months = append(m.Months, base[:len(base)-len(".eeg.gz")])
	}
	sort.Strings(m.Months)
	return &m, nil
}

func (s *Store) Native(dataset, variable, month string) (*Grid, error) {
	key := dataset + "/" + variable + "/" + month
	s.mu.Lock()
	if el, ok := s.items[key]; ok {
		s.lru.MoveToFront(el)
		g := el.Value.(*entry).g
		s.mu.Unlock()
		return g, nil
	}
	s.mu.Unlock()
	f, err := os.Open(filepath.Join(s.Dir, dataset, variable, month+".eeg.gz"))
	if err != nil {
		return nil, ErrNotFound
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	b, err := io.ReadAll(zr)
	if err != nil {
		return nil, err
	}
	g, err := Decode(b)
	if err != nil {
		return nil, err
	}
	g.H.Wraps = len(g.H.LonEdges) > 1 && math.Abs(g.H.LonEdges[len(g.H.LonEdges)-1]-g.H.LonEdges[0]-360) < 1e-6
	s.mu.Lock()
	s.items[key] = s.lru.PushFront(&entry{key, g})
	for s.lru.Len() > s.max {
		old := s.lru.Back()
		s.lru.Remove(old)
		delete(s.items, old.Value.(*entry).key)
	}
	s.mu.Unlock()
	return g, nil
}

func (s *Store) Climatology(dataset, variable, mm string) (*Grid, error) {
	key := dataset + "/" + variable + "/" + mm
	s.mu.Lock()
	if g, ok := s.clim[key]; ok {
		s.mu.Unlock()
		return g, nil
	}
	s.mu.Unlock()
	var sum []float64
	var cnt []int
	var tmpl *Grid
	for y := 1991; y <= 2020; y++ {
		g, err := s.Native(dataset, variable, fmt.Sprintf("%04d-%s", y, mm))
		if err != nil {
			return nil, fmt.Errorf("%w: climatology needs %04d-%s", ErrNotFound, y, mm)
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
	c := &Grid{H: tmpl.H, Values: make([]float32, len(sum))}
	for i := range sum {
		if cnt[i] == 30 {
			c.Values[i] = float32(sum[i] / 30)
		} else {
			c.Values[i] = float32(math.NaN())
		}
	}
	s.mu.Lock()
	s.clim[key] = c
	s.mu.Unlock()
	return c, nil
}

func Anomaly(g, clim *Grid) *Grid {
	a := &Grid{H: g.H, Values: make([]float32, len(g.Values))}
	for i, v := range g.Values {
		a.Values[i] = v - clim.Values[i]
	}
	a.H.Kind, a.H.Baseline = "anomaly", "1991-2020 mean of the same calendar month"
	return a
}

func Coarsen(g *Grid, f int) *Grid {
	h := g.H
	nlat, nlon := (h.NLat+f-1)/f, (h.NLon+f-1)/f
	out := &Grid{H: h, Values: make([]float32, nlat*nlon)}
	out.H.NLat, out.H.NLon = nlat, nlon
	out.H.LatEdges, out.H.LonEdges = make([]float64, nlat+1), make([]float64, nlon+1)
	out.H.Lat, out.H.Lon = make([]float64, nlat), make([]float64, nlon)
	for i := 0; i <= nlat; i++ {
		out.H.LatEdges[i] = h.LatEdges[min(i*f, h.NLat)]
	}
	for j := 0; j <= nlon; j++ {
		out.H.LonEdges[j] = h.LonEdges[min(j*f, h.NLon)]
	}
	for i := 0; i < nlat; i++ {
		out.H.Lat[i] = (out.H.LatEdges[i] + out.H.LatEdges[i+1]) / 2
	}
	for j := 0; j < nlon; j++ {
		out.H.Lon[j] = (out.H.LonEdges[j] + out.H.LonEdges[j+1]) / 2
	}
	for bi := 0; bi < nlat; bi++ {
		for bj := 0; bj < nlon; bj++ {
			var sw, sv, tot float64
			for i := bi * f; i < min((bi+1)*f, h.NLat); i++ {
				w := math.Abs(math.Sin(h.LatEdges[i+1]*math.Pi/180) - math.Sin(h.LatEdges[i]*math.Pi/180))
				for j := bj * f; j < min((bj+1)*f, h.NLon); j++ {
					tot += w
					if v := float64(g.Values[i*h.NLon+j]); !math.IsNaN(v) {
						sw += w
						sv += w * v
					}
				}
			}
			if tot > 0 && sw >= tot/2 {
				out.Values[bi*nlon+bj] = float32(sv / sw)
			} else {
				out.Values[bi*nlon+bj] = float32(math.NaN())
			}
		}
	}
	out.H.LOD = fmt.Sprintf("coarse x%d", f)
	out.H.Aggregation = fmt.Sprintf("area-weighted mean of %dx%d native cells (cells with <50%% valid area are missing); no interpolation", f, f)
	return out
}

func Subset(g *Grid, west, south, east, north float64) (*Grid, error) {
	h := g.H
	var rows, cols []int
	for i, la := range h.Lat {
		if la >= south && la <= north {
			rows = append(rows, i)
		}
	}
	norm := func(x float64) float64 { return math.Mod(math.Mod(x+180, 360)+360, 360) - 180 }
	w, e := norm(west), norm(east)
	in := func(lo float64) bool {
		lo = norm(lo)
		if w <= e {
			return lo >= w && lo <= e
		}
		return lo >= w || lo <= e
	}

	start := 0
	for j, lo := range h.Lon {
		if lo >= w {
			start = j
			break
		}
	}
	for k := 0; k < h.NLon; k++ {
		j := (start + k) % h.NLon
		if in(h.Lon[j]) {
			cols = append(cols, j)
		}
	}
	if len(rows) == 0 || len(cols) == 0 {
		return nil, fmt.Errorf("%w: empty subset", ErrNotFound)
	}
	out := &Grid{H: h, Values: make([]float32, len(rows)*len(cols))}
	out.H.NLat, out.H.NLon = len(rows), len(cols)
	out.H.Lat, out.H.Lon = make([]float64, len(rows)), make([]float64, len(cols))
	out.H.LatEdges, out.H.LonEdges = make([]float64, len(rows)+1), make([]float64, len(cols)+1)
	for a, i := range rows {
		out.H.Lat[a] = h.Lat[i]
		out.H.LatEdges[a] = h.LatEdges[i]
	}
	out.H.LatEdges[len(rows)] = h.LatEdges[rows[len(rows)-1]+1]
	prev := math.Inf(-1)
	for b, j := range cols {
		lo, le := h.Lon[j], h.LonEdges[j]
		for lo < prev {
			lo += 360
			le += 360
		}
		prev = lo
		out.H.Lon[b], out.H.LonEdges[b] = lo, le
	}
	last := cols[len(cols)-1]
	out.H.LonEdges[len(cols)] = out.H.LonEdges[len(cols)-1] + (h.LonEdges[last+1] - h.LonEdges[last])
	for a, i := range rows {
		for b, j := range cols {
			out.Values[a*len(cols)+b] = g.Values[i*h.NLon+j]
		}
	}
	out.H.Wraps = false
	out.H.LOD = "native subset"
	out.H.Aggregation = "none (source grid)"
	return out, nil
}
