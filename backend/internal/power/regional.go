package power

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strconv"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/cache"
	"github.com/stellify/earth-explorer/backend/internal/series"
)

const MaxRegionalSpan = 10.0

type Cell struct {
	Lat    float64    `json:"lat"`
	Lon    float64    `json:"lon"`
	Months []*float64 `json:"months"`
	Annual *float64   `json:"annual"`
}

type Grid struct {
	Year       int               `json:"year"`
	Units      string            `json:"units"`
	Bbox       [4]float64        `json:"bbox"`
	DLat       float64           `json:"dlat"`
	DLon       float64           `json:"dlon"`
	Cells      []Cell            `json:"cells"`
	Provenance series.Provenance `json:"provenance"`
}

type regionalResp struct {
	Features []struct {
		Geometry struct {
			Coordinates []float64 `json:"coordinates"`
		} `json:"geometry"`
		Properties struct {
			Parameter map[string]map[string]float64 `json:"parameter"`
		} `json:"properties"`
	} `json:"features"`
	Header struct {
		API struct {
			Version string `json:"version"`
			Name    string `json:"name"`
		} `json:"api"`
		Sources   []string `json:"sources"`
		FillValue float64  `json:"fill_value"`
	} `json:"header"`
	Messages   []string `json:"messages"`
	Parameters map[string]struct {
		Units    string `json:"units"`
		Longname string `json:"longname"`
	} `json:"parameters"`
}

func (c *Client) RegionalURL(param string, latMin, latMax, lonMin, lonMax float64, year int) string {
	q := url.Values{}
	q.Set("parameters", param)
	q.Set("community", "AG")
	q.Set("latitude-min", strconv.FormatFloat(latMin, 'f', 2, 64))
	q.Set("latitude-max", strconv.FormatFloat(latMax, 'f', 2, 64))
	q.Set("longitude-min", strconv.FormatFloat(lonMin, 'f', 2, 64))
	q.Set("longitude-max", strconv.FormatFloat(lonMax, 'f', 2, 64))
	q.Set("start", strconv.Itoa(year))
	q.Set("end", strconv.Itoa(year))
	q.Set("format", "JSON")
	return c.Base + "/api/temporal/monthly/regional?" + q.Encode()
}

func RegionBox(lat, lon float64) (latMin, latMax, lonMin, lonMax float64) {
	h := MaxRegionalSpan / 2
	latMin, latMax = math.Round(lat)-h, math.Round(lat)+h
	if latMin < -90 {
		latMin, latMax = -90, -90+MaxRegionalSpan
	}
	if latMax > 90 {
		latMin, latMax = 90-MaxRegionalSpan, 90
	}
	lonMin, lonMax = math.Round(lon)-h, math.Round(lon)+h
	if lonMin < -180 {
		lonMin, lonMax = -180, -180+MaxRegionalSpan
	}
	if lonMax > 180 {
		lonMin, lonMax = 180-MaxRegionalSpan, 180
	}
	return
}

func (c *Client) Regional(ctx context.Context, param, expectUnits string, latMin, latMax, lonMin, lonMax float64, year int) (*Grid, error) {
	if latMax-latMin > MaxRegionalSpan+1e-9 || lonMax-lonMin > MaxRegionalSpan+1e-9 {
		return nil, fmt.Errorf("power: regional box larger than %g degrees", MaxRegionalSpan)
	}
	u := c.RegionalURL(param, latMin, latMax, lonMin, lonMax, year)
	body, origin, err := c.Cache.Load(ctx, u, func(ctx context.Context) ([]byte, error) {
		b, _, err := c.HTTP.Get(ctx, u)
		if err != nil {
			return nil, err
		}
		wrapped, _ := json.Marshal(map[string]any{"retrieved_at": c.Now().UTC().Format(time.RFC3339), "body": json.RawMessage(b)})
		return wrapped, nil
	})
	if err != nil {
		return nil, err
	}
	var w struct {
		RetrievedAt string          `json:"retrieved_at"`
		Body        json.RawMessage `json:"body"`
	}
	if err := json.Unmarshal(body, &w); err != nil {
		return nil, err
	}
	g, err := ParseRegional(w.Body, param, expectUnits, year)
	if err != nil {
		return nil, err
	}
	g.Bbox = [4]float64{latMin, latMax, lonMin, lonMax}
	g.Provenance.RequestURL, g.Provenance.RetrievedAt = u, w.RetrievedAt
	g.Provenance.FromCache, g.Provenance.Stale = origin != cache.Fresh, origin == cache.Stale
	return g, nil
}

func ParseRegional(body []byte, param, expectUnits string, year int) (*Grid, error) {
	var r regionalResp
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, fmt.Errorf("power: decode regional: %w", err)
	}
	if len(r.Features) == 0 {
		return nil, fmt.Errorf("power: regional response has no features (messages: %v)", r.Messages)
	}
	units := r.Parameters[param].Units
	if expectUnits != "" && units != expectUnits {
		return nil, fmt.Errorf("%w: %s returned %q, expected %q", ErrUnitMismatch, param, units, expectUnits)
	}
	fill := r.Header.FillValue
	if fill == 0 {
		fill = -999
	}
	g := &Grid{Year: year, Units: units}
	lats, lons := map[float64]bool{}, map[float64]bool{}
	for _, f := range r.Features {
		if len(f.Geometry.Coordinates) < 2 {
			continue
		}
		vals := f.Properties.Parameter[param]
		cell := Cell{Lon: f.Geometry.Coordinates[0], Lat: f.Geometry.Coordinates[1], Months: make([]*float64, 12)}
		sum, n := 0.0, 0
		for m := 1; m <= 12; m++ {
			v, ok := vals[fmt.Sprintf("%04d%02d", year, m)]
			if ok && v != fill && !math.IsNaN(v) {
				vv := v
				cell.Months[m-1] = &vv
				sum += v
				n++
			}
		}
		if n == 12 {
			a := sum / 12
			cell.Annual = &a
		}
		lats[cell.Lat], lons[cell.Lon] = true, true
		g.Cells = append(g.Cells, cell)
	}
	g.DLat, g.DLon = minStep(lats), minStep(lons)
	g.Provenance = series.Provenance{Provider: "NASA POWER", APIName: r.Header.API.Name, APIVersion: r.Header.API.Version,
		UpstreamSources: r.Header.Sources, Parameter: param, LongName: r.Parameters[param].Longname, Messages: r.Messages}
	return g, nil
}

func minStep(set map[float64]bool) float64 {
	xs := make([]float64, 0, len(set))
	for x := range set {
		xs = append(xs, x)
	}
	sort.Float64s(xs)
	best := math.Inf(1)
	for i := 1; i < len(xs); i++ {
		if d := xs[i] - xs[i-1]; d > 1e-9 && d < best {
			best = d
		}
	}
	if math.IsInf(best, 1) {
		return 0
	}
	return best
}
