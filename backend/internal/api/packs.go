package api

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"

	"github.com/stellify/earth-explorer/backend/internal/httpx"
)

type PackChunk struct {
	URL    string `json:"url"`
	Bytes  int    `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type Pack struct {
	ID          string      `json:"id"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Version     string      `json:"version"`
	Variable    string      `json:"variable"`
	Units       string      `json:"units"`
	Temporal    string      `json:"temporal_resolution"`
	From        string      `json:"from"`
	To          string      `json:"to"`
	Spatial     string      `json:"spatial_resolution"`
	BBox        string      `json:"bbox,omitempty"`
	Bytes       int         `json:"bytes"`
	ChunkCount  int         `json:"chunk_count"`
	Chunks      []PackChunk `json:"chunks"`
	SourceURL   string      `json:"source_url"`
	DOI         string      `json:"upstream_doi"`
	Citation    string      `json:"citation"`
	MinApp      string      `json:"required_app_version"`
}

type packDef struct {
	id, title, desc, variable, units, temporal, spatial, doi string
	ids                                                      []string
	from, to                                                 string
	lod, bbox                                                string
	kind                                                     string
	w, s, e, n                                               float64
}

var regionalIDs = []string{"t2m", "precip", "soilwet", "qv2m", "rh2m"}

var packDefs = []packDef{
	{id: "t2m-annual", title: "Global temperature — annual means 1981–2025", desc: "2 m air temperature, annual mean of 12 monthly means, planet grid (2° × 2.5° block means).",
		variable: "t2m", units: "°C", temporal: "annual", spatial: "2° × 2.5° (area-weighted block mean of MERRA-2 cells)", doi: "10.5067/AP1B0BA5PD2K",
		ids: []string{"t2m"}, from: "1981", to: "2025", lod: "planet"},
	{id: "precip-annual", title: "Global precipitation — annual means 1981–2025", desc: "Corrected precipitation, annual mean of 12 monthly means, planet grid.",
		variable: "precip", units: "mm/day", temporal: "annual", spatial: "2° × 2.5° block mean", doi: "10.5067/0JRLVL8YV2Y4",
		ids: []string{"precip"}, from: "1981", to: "2025", lod: "planet"},
	{id: "t2m-monthly-recent", title: "Global temperature — monthly 2021–2025", desc: "2 m air temperature, 60 monthly frames, planet grid.",
		variable: "t2m", units: "°C", temporal: "monthly", spatial: "2° × 2.5° block mean", doi: "10.5067/AP1B0BA5PD2K",
		ids: []string{"t2m"}, from: "2021-01", to: "2025-12", lod: "planet"},
	{id: "precip-monthly-recent", title: "Global precipitation — monthly 2021–2025", desc: "Corrected precipitation, 60 monthly frames, planet grid.",
		variable: "precip", units: "mm/day", temporal: "monthly", spatial: "2° × 2.5° block mean", doi: "10.5067/0JRLVL8YV2Y4",
		ids: []string{"precip"}, from: "2021-01", to: "2025-12", lod: "planet"},
	{id: "wind-monthly-2024", title: "Global 10 m wind vectors — monthly 2024", desc: "Eastward and northward 10 m wind (U10M, V10M) for Flow mode, 12 months.",
		variable: "wind10m", units: "m/s", temporal: "monthly", spatial: "2° × 2.5° block mean", doi: "10.5067/AP1B0BA5PD2K",
		ids: []string{"u10m", "v10m"}, from: "2024-01", to: "2024-12", lod: "planet"},

	{id: "tajikistan-native", title: "Tajikistan — all variables, native grid, monthly 1981–2026", desc: "Temperature, precipitation, soil wetness, specific and relative humidity on the native 0.5° × 0.625° grid for 67–76°E, 36–42°N. Absolute monthly values (anomalies and annual means are not included).",
		variable: "t2m, precip, soilwet, qv2m, rh2m", units: "per variable", temporal: "monthly", spatial: "native 0.5° × 0.625°",
		ids: regionalIDs, from: "1981-01", to: "2026-09", lod: "region", bbox: "67.00,36.00,76.00,42.00", w: 67, s: 36, e: 76, n: 42},
	{id: "central-asia-native", title: "Central Asia — all variables, native grid, monthly 1981–2026", desc: "Temperature, precipitation, soil wetness, specific and relative humidity on the native 0.5° × 0.625° grid for 45–90°E, 30–60°N (Tajikistan and neighbours). Absolute monthly values (anomalies and annual means are not included).",
		variable: "t2m, precip, soilwet, qv2m, rh2m", units: "per variable", temporal: "monthly", spatial: "native 0.5° × 0.625°",
		ids: regionalIDs, from: "1981-01", to: "2026-09", lod: "region", bbox: "45.00,30.00,90.00,60.00", w: 45, s: 30, e: 90, n: 60},
}

func periods(from, to string) []string {
	var out []string
	if len(from) == 4 {
		var a, b int
		fmt.Sscanf(from, "%d", &a)
		fmt.Sscanf(to, "%d", &b)
		for y := a; y <= b; y++ {
			out = append(out, fmt.Sprintf("%04d", y))
		}
		return out
	}
	var y, m, y2, m2 int
	fmt.Sscanf(from, "%d-%d", &y, &m)
	fmt.Sscanf(to, "%d-%d", &y2, &m2)
	for y*12+m <= y2*12+m2 {
		out = append(out, fmt.Sprintf("%04d-%02d", y, m))
		m++
		if m > 12 {
			y, m = y+1, 1
		}
	}
	return out
}

func FrameURL(id, period, kind, lod, bbox string) string {
	v := "/api/v1/vis/grid?var=" + url.QueryEscape(id) + "&month=" + period + "&kind=" + kind + "&lod=" + lod
	if bbox != "" {
		v += "&bbox=" + bbox
	}
	return v + "&v=" + DataVersion
}

const maxInlineChunks = 200

func allPackDefs() []packDef {
	out := append([]packDef(nil), packDefs...)
	for _, region := range packDefs {
		if region.lod != "region" {
			continue
		}
		name := "Tajikistan"
		if region.id == "central-asia-native" {
			name = "Central Asia"
		}
		base := region.id[:len(region.id)-len("-native")]
		for _, extra := range []struct{ suffix, title, desc, kind, temporal, from, to string }{
			{"climatology", "climatology 1991–2020", "Twelve calendar-month baselines for five variables, computed from all 30 years (1991–2020). Native regional grid.", "climatology", "climatology", "1991-01", "1991-12"},
			{"anomalies", "monthly anomalies 1981–2026", "Monthly departures from the 1991–2020 mean of the same calendar month. Five variables, native regional grid.", "anomaly", "monthly", region.from, region.to},
			{"annual", "annual means 1981–2025", "Five variables. Each annual cell requires all twelve monthly means; incomplete years are excluded.", "value", "annual", "1981", "2025"},
			{"annual-anomalies", "annual anomalies 1981–2025", "Annual means minus the annual 1991–2020 climatology. Five variables, native regional grid.", "anomaly", "annual", "1981", "2025"},
		} {
			d := region
			d.id, d.title, d.desc = base+"-"+extra.suffix, name+" — "+extra.title, extra.desc
			d.kind, d.temporal, d.from, d.to = extra.kind, extra.temporal, extra.from, extra.to
			out = append(out, d)
		}
	}
	return out
}

func (s *Server) packCachePath(defs []packDef) string {
	if s.PackCacheDir == "" {
		return ""
	}
	h := sha256.New()
	fmt.Fprintf(h, "packs-2|%s|%d|%#v", DataVersion, CoarseFactor, defs)
	err := filepath.WalkDir(s.Vis.Dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		fmt.Fprintf(h, "|%s|%d|%d", path, info.Size(), info.ModTime().UnixNano())
		return nil
	})
	if err != nil {
		return ""
	}
	return filepath.Join(s.PackCacheDir, hex.EncodeToString(h.Sum(nil))+".json")
}

func (s *Server) buildPacks() []Pack {
	s.packMu.Lock()
	defer s.packMu.Unlock()
	if s.packCache != nil {
		return s.packCache
	}
	defs := allPackDefs()
	path := s.packCachePath(defs)
	if b, err := os.ReadFile(path); path != "" && err == nil {
		var saved []Pack
		if json.Unmarshal(b, &saved) == nil && len(saved) > 0 {
			s.packCache = saved
			return saved
		}
	}
	var out []Pack
	for _, d := range defs {
		kind := d.kind
		if kind == "" {
			kind = "value"
		}
		p := Pack{ID: d.id, Title: d.title, Description: d.desc, Version: DataVersion, Variable: d.variable, Units: d.units,
			Temporal: d.temporal, From: d.from, To: d.to, Spatial: d.spatial, BBox: d.bbox, DOI: d.doi, MinApp: "0.2.0",
			SourceURL: "s3://nasa-power/merra2/spatial/power_merra2_monthly_spatial_utc.zarr",
			Citation:  "NASA POWER Project (NASA Langley Research Center), data version 10, derived from MERRA-2 (GMAO)."}
		complete := true
		for _, id := range d.ids {
			for _, per := range periods(d.from, d.to) {
				gz, err := s.visFrame(frameReq{"power-merra2", id, per, kind, d.lod, d.w, d.s, d.e, d.n, d.bbox})
				if err != nil {
					complete = false
					break
				}
				zr, _ := gzip.NewReader(bytes.NewReader(gz))
				raw, _ := io.ReadAll(zr)
				zr.Close()
				sum := sha256.Sum256(raw)
				p.Chunks = append(p.Chunks, PackChunk{URL: FrameURL(id, per, kind, d.lod, d.bbox), Bytes: len(gz), SHA256: hex.EncodeToString(sum[:])})
				p.Bytes += len(gz)
			}
		}
		if complete {
			p.ChunkCount = len(p.Chunks)
			out = append(out, p)
		}
	}
	s.packCache = out

	if path != "" && len(out) == len(defs) {
		if b, err := json.Marshal(out); err == nil && os.MkdirAll(s.PackCacheDir, 0o755) == nil {
			if f, err := os.CreateTemp(s.PackCacheDir, "manifest-*.tmp"); err == nil {
				name := f.Name()
				_, writeErr := f.Write(b)
				closeErr := f.Close()
				if writeErr == nil && closeErr == nil {
					_ = os.Rename(name, path)
				}
				_ = os.Remove(name)
			}
		}
	}
	return out
}

func (s *Server) packs(w http.ResponseWriter, r *http.Request) {
	if s.Vis == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "vis_unavailable", "scientific grids are not configured on this server", "")
		return
	}
	all := s.buildPacks()
	if id := r.URL.Query().Get("id"); id != "" {
		for _, p := range all {
			if p.ID == id {
				httpx.JSON(w, http.StatusOK, map[string]any{"version": DataVersion, "pack": p})
				return
			}
		}
		httpx.Error(w, http.StatusNotFound, "not_found", "unknown pack", "id")
		return
	}

	list := make([]Pack, len(all))
	for i, p := range all {
		if len(p.Chunks) > maxInlineChunks {
			p.Chunks = []PackChunk{}
		}
		list[i] = p
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"version": DataVersion, "packs": list})
}

func (s *Server) WarmPacks() { s.buildPacks() }
