package power

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strconv"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/cache"
	"github.com/stellify/earth-explorer/backend/internal/fetch"
	"github.com/stellify/earth-explorer/backend/internal/series"
)

const DefaultBase = "https://power.larc.nasa.gov"

const FirstYear = 1981

type Client struct {
	Base  string
	HTTP  *fetch.Client
	Cache *cache.Cache
	Now   func() time.Time
}

func (c *Client) LastCompleteYear() int { return c.Now().UTC().Year() - 1 }

type response struct {
	Geometry struct {
		Coordinates []float64 `json:"coordinates"`
	} `json:"geometry"`
	Properties struct {
		Parameter map[string]map[string]float64 `json:"parameter"`
	} `json:"properties"`
	Header struct {
		Title string `json:"title"`
		API   struct {
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

var ErrUnitMismatch = errors.New("power: unexpected units in response")

func (c *Client) URL(param string, lat, lon float64, start, end int) string {
	q := url.Values{}
	q.Set("parameters", param)
	q.Set("community", "AG")
	q.Set("latitude", strconv.FormatFloat(lat, 'f', 4, 64))
	q.Set("longitude", strconv.FormatFloat(lon, 'f', 4, 64))
	q.Set("start", strconv.Itoa(start))
	q.Set("end", strconv.Itoa(end))
	q.Set("format", "JSON")
	return c.Base + "/api/temporal/monthly/point?" + q.Encode()
}

func (c *Client) MonthlyPoint(ctx context.Context, param, expectUnits string, lat, lon float64, start, end int) (*series.Monthly, error) {
	u := c.URL(param, lat, lon, start, end)
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
		return nil, fmt.Errorf("power: decode cache wrapper: %w", err)
	}
	s, err := Parse(w.Body, param, expectUnits)
	if err != nil {
		return nil, err
	}
	s.Provenance.RequestURL = u
	s.Provenance.RetrievedAt = w.RetrievedAt
	s.Provenance.FromCache = origin != cache.Fresh
	s.Provenance.Stale = origin == cache.Stale
	return s, nil
}

func Parse(body []byte, param, expectUnits string) (*series.Monthly, error) {
	var r response
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, fmt.Errorf("power: decode: %w", err)
	}
	vals, ok := r.Properties.Parameter[param]
	if !ok {
		return nil, fmt.Errorf("power: parameter %s missing in response (messages: %v)", param, r.Messages)
	}
	units := r.Parameters[param].Units
	if expectUnits != "" && units != expectUnits {
		return nil, fmt.Errorf("%w: %s returned %q, expected %q", ErrUnitMismatch, param, units, expectUnits)
	}
	fill := r.Header.FillValue
	if fill == 0 {
		fill = -999
	}
	keys := make([]string, 0, len(vals))
	for k := range vals {
		if len(k) == 6 && k[4:] != "13" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	s := &series.Monthly{Units: units}
	for _, k := range keys {
		y, err1 := strconv.Atoi(k[:4])
		m, err2 := strconv.Atoi(k[4:])
		if err1 != nil || err2 != nil || m < 1 || m > 12 {
			continue
		}
		v := vals[k]
		if v == fill || math.IsNaN(v) {
			v = math.NaN()
		}
		s.Year = append(s.Year, y)
		s.Month = append(s.Month, m)
		s.Value = append(s.Value, v)
	}
	if len(s.Value) == 0 {
		return nil, fmt.Errorf("power: no monthly values for %s", param)
	}
	if len(r.Geometry.Coordinates) >= 3 {
		e := r.Geometry.Coordinates[2]
		s.ElevationM = &e
	}
	s.Provenance = series.Provenance{
		Provider:        "NASA POWER",
		APIVersion:      r.Header.API.Version,
		APIName:         r.Header.API.Name,
		UpstreamSources: r.Header.Sources,
		Parameter:       param,
		LongName:        r.Parameters[param].Longname,
		Messages:        r.Messages,
	}
	return s, nil
}
