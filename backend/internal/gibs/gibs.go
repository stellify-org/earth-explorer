package gibs

import (
	"context"
	"encoding/xml"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/cache"
	"github.com/stellify/earth-explorer/backend/internal/fetch"
)

const CapabilitiesURL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"

type Curated struct {
	ID           string `json:"id"`
	Group        string `json:"group"`
	ShortName    string `json:"short_name"`
	Measures     string `json:"measures"`
	DataNote     string `json:"data_resolution_note"`
	Caveat       string `json:"caveat,omitempty"`
	DefaultOn    bool   `json:"default_on,omitempty"`
	Quantitative bool   `json:"quantitative"`
}

var curated = []Curated{
	{ID: "BlueMarble_ShadedRelief_Bathymetry", Group: "base", ShortName: "Blue Marble (relief + bathymetry)", Measures: "Static composite basemap", DataNote: "Static composite; not a dated observation", DefaultOn: true},
	{ID: "BlueMarble_NextGeneration", Group: "base", ShortName: "Blue Marble Next Generation", Measures: "Static composite basemap", DataNote: "Static composite; not a dated observation"},
	{ID: "MODIS_Terra_CorrectedReflectance_TrueColor", Group: "true_color", ShortName: "MODIS Terra true colour (daily)", Measures: "Corrected reflectance, true colour", DataNote: "250 m imagery (per GIBS); daily swaths, gaps between orbits and clouds are normal"},
	{ID: "VIIRS_SNPP_CorrectedReflectance_TrueColor", Group: "true_color", ShortName: "VIIRS SNPP true colour (daily)", Measures: "Corrected reflectance, true colour", DataNote: "Daily swaths; available from late 2015"},
	{ID: "Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual", Group: "true_color", ShortName: "Landsat WELD annual true colour", Measures: "Landsat-based annual composite", DataNote: "Multi-year composites for a few epochs only (see dates)", Caveat: "Composite over several years; the date label is the GIBS time stamp, not a single acquisition date."},
	{ID: "VIIRS_Black_Marble", Group: "true_color", ShortName: "VIIRS Black Marble (night lights)", Measures: "Night-time lights composite", DataNote: "Annual composites for 2012 and 2016 only"},
	{ID: "MERRA2_2m_Air_Temperature_Monthly", Group: "science", ShortName: "MERRA-2 2 m air temperature (monthly)", Measures: "Reanalysis air temperature (colour-mapped)", DataNote: "Data ≈ 0.5° × 0.625° (~50 km); tiles are resampled and look sharper than the data"},
	{ID: "MERRA2_Precipitation_Bias_Corrected_Monthly", Group: "science", ShortName: "MERRA-2 precipitation, bias corrected (monthly)", Measures: "Reanalysis precipitation (colour-mapped)", DataNote: "Data ≈ 0.5° × 0.625° (~50 km)"},
	{ID: "IMERG_Precipitation_Rate", Group: "science", ShortName: "GPM IMERG precipitation rate (daily)", Measures: "Satellite precipitation rate (colour-mapped)", DataNote: "Data 0.1°"},
	{ID: "MODIS_Terra_Land_Surface_Temp_Day", Group: "science", ShortName: "MODIS Terra land surface temperature (day)", Measures: "Land skin temperature (not air temperature)", DataNote: "1 km data (per GIBS); cloud gaps are normal", Caveat: "Skin temperature of the land surface, a different physical quantity from 2 m air temperature."},
	{ID: "MODIS_Terra_L3_NDVI_Monthly", Group: "science", ShortName: "MODIS Terra NDVI (monthly)", Measures: "Vegetation index (colour-mapped)", DataNote: "Monthly composite"},
	{ID: "MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct", Group: "science", ShortName: "MODIS Terra snow cover (monthly %)", Measures: "Snow cover fraction (colour-mapped)", DataNote: "Monthly composite"},
	{ID: "MODIS_Combined_Value_Added_AOD", Group: "science", ShortName: "MODIS aerosol optical depth (combined)", Measures: "Column aerosol optical depth (colour-mapped)", DataNote: "Daily", Caveat: "Aerosol optical depth is a whole-column optical quantity. It is not the same as ground-level PM2.5."},
	{ID: "GHRSST_L4_MUR_Sea_Surface_Temperature", Group: "science", ShortName: "GHRSST MUR sea surface temperature", Measures: "Sea surface temperature analysis (colour-mapped)", DataNote: "Daily gap-filled analysis"},
	{ID: "Reference_Features_15m", Group: "reference", ShortName: "Borders and roads", Measures: "Reference vector features", DataNote: "Static overlay"},
	{ID: "Reference_Labels_15m", Group: "reference", ShortName: "Place labels", Measures: "Reference labels", DataNote: "Static overlay"},
	{ID: "Coastlines_15m", Group: "reference", ShortName: "Coastlines", Measures: "Coastlines", DataNote: "Static overlay", DefaultOn: true},
}

type Interval struct {
	Start  string `json:"start"`
	End    string `json:"end"`
	Period string `json:"period"`
}

type Layer struct {
	Curated
	Title          string     `json:"title"`
	Format         string     `json:"format"`
	TileMatrixSet  string     `json:"tile_matrix_set"`
	MaxLevel       int        `json:"max_level"`
	URLTemplate    string     `json:"url_template"`
	TimeEnabled    bool       `json:"time_enabled"`
	DefaultDate    string     `json:"default_date,omitempty"`
	Intervals      []Interval `json:"intervals,omitempty"`
	MaybeTruncated bool       `json:"intervals_maybe_truncated,omitempty"`
	LegendURL      string     `json:"legend_url,omitempty"`
	Attribution    string     `json:"attribution"`
}

type Service struct {
	HTTP  *fetch.Client
	Cache *cache.Cache
	Log   *slog.Logger
	URL   string

	mu      sync.RWMutex
	layers  []Layer
	loaded  time.Time
	lastErr error
}

type capDoc struct {
	Layers []capLayer `xml:"Contents>Layer"`
}
type capLayer struct {
	Identifier string   `xml:"Identifier"`
	Title      string   `xml:"Title"`
	Format     []string `xml:"Format"`
	Styles     []struct {
		Legends []struct {
			Href   string `xml:"href,attr"`
			Format string `xml:"format,attr"`
		} `xml:"LegendURL"`
	} `xml:"Style"`
	Dimension *struct {
		Identifier string   `xml:"Identifier"`
		Default    string   `xml:"Default"`
		Values     []string `xml:"Value"`
	} `xml:"Dimension"`
	TMS      []string `xml:"TileMatrixSetLink>TileMatrixSet"`
	Resource []struct {
		Template string `xml:"template,attr"`
	} `xml:"ResourceURL"`
}

func ParseCapabilities(b []byte) ([]Layer, error) {
	var doc capDoc
	if err := xml.Unmarshal(b, &doc); err != nil {
		return nil, fmt.Errorf("gibs: parse capabilities: %w", err)
	}
	byID := map[string]capLayer{}
	for _, l := range doc.Layers {
		byID[l.Identifier] = l
	}
	var out []Layer
	for _, c := range curated {
		cl, ok := byID[c.ID]
		if !ok {
			continue
		}
		l := Layer{Curated: c, Title: cl.Title,
			Attribution: "Imagery: NASA Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)."}
		if len(cl.Format) > 0 {
			l.Format = cl.Format[0]
		}
		if len(cl.TMS) > 0 {
			l.TileMatrixSet = cl.TMS[0]
			if i := strings.LastIndex(l.TileMatrixSet, "Level"); i >= 0 {
				l.MaxLevel, _ = strconv.Atoi(l.TileMatrixSet[i+5:])
			}
		}
		if len(cl.Resource) > 0 {
			l.URLTemplate = cl.Resource[0].Template
		}
		for _, s := range cl.Styles {
			for _, lg := range s.Legends {
				if strings.HasSuffix(lg.Href, "_H.svg") {
					l.LegendURL = lg.Href
				}
			}
		}
		if cl.Dimension != nil && strings.EqualFold(cl.Dimension.Identifier, "Time") {
			l.TimeEnabled = true
			l.DefaultDate = cl.Dimension.Default
			for _, v := range cl.Dimension.Values {
				p := strings.Split(strings.TrimSpace(v), "/")
				if len(p) == 3 {
					l.Intervals = append(l.Intervals, Interval{Start: p[0][:10], End: p[1][:10], Period: p[2]})
				} else if len(p) == 1 && len(p[0]) >= 10 {
					l.Intervals = append(l.Intervals, Interval{Start: p[0][:10], End: p[0][:10], Period: "P1D"})
				}
			}

			l.MaybeTruncated = len(cl.Dimension.Values) >= 100
		}
		out = append(out, l)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("gibs: none of the curated layers found in capabilities")
	}
	return out, nil
}

func (s *Service) Layers(ctx context.Context) ([]Layer, error) {
	s.mu.RLock()
	if s.layers != nil && time.Since(s.loaded) < 6*time.Hour {
		l := s.layers
		s.mu.RUnlock()
		return l, nil
	}
	s.mu.RUnlock()
	b, _, err := s.Cache.GetOrLoad(ctx, s.URL, func(ctx context.Context) ([]byte, error) {
		b, _, err := s.HTTP.Get(ctx, s.URL)
		return b, err
	})
	if err != nil {
		s.mu.Lock()
		s.lastErr = err
		old := s.layers
		s.mu.Unlock()
		if old != nil {
			s.Log.Warn("gibs capabilities refresh failed, serving stale", "err", err)
			return old, nil
		}
		return nil, err
	}
	layers, err := ParseCapabilities(b)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.layers, s.loaded, s.lastErr = layers, time.Now(), nil
	s.mu.Unlock()
	return layers, nil
}

func (s *Service) Find(ctx context.Context, id string) (Layer, error) {
	ls, err := s.Layers(ctx)
	if err != nil {
		return Layer{}, err
	}
	for _, l := range ls {
		if l.ID == id {
			return l, nil
		}
	}
	return Layer{}, ErrUnknownLayer
}

var ErrUnknownLayer = fmt.Errorf("gibs: unknown layer")

func (s *Service) Ready() (bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.layers != nil, s.lastErr
}

func (s *Service) ResolveActual(ctx context.Context, l Layer, date string) (string, error) {
	if !l.TimeEnabled || l.URLTemplate == "" {
		return "", nil
	}
	u := strings.NewReplacer("{Time}", date, "{TileMatrixSet}", l.TileMatrixSet, "{TileMatrix}", "0", "{TileRow}", "0", "{TileCol}", "0").Replace(l.URLTemplate)
	key := "HEAD " + u
	b, _, err := s.Cache.GetOrLoad(ctx, key, func(ctx context.Context) ([]byte, error) {
		_, h, err := s.HTTP.Do(ctx, "HEAD", u)
		if err != nil {
			return nil, err
		}
		return []byte(h.Get("layer-time-actual")), nil
	})
	if err != nil {
		return "", err
	}
	return string(b), nil
}
