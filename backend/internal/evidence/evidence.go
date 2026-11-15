package evidence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/cache"
	"github.com/stellify/earth-explorer/backend/internal/fetch"
	"github.com/stellify/earth-explorer/backend/internal/quakes"
)

const DefaultBase = "https://earthquake.usgs.gov/fdsnws/event/1/query"

const (
	AfterRadiusKm = 100
	AfterDays     = 30
	AfterMinMag   = 2.5
	AfterLimit    = 1000
)

var ErrNotFound = errors.New("evidence: unknown earthquake id")

var idRE = regexp.MustCompile(`^[a-z]{2}[a-z0-9]{4,20}$`)

func ValidQuakeID(id string) bool { return idRE.MatchString(id) }

type Source struct {
	Name      string `json:"name"`
	URL       string `json:"url"`
	Retrieved string `json:"retrieved"`
	Licence   string `json:"licence,omitempty"`
}

type LegendItem struct {
	Color string `json:"color"`
	Label string `json:"label"`
}

type Stop struct {
	V     float64 `json:"v"`
	Color string  `json:"color"`
}

type Raster struct {
	BBox   [4]float64 `json:"bbox"`
	NX     int        `json:"nx"`
	NY     int        `json:"ny"`
	Scale  float64    `json:"scale"`
	Values []int      `json:"values"`
	Ramp   []Stop     `json:"ramp"`

	MinShown float64 `json:"min_shown"`
	Unit     string  `json:"unit"`
}

type Points struct {
	T0     int64     `json:"t0,omitempty"`
	TMin   []int     `json:"t_min,omitempty"`
	Lon    []float64 `json:"lon"`
	Lat    []float64 `json:"lat"`
	V      []float64 `json:"v,omitempty"`
	VLabel string    `json:"v_label,omitempty"`
	VUnit  string    `json:"v_unit,omitempty"`

	SizeBy string   `json:"size_by,omitempty"`
	Text   []string `json:"text,omitempty"`
}

type Layer struct {
	ID          string          `json:"id"`
	Label       string          `json:"label"`
	Short       string          `json:"short"`
	Icon        string          `json:"icon"`
	Kind        string          `json:"kind"`
	Evidence    string          `json:"evidence"`
	On          bool            `json:"on"`
	Time        string          `json:"time,omitempty"`
	Color       string          `json:"color,omitempty"`
	Size        float64         `json:"size,omitempty"`
	Fill        *bool           `json:"fill,omitempty"`
	Raster      *Raster         `json:"raster,omitempty"`
	Points      *Points         `json:"points,omitempty"`
	Polygons    [][][][]float64 `json:"polygons,omitempty"`
	Legend      []LegendItem    `json:"legend"`
	Source      Source          `json:"source"`
	Date        string          `json:"date"`
	Resolution  string          `json:"resolution"`
	Units       string          `json:"units"`
	Uncertainty string          `json:"uncertainty"`
	Note        string          `json:"note"`
}

type Measure struct {
	Label    string `json:"label"`
	Value    string `json:"value"`
	Unit     string `json:"unit"`
	Also     string `json:"also,omitempty"`
	Evidence string `json:"evidence"`
	Note     string `json:"note"`
}

type Step struct {
	T     int64  `json:"t"`
	Label string `json:"label"`
}

type Missing struct {
	Label  string `json:"label"`
	Reason string `json:"reason"`
}

type Depth struct {
	Km          float64  `json:"km"`
	RuptureTop  *float64 `json:"rupture_top_km,omitempty"`
	RuptureBase *float64 `json:"rupture_base_km,omitempty"`
}

type Bundle struct {
	Schema      int    `json:"schema"`
	EventID     string `json:"event_id"`
	Category    string `json:"category"`
	BuiltAt     string `json:"built_at"`
	Builder     string `json:"builder"`
	Title       string `json:"title"`
	Subtitle    string `json:"subtitle"`
	Association string `json:"association"`
	View        *struct {
		BBox [4]float64 `json:"bbox"`
	} `json:"view,omitempty"`
	Summary     []Measure `json:"summary"`
	Steps       []Step    `json:"steps"`
	StepsLabel  string    `json:"steps_label,omitempty"`
	Layers      []Layer   `json:"layers"`
	Unavailable []Missing `json:"unavailable"`
	Depth       *Depth    `json:"depth,omitempty"`
	Stale       bool      `json:"stale"`
	Notes       []string  `json:"notes,omitempty"`
}

type Client struct {
	Base  string
	HTTP  *fetch.Client
	Cache *cache.Cache
	Now   func() time.Time
}

type detail struct {
	ID         string `json:"id"`
	Properties struct {
		Mag      *float64 `json:"mag"`
		Place    string   `json:"place"`
		Time     int64    `json:"time"`
		URL      string   `json:"url"`
		MagType  string   `json:"magType"`
		Title    string   `json:"title"`
		Products map[string][]struct {
			Code       string            `json:"code"`
			Source     string            `json:"source"`
			UpdateTime int64             `json:"updateTime"`
			Properties map[string]string `json:"properties"`
			Contents   map[string]struct {
				URL    string `json:"url"`
				Length int64  `json:"length"`
			} `json:"contents"`
		} `json:"products"`
	} `json:"properties"`
	Geometry struct {
		Coordinates []float64 `json:"coordinates"`
	} `json:"geometry"`
}

type coverage struct {
	Domain struct {
		Axes struct {
			X struct {
				Start, Stop float64
				Num         int
			} `json:"x"`
			Y struct {
				Start, Stop float64
				Num         int
			} `json:"y"`
		} `json:"axes"`
	} `json:"domain"`
	Parameters map[string]struct {
		PreferredPalette struct {
			Colors []string  `json:"colors"`
			Extent []float64 `json:"extent"`
		} `json:"preferredPalette"`
	} `json:"parameters"`
	Ranges map[string]struct {
		AxisNames []string   `json:"axisNames"`
		Shape     []int      `json:"shape"`
		Values    []*float64 `json:"values"`
	} `json:"ranges"`
}

var mmiNames = map[int]string{2: "II–III weak", 4: "IV light", 5: "V moderate", 6: "VI strong", 7: "VII very strong", 8: "VIII severe", 9: "IX violent", 10: "X+ extreme"}

var roman = []string{"", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"}

func round(v float64, n int) float64 { p := math.Pow(10, float64(n)); return math.Round(v*p) / p }

func parseCoverage(b []byte) (*Raster, error) {
	var c coverage
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("shakemap coverage: %w", err)
	}
	r, ok := c.Ranges["MMI"]
	ax := c.Domain.Axes
	if !ok || ax.X.Num < 2 || ax.Y.Num < 2 || len(r.Values) != ax.X.Num*ax.Y.Num {
		return nil, fmt.Errorf("shakemap coverage: unexpected grid (%d x %d, %d values)", ax.X.Num, ax.Y.Num, len(r.Values))
	}
	if len(r.AxisNames) != 2 || r.AxisNames[0] != "y" || r.AxisNames[1] != "x" {
		return nil, fmt.Errorf("shakemap coverage: unexpected axis order %v", r.AxisNames)
	}
	dx := (ax.X.Stop - ax.X.Start) / float64(ax.X.Num-1)
	dy := (ax.Y.Stop - ax.Y.Start) / float64(ax.Y.Num-1)

	south, north := math.Min(ax.Y.Start, ax.Y.Stop)-math.Abs(dy)/2, math.Max(ax.Y.Start, ax.Y.Stop)+math.Abs(dy)/2
	out := &Raster{BBox: [4]float64{round(ax.X.Start-dx/2, 5), round(south, 5), round(ax.X.Stop+dx/2, 5), round(north, 5)},
		NX: ax.X.Num, NY: ax.Y.Num, Scale: 0.1, Values: make([]int, len(r.Values)), MinShown: 2, Unit: "MMI"}
	for j := 0; j < ax.Y.Num; j++ {
		src := j
		if dy > 0 {
			src = ax.Y.Num - 1 - j
		}
		for i := 0; i < ax.X.Num; i++ {
			if v := r.Values[src*ax.X.Num+i]; v != nil {
				out.Values[j*ax.X.Num+i] = int(math.Round(*v * 10))
			}
		}
	}
	pal := c.Parameters["MMI"].PreferredPalette
	if len(pal.Colors) >= 2 && len(pal.Extent) == 2 {
		for k, col := range pal.Colors {
			out.Ramp = append(out.Ramp, Stop{V: pal.Extent[0] + (pal.Extent[1]-pal.Extent[0])*float64(k)/float64(len(pal.Colors)-1), Color: strings.ReplaceAll(col, " ", "")})
		}
	}
	if len(out.Ramp) == 0 {
		return nil, fmt.Errorf("shakemap coverage: no colour palette in the file")
	}
	return out, nil
}

func rampColor(ramp []Stop, v float64) string {
	for _, s := range ramp {
		if s.V >= v {
			return s.Color
		}
	}
	return ramp[len(ramp)-1].Color
}

func (c *Client) get(ctx context.Context, u string) ([]byte, error) {
	b, _, err := c.HTTP.Get(ctx, u)
	return b, err
}

func (c *Client) build(ctx context.Context, id string) (*Bundle, error) {
	detailURL := c.Base + "?" + url.Values{"eventid": {id}, "format": {"geojson"}}.Encode()
	body, err := c.get(ctx, detailURL)
	if err != nil {
		var ue *fetch.UpstreamError
		if errors.As(err, &ue) && (ue.Status == http.StatusNotFound || ue.Status == http.StatusConflict || ue.Status == http.StatusNoContent) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	var d detail
	if err := json.Unmarshal(body, &d); err != nil || len(d.Geometry.Coordinates) < 3 {
		return nil, fmt.Errorf("usgs event detail: unexpected body")
	}
	now := c.Now().UTC().Format(time.RFC3339)
	p := d.Properties
	lon, lat, depth := d.Geometry.Coordinates[0], d.Geometry.Coordinates[1], d.Geometry.Coordinates[2]
	t0 := time.UnixMilli(p.Time).UTC()
	mag := "not given"
	if p.Mag != nil {
		mag = strconv.FormatFloat(*p.Mag, 'f', 1, 64)
	}
	b := &Bundle{Schema: 1, EventID: id, Category: "earthquakes", BuiltAt: now, Builder: "backend/internal/evidence (live from USGS)",
		Title: p.Title, Subtitle: t0.Format("2 January 2006, 15:04 UTC"),
		Association: "All layers are products that USGS publishes under this event id, except the later earthquakes: those are every catalogue event within " +
			strconv.Itoa(AfterRadiusKm) + " km and " + strconv.Itoa(AfterDays) + " days after the main shock, a fixed window chosen by this application. Being inside the window does not prove an earthquake is an aftershock.",
		Summary: []Measure{
			{Label: "Magnitude", Value: mag, Unit: p.MagType, Evidence: "observed", Note: "From the USGS catalogue (computed from seismograms)."},
			{Label: "Depth of the hypocentre", Value: strconv.FormatFloat(depth, 'f', 0, 64), Unit: "km", Evidence: "observed",
				Note: "Catalogue estimate with its own uncertainty; some depths are fixed defaults of the location method."},
		},
		Steps: []Step{}, Layers: []Layer{}, Unavailable: []Missing{}, Depth: &Depth{Km: depth}}

	sm := p.Products["shakemap"]
	if len(sm) == 0 {
		b.Unavailable = append(b.Unavailable, Missing{Label: "Shaking intensity map", Reason: "USGS has not published a ShakeMap for this earthquake, so no map of the shaking is available. " +
			"Only the catalogue facts are shown; the size of the shaken area cannot be drawn from the magnitude alone."})
	} else {
		prod := sm[0]
		version := prod.Properties["version"]
		processed := prod.Properties["process-timestamp"]
		smSource := func(file string) Source {
			return Source{Name: "USGS ShakeMap (" + prod.Source + ", version " + version + ", processed " + processed + ")", URL: prod.Contents[file].URL, Retrieved: now, Licence: "Public domain (U.S. Government)"}
		}
		var ras *Raster
		for _, file := range []string{"download/coverage_mmi_low_res.covjson", "download/coverage_mmi_medium_res.covjson"} {
			f, ok := prod.Contents[file]
			if !ok || f.Length > 2_000_000 {
				continue
			}
			cb, err := c.get(ctx, f.URL)
			if err != nil {
				return nil, err
			}
			if ras, err = parseCoverage(cb); err != nil {
				return nil, err
			}
			maxV := 0
			for _, v := range ras.Values {
				if v > maxV {
					maxV = v
				}
			}
			cell := (ras.BBox[3] - ras.BBox[1]) / float64(ras.NY)
			legend := []LegendItem{}
			for _, k := range []int{2, 4, 5, 6, 7, 8, 9, 10} {
				if float64(k) <= float64(maxV)/10+0.5 {
					legend = append(legend, LegendItem{Color: rampColor(ras.Ramp, float64(k)), Label: mmiNames[k]})
				}
			}
			b.Layers = append(b.Layers, Layer{ID: "shaking", Label: "Shaking intensity (USGS ShakeMap)", Short: "Shaking intensity", Icon: "shake", Kind: "raster", Evidence: "model", On: true,
				Raster: ras, Legend: legend, Source: smSource(file), Date: t0.Format("2006-01-02"),
				Resolution: fmt.Sprintf("Grid of %d × %d cells, %.3f° (about %.0f km)", ras.NX, ras.NY, cell, cell*111.2),
				Units:      "Modified Mercalli Intensity (MMI)",
				Uncertainty: "ShakeMap combines a ground-motion model with instrument records and felt reports where they exist; far from any station it is the model alone. " +
					"Status in the product: " + prod.Properties["map-status"] + ".",
				Note: "An estimate of how strongly the ground shook, not a measurement at every place and not a map of damage. Intensity below II (not felt) is left transparent and weak shaking is drawn fainter."})
			if m, err := strconv.ParseFloat(prod.Properties["maxmmi"], 64); err == nil {
				n := int(math.Round(m))
				if n >= 1 && n < len(roman) {
					b.Summary = append(b.Summary, Measure{Label: "Strongest estimated shaking", Value: roman[n], Unit: "MMI", Also: fmt.Sprintf("%.1f in the full-resolution grid", m), Evidence: "model",
						Note: "Highest Modified Mercalli Intensity in the USGS ShakeMap. It describes shaking, not confirmed damage."})
				}
			}
			b.View = &struct {
				BBox [4]float64 `json:"bbox"`
			}{BBox: shownBox(ras)}
			break
		}
		if ras == nil {
			b.Unavailable = append(b.Unavailable, Missing{Label: "Shaking intensity map", Reason: "USGS lists a ShakeMap for this earthquake, but not in the gridded format this application reads."})
		}
		if f, ok := prod.Contents["download/rupture.json"]; ok && f.Length < 500_000 {
			if rb, err := c.get(ctx, f.URL); err == nil {
				if l, top, base := ruptureLayer(rb); l != nil {
					l.Source = smSource("download/rupture.json")
					l.Date = t0.Format("2006-01-02")
					b.Layers = append(b.Layers, *l)
					b.Depth.RuptureTop, b.Depth.RuptureBase = top, base
				}
			}
		}
		if f, ok := prod.Contents["download/stationlist.json"]; ok && f.Length < 3_000_000 && ras != nil {
			if sb, err := c.get(ctx, f.URL); err == nil {
				for _, l := range stationLayers(sb, ras.BBox) {
					l.Source = smSource("download/stationlist.json")
					l.Date = t0.Format("2006-01-02")
					b.Layers = append(b.Layers, l)
				}
			}
		}
	}

	end := t0.Add(AfterDays * 24 * time.Hour)
	if now := c.Now().UTC(); end.After(now) {
		end = now
	}
	afterURL := c.Base + "?" + url.Values{"format": {"geojson"}, "starttime": {t0.Add(time.Second).Format("2006-01-02T15:04:05")}, "endtime": {end.Format("2006-01-02T15:04:05")},
		"latitude": {strconv.FormatFloat(lat, 'f', 4, 64)}, "longitude": {strconv.FormatFloat(lon, 'f', 4, 64)}, "maxradiuskm": {strconv.Itoa(AfterRadiusKm)},
		"minmagnitude": {strconv.FormatFloat(AfterMinMag, 'f', 1, 64)}, "orderby": {"time-asc"}, "limit": {strconv.Itoa(AfterLimit)}}.Encode()
	if ab, err := c.get(ctx, afterURL); err != nil {
		b.Unavailable = append(b.Unavailable, Missing{Label: "Later earthquakes nearby", Reason: "The USGS catalogue search did not answer."})
	} else if evs, err := quakes.Parse(ab); err == nil {
		pts := &Points{T0: p.Time, VLabel: "Magnitude", VUnit: "M", SizeBy: "v"}
		largest := 0.0
		for _, e := range evs {
			et, err := time.Parse(time.RFC3339, e.Time)
			if err != nil || e.ID == id || e.Mag == nil {
				continue
			}
			pts.TMin = append(pts.TMin, int(math.Round(et.Sub(t0).Minutes())))
			pts.Lon = append(pts.Lon, round(e.Lon, 4))
			pts.Lat = append(pts.Lat, round(e.Lat, 4))
			pts.V = append(pts.V, *e.Mag)
			pts.Text = append(pts.Text, e.ID)
			largest = math.Max(largest, *e.Mag)
		}
		n := len(pts.Lon)
		note := "Catalogue earthquakes inside a fixed window after the main shock. Small earthquakes are missing where the seismic network is sparse."
		if n >= AfterLimit {
			note += " The list was cut at " + strconv.Itoa(AfterLimit) + " events."
		}
		if n > 0 {
			b.Layers = append(b.Layers, Layer{ID: "after", Label: "Later earthquakes nearby (USGS catalogue)", Short: "Aftershocks", Icon: "dots", Kind: "points", Evidence: "observed", On: true, Time: "cumulative",
				Color: "#f0abfc", Size: 5, Points: pts,
				Legend:      []LegendItem{{Color: "#f0abfc", Label: fmt.Sprintf("M ≥ %.1f within %d km, first %d days (bigger dot = larger magnitude)", AfterMinMag, AfterRadiusKm, AfterDays)}},
				Source:      Source{Name: "USGS ANSS Comprehensive Earthquake Catalog (ComCat)", URL: afterURL, Retrieved: now, Licence: "Public domain (U.S. Government)"},
				Date:        t0.Format("2006-01-02") + " to " + end.Format("2006-01-02"),
				Resolution:  "Epicentres located from seismograms, usually within a few km to tens of km",
				Units:       "Magnitude",
				Uncertainty: "Location and depth uncertainties vary by event; the catalogue is incomplete for small magnitudes.",
				Note:        note})
			b.Summary = append(b.Summary, Measure{Label: "Later earthquakes nearby", Value: strconv.Itoa(n), Unit: "", Also: fmt.Sprintf("largest M %.1f · %d km, %d days", largest, AfterRadiusKm, AfterDays), Evidence: "observed",
				Note: "Catalogue events of magnitude " + strconv.FormatFloat(AfterMinMag, 'f', 1, 64) + " or more inside the search window."})
			b.Steps = append(b.Steps, Step{T: p.Time, Label: "Main shock"})
			last := pts.TMin[n-1]
			for day := 1; day <= AfterDays; day++ {
				b.Steps = append(b.Steps, Step{T: p.Time + int64(day)*86_400_000, Label: "Day " + strconv.Itoa(day)})
				if day*1440 > last {
					break
				}
			}
			b.StepsLabel = "Earthquakes up to"
		} else {
			b.Unavailable = append(b.Unavailable, Missing{Label: "Later earthquakes nearby", Reason: fmt.Sprintf("The USGS catalogue lists no earthquake of magnitude %.1f or more within %d km in the %d days after the main shock.", AfterMinMag, AfterRadiusKm, AfterDays)})
		}
	}
	return b, nil
}

func shownBox(r *Raster) [4]float64 {
	minI, maxI, minJ, maxJ := r.NX, -1, r.NY, -1
	thr := int(math.Max(r.MinShown, 4) * 10)
	for pass := 0; pass < 2 && maxI < 0; pass++ {
		for j := 0; j < r.NY; j++ {
			for i := 0; i < r.NX; i++ {
				if r.Values[j*r.NX+i] >= thr {
					minI, maxI = min(minI, i), max(maxI, i)
					minJ, maxJ = min(minJ, j), max(maxJ, j)
				}
			}
		}
		thr = int(r.MinShown * 10)
	}
	if maxI < 0 {
		return r.BBox
	}
	dx, dy := (r.BBox[2]-r.BBox[0])/float64(r.NX), (r.BBox[3]-r.BBox[1])/float64(r.NY)
	return [4]float64{round(r.BBox[0]+float64(minI)*dx, 4), round(r.BBox[3]-float64(maxJ+1)*dy, 4), round(r.BBox[0]+float64(maxI+1)*dx, 4), round(r.BBox[3]-float64(minJ)*dy, 4)}
}

func ruptureLayer(b []byte) (*Layer, *float64, *float64) {
	var g struct {
		Metadata struct {
			Reference string `json:"reference"`
		} `json:"metadata"`
		Features []struct {
			Geometry struct {
				Type        string          `json:"type"`
				Coordinates json.RawMessage `json:"coordinates"`
			} `json:"geometry"`
		} `json:"features"`
	}
	if json.Unmarshal(b, &g) != nil {
		return nil, nil, nil
	}
	var polys [][][][]float64
	top, base := math.Inf(1), math.Inf(-1)
	for _, f := range g.Features {
		if f.Geometry.Type != "MultiPolygon" {
			continue
		}
		var mp [][][][]float64
		if json.Unmarshal(f.Geometry.Coordinates, &mp) != nil {
			continue
		}
		for _, poly := range mp {
			var rings [][][]float64
			for _, ring := range poly {
				var out [][]float64
				for _, v := range ring {
					if len(v) < 2 {
						continue
					}
					out = append(out, []float64{round(v[0], 4), round(v[1], 4)})
					if len(v) > 2 {
						top, base = math.Min(top, v[2]), math.Max(base, v[2])
					}
				}
				if len(out) >= 4 {
					rings = append(rings, out)
				}
			}
			if len(rings) > 0 {
				polys = append(polys, rings)
			}
		}
	}
	if len(polys) == 0 {
		return nil, nil, nil
	}
	no := false
	ref := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(g.Metadata.Reference), "Reference:"))
	l := &Layer{ID: "rupture", Label: "Fault rupture used by ShakeMap", Short: "Rupture", Icon: "fault", Kind: "polygons", Evidence: "model", On: true, Fill: &no,
		Color: "#ffffff", Polygons: polys, Legend: []LegendItem{{Color: "#ffffff", Label: "Outline of the fault plane, seen from above"}},
		Resolution: "A few corner points", Units: "", Uncertainty: "A simplified fault model; the real rupture is not a flat rectangle.",
		Note: "The piece of the fault that slipped, as modelled" + map[bool]string{true: " (" + ref + ")", false: ""}[ref != ""] + ". It lies underground: the outline is its projection onto the surface."}
	if math.IsInf(top, 0) {
		return l, nil, nil
	}
	return l, &top, &base
}

func stationLayers(b []byte, box [4]float64) []Layer {
	var g struct {
		Features []struct {
			Properties struct {
				StationType string          `json:"station_type"`
				Intensity   json.RawMessage `json:"intensity"`
				Name        *string         `json:"name"`
				Code        string          `json:"code"`
			} `json:"properties"`
			Geometry struct {
				Coordinates []float64 `json:"coordinates"`
			} `json:"geometry"`
		} `json:"features"`
	}
	if json.Unmarshal(b, &g) != nil {
		return nil
	}
	inst, felt := &Points{VLabel: "Intensity", VUnit: "MMI"}, &Points{VLabel: "Reported intensity", VUnit: "MMI"}
	for _, f := range g.Features {
		c := f.Geometry.Coordinates
		if len(c) < 2 || c[0] < box[0] || c[0] > box[2] || c[1] < box[1] || c[1] > box[3] {
			continue
		}
		var v float64
		if json.Unmarshal(f.Properties.Intensity, &v) != nil {
			continue
		}
		dst := inst
		if f.Properties.StationType == "macroseismic" {
			dst = felt
		}
		dst.Lon, dst.Lat, dst.V = append(dst.Lon, round(c[0], 4)), append(dst.Lat, round(c[1], 4)), append(dst.V, round(v, 1))
	}
	var out []Layer
	if n := len(inst.Lon); n > 0 {
		out = append(out, Layer{ID: "stations", Label: "Seismic stations (measured)", Short: "Stations", Icon: "station", Kind: "points", Evidence: "observed", On: true, Color: "#22d3ee", Size: 7, Points: inst,
			Legend: []LegendItem{{Color: "#22d3ee", Label: fmt.Sprintf("%d instruments that recorded the shaking", n)}}, Resolution: "Point measurements", Units: "MMI converted from recorded ground motion",
			Uncertainty: "Instrument records; the conversion to intensity adds uncertainty.", Note: "Places where instruments measured the ground motion. Between them the map is an estimate."})
	}
	if n := len(felt.Lon); n > 0 {
		out = append(out, Layer{ID: "felt", Label: "Felt reports (Did You Feel It?)", Short: "Felt reports", Icon: "station", Kind: "points", Evidence: "observed", On: true, Color: "#a7f3d0", Size: 7, Points: felt,
			Legend: []LegendItem{{Color: "#a7f3d0", Label: fmt.Sprintf("%d places with intensity reported by people", n)}}, Resolution: "One value per town or postal area", Units: "MMI from questionnaires",
			Uncertainty: "Reports by volunteers, averaged by area; few reports make a value uncertain.", Note: "What people reported feeling, collected by USGS. These are direct reports, unlike the modelled map."})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out
}

func (c *Client) Earthquake(ctx context.Context, id string) (*Bundle, error) {
	if !ValidQuakeID(id) {
		return nil, ErrNotFound
	}
	raw, origin, err := c.Cache.Load(ctx, "evidence/earthquake/"+id, func(ctx context.Context) ([]byte, error) {
		b, err := c.build(ctx, id)
		if err != nil {
			return nil, err
		}
		return json.Marshal(b)
	})
	if err != nil {
		return nil, err
	}
	var b Bundle
	if err := json.Unmarshal(raw, &b); err != nil {
		return nil, err
	}
	if origin == cache.Stale {
		b.Stale = true
		b.Notes = append(b.Notes, "USGS is unavailable. Showing the evidence retrieved at "+b.BuiltAt+".")
	}
	return &b, nil
}
