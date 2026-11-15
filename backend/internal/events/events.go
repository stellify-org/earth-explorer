package events

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/cache"
	"github.com/stellify/earth-explorer/backend/internal/fetch"
)

const DefaultBase = "https://eonet.gsfc.nasa.gov/api/v3/events"

const MaxDays = 366

const SourceName = "NASA EONET v3 (Earth Observatory Natural Event Tracker), NASA Goddard Space Flight Center"

var (
	idRE       = regexp.MustCompile(`^EONET_\d{1,9}$`)
	categoryRE = regexp.MustCompile(`^[A-Za-z]{1,24}(,[A-Za-z]{1,24}){0,12}$`)
)

func ValidID(id string) bool { return idRE.MatchString(id) }

type Fix struct {
	Lon  float64  `json:"lon"`
	Lat  float64  `json:"lat"`
	Date string   `json:"date"`
	Mag  *float64 `json:"mag,omitempty"`
	Unit string   `json:"unit,omitempty"`
}

type Source struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

type Event struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Category      string `json:"category"`
	CategoryTitle string `json:"category_title"`

	Categories []string `json:"categories"`

	Closed string `json:"closed,omitempty"`

	Start string `json:"start"`
	End   string `json:"end"`

	Lon      float64 `json:"lon"`
	Lat      float64 `json:"lat"`
	Position string  `json:"position"`
	Geometry string  `json:"geometry"`

	Mag     *float64 `json:"mag,omitempty"`
	MagMax  *float64 `json:"mag_max,omitempty"`
	MagUnit string   `json:"mag_unit,omitempty"`

	Track []Fix `json:"track,omitempty"`

	PolygonCount    int             `json:"polygon_count,omitempty"`
	PolygonVertices int             `json:"polygon_vertices,omitempty"`
	BBox            *[4]float64     `json:"bbox,omitempty"`
	Polygons        [][][][]float64 `json:"polygons,omitempty"`
	Sources         []Source        `json:"sources"`
	Link            string          `json:"link"`
}

type Category struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Count int    `json:"count"`
}

type List struct {
	Events     []Event    `json:"events"`
	Count      int        `json:"count"`
	Days       int        `json:"days"`
	Categories []Category `json:"categories"`
	RequestURL string     `json:"request_url"`
	Retrieved  string     `json:"retrieved_at"`
	Stale      bool       `json:"stale"`
	Source     string     `json:"source"`
	Notes      []string   `json:"notes"`
}

type Detail struct {
	Event      Event    `json:"event"`
	RequestURL string   `json:"request_url"`
	Retrieved  string   `json:"retrieved_at"`
	Stale      bool     `json:"stale"`
	Source     string   `json:"source"`
	Notes      []string `json:"notes"`
}

var Notes = []string{
	"EONET is a curated catalogue: it lists events that agencies reported, not every event that happened. Counts over time or by region are not a measure of how often such events occur.",
	"Geometry is shown as the source reported it: a point, dated positions, or an outline. No extent, perimeter or path is added.",
	"Magnitude values and units are the source's (for example acres or hectares for fires, knots for storms) and are not converted.",
}

type rawEvent struct {
	ID         string  `json:"id"`
	Title      string  `json:"title"`
	Link       string  `json:"link"`
	Closed     *string `json:"closed"`
	Categories []struct {
		ID    string `json:"id"`
		Title string `json:"title"`
	} `json:"categories"`
	Sources  []Source `json:"sources"`
	Geometry []struct {
		MagnitudeValue *float64        `json:"magnitudeValue"`
		MagnitudeUnit  *string         `json:"magnitudeUnit"`
		Date           string          `json:"date"`
		Type           string          `json:"type"`
		Coordinates    json.RawMessage `json:"coordinates"`
	} `json:"geometry"`
}

func validLonLat(lon, lat float64) bool {
	return lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90
}

func normalise(r rawEvent, withPolygons bool) (Event, bool) {
	e := Event{ID: r.ID, Title: strings.TrimSpace(r.Title), Link: r.Link, Sources: r.Sources}
	if e.Sources == nil {
		e.Sources = []Source{}
	}
	e.Categories = []string{}
	for _, c := range r.Categories {
		e.Categories = append(e.Categories, c.ID)
	}
	if len(r.Categories) > 0 {
		e.Category, e.CategoryTitle = r.Categories[0].ID, r.Categories[0].Title
	}
	if r.Closed != nil {
		e.Closed = *r.Closed
	}
	var fixes []Fix
	var polys [][][][]float64
	var dates []string
	w, s, east, n := 180.0, 90.0, -180.0, -90.0
	for _, g := range r.Geometry {
		switch g.Type {
		case "Point":
			var c []float64
			if json.Unmarshal(g.Coordinates, &c) != nil || len(c) < 2 || !validLonLat(c[0], c[1]) {
				continue
			}
			f := Fix{Lon: c[0], Lat: c[1], Date: g.Date, Mag: g.MagnitudeValue}
			if g.MagnitudeUnit != nil {
				f.Unit = *g.MagnitudeUnit
			}
			fixes = append(fixes, f)
			dates = append(dates, g.Date)
		case "Polygon":
			var rings [][][]float64
			if json.Unmarshal(g.Coordinates, &rings) != nil {
				continue
			}
			var keep [][][]float64
			for _, ring := range rings {
				good := len(ring) >= 4
				for _, p := range ring {
					if len(p) < 2 || !validLonLat(p[0], p[1]) {
						good = false
						break
					}
				}
				if !good {
					continue
				}
				for _, p := range ring {
					w, east = min(w, p[0]), max(east, p[0])
					s, n = min(s, p[1]), max(n, p[1])
				}
				e.PolygonVertices += len(ring)
				keep = append(keep, ring)
			}
			if len(keep) == 0 {
				continue
			}
			polys = append(polys, keep)
			dates = append(dates, g.Date)
			if g.MagnitudeValue != nil && e.Mag == nil {
				e.Mag = g.MagnitudeValue
				if g.MagnitudeUnit != nil {
					e.MagUnit = *g.MagnitudeUnit
				}
			}
		}
	}
	if len(dates) == 0 {
		return e, false
	}
	sort.Strings(dates)
	e.Start, e.End = dates[0], dates[len(dates)-1]
	sort.SliceStable(fixes, func(i, j int) bool { return fixes[i].Date < fixes[j].Date })
	for _, f := range fixes {
		if f.Mag == nil {
			continue
		}
		e.Mag, e.MagUnit = f.Mag, f.Unit
		if e.MagMax == nil || *f.Mag > *e.MagMax {
			v := *f.Mag
			e.MagMax = &v
		}
	}
	e.PolygonCount = len(polys)
	if len(polys) > 0 {
		e.BBox = &[4]float64{w, s, east, n}
		if withPolygons {
			e.Polygons = polys
		}
	}
	switch {
	case len(fixes) > 1:
		last := fixes[len(fixes)-1]
		e.Geometry, e.Position, e.Lon, e.Lat, e.Track = "track", "latest_reported_point", last.Lon, last.Lat, fixes
	case len(fixes) == 1:
		e.Geometry, e.Position, e.Lon, e.Lat = "point", "reported_point", fixes[0].Lon, fixes[0].Lat
	default:
		e.Geometry, e.Position, e.Lon, e.Lat = "polygon", "polygon_bbox_centre", (w+east)/2, (s+n)/2
	}
	return e, true
}

func ParseList(b []byte) ([]Event, error) {
	var raw struct {
		Events []rawEvent `json:"events"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, fmt.Errorf("eonet: decode: %w", err)
	}
	if raw.Events == nil {
		return nil, fmt.Errorf("eonet: response has no events list")
	}
	out := make([]Event, 0, len(raw.Events))
	for _, r := range raw.Events {
		if e, ok := normalise(r, false); ok {
			out = append(out, e)
		}
	}

	sort.SliceStable(out, func(i, j int) bool { return out[i].End > out[j].End })
	return out, nil
}

func ParseDetail(b []byte) (*Event, error) {
	var r rawEvent
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, fmt.Errorf("eonet: decode: %w", err)
	}
	e, ok := normalise(r, true)
	if !ok || e.ID == "" {
		return nil, fmt.Errorf("eonet: event has no usable geometry")
	}
	return &e, nil
}

type Client struct {
	Base  string
	HTTP  *fetch.Client
	Cache *cache.Cache
	Now   func() time.Time
}

func (c *Client) ListURL(days int, category string) string {
	v := url.Values{}
	v.Set("status", "all")
	v.Set("days", strconv.Itoa(days))
	if category != "" {
		v.Set("category", category)
	}
	return c.Base + "?" + v.Encode()
}

type stored struct {
	Events    []Event `json:"events,omitempty"`
	Event     *Event  `json:"event,omitempty"`
	Retrieved string  `json:"retrieved_at"`
}

func (c *Client) load(ctx context.Context, u string, parse func([]byte) (stored, error)) (stored, bool, error) {
	var st stored
	b, origin, err := c.Cache.Load(ctx, u, func(ctx context.Context) ([]byte, error) {
		body, _, err := c.HTTP.Get(ctx, u)
		if err != nil {
			return nil, err
		}
		s, err := parse(body)
		if err != nil {
			return nil, err
		}
		s.Retrieved = c.Now().UTC().Format(time.RFC3339)
		return json.Marshal(s)
	})
	if err != nil {
		return st, false, err
	}
	if err := json.Unmarshal(b, &st); err != nil {
		return st, false, err
	}
	return st, origin == cache.Stale, nil
}

func (c *Client) Search(ctx context.Context, days int, category string) (*List, error) {
	if days < 1 || days > MaxDays {
		return nil, fmt.Errorf("days must be between 1 and %d", MaxDays)
	}
	if category != "" && !categoryRE.MatchString(category) {
		return nil, fmt.Errorf("category must be a comma-separated list of EONET category ids")
	}
	u := c.ListURL(days, category)
	st, stale, err := c.load(ctx, u, func(b []byte) (stored, error) {
		ev, err := ParseList(b)
		return stored{Events: ev}, err
	})
	if err != nil {
		return nil, err
	}
	if st.Events == nil {
		st.Events = []Event{}
	}
	res := &List{Events: st.Events, Count: len(st.Events), Days: days, RequestURL: u, Retrieved: st.Retrieved,
		Stale: stale, Source: SourceName, Notes: append([]string{}, Notes...), Categories: []Category{}}
	idx := map[string]int{}
	for _, e := range st.Events {
		i, ok := idx[e.Category]
		if !ok {
			i = len(res.Categories)
			idx[e.Category] = i
			res.Categories = append(res.Categories, Category{ID: e.Category, Title: e.CategoryTitle})
		}
		res.Categories[i].Count++
	}
	sort.SliceStable(res.Categories, func(i, j int) bool { return res.Categories[i].Count > res.Categories[j].Count })
	if stale {
		res.Notes = append(res.Notes, "NASA EONET is unavailable. Showing the list retrieved at "+st.Retrieved+"; events may have been added or closed since.")
	}
	return res, nil
}

func (c *Client) Get(ctx context.Context, id string) (*Detail, error) {
	if !ValidID(id) {
		return nil, fmt.Errorf("id must look like EONET_12345")
	}
	u := c.Base + "/" + id
	st, stale, err := c.load(ctx, u, func(b []byte) (stored, error) {
		e, err := ParseDetail(b)
		return stored{Event: e}, err
	})
	if err != nil {
		return nil, err
	}
	if st.Event == nil {
		return nil, fmt.Errorf("eonet: empty event record")
	}
	return &Detail{Event: *st.Event, RequestURL: u, Retrieved: st.Retrieved, Stale: stale, Source: SourceName, Notes: append([]string{}, Notes...)}, nil
}
