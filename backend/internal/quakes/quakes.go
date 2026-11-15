package quakes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/cache"
	"github.com/stellify/earth-explorer/backend/internal/fetch"
)

const DefaultBase = "https://earthquake.usgs.gov/fdsnws/event/1/query"

const MaxLimit = 20000

type Query struct {
	MinLat, MaxLat, MinLon, MaxLon float64
	Start, End                     time.Time
	MinMag                         float64
	Limit                          int
}

func (q *Query) Validate() error {
	if q.MinLat < -90 || q.MaxLat > 90 || q.MinLat >= q.MaxLat {
		return fmt.Errorf("latitude bounds must satisfy -90 <= minlat < maxlat <= 90")
	}

	if q.MinLon < -360 || q.MaxLon > 360 || q.MinLon >= q.MaxLon {
		return fmt.Errorf("longitude bounds must satisfy -360 <= minlon < maxlon <= 360")
	}
	if !q.Start.Before(q.End) {
		return fmt.Errorf("start must be before end")
	}
	if q.Start.Year() < 1900 {
		return fmt.Errorf("start must be 1900 or later")
	}
	if q.MinMag < -1 || q.MinMag > 10 {
		return fmt.Errorf("minmagnitude must be between -1 and 10")
	}
	if q.Limit <= 0 {
		q.Limit = 2000
	}
	if q.Limit > MaxLimit {
		return fmt.Errorf("limit must be <= %d", MaxLimit)
	}
	return nil
}

type Event struct {
	ID      string   `json:"id"`
	Lat     float64  `json:"lat"`
	Lon     float64  `json:"lon"`
	DepthKm float64  `json:"depth_km"`
	Mag     *float64 `json:"mag"`
	MagType string   `json:"mag_type"`
	Time    string   `json:"time"`
	Place   string   `json:"place"`
	Status  string   `json:"status"`
	Type    string   `json:"type"`
	URL     string   `json:"url"`
}

type Result struct {
	Events     []Event  `json:"events"`
	Count      int      `json:"count"`
	Limit      int      `json:"limit"`
	Truncated  bool     `json:"possibly_truncated"`
	OrderedBy  string   `json:"ordered_by"`
	RequestURL string   `json:"request_url"`
	Retrieved  string   `json:"retrieved_at"`
	Stale      bool     `json:"stale"`
	Source     string   `json:"source"`
	Notes      []string `json:"notes"`
}

type Client struct {
	Base  string
	HTTP  *fetch.Client
	Cache *cache.Cache
	Now   func() time.Time
}

func (c *Client) URL(q Query) string {
	v := url.Values{}
	v.Set("format", "geojson")
	v.Set("starttime", q.Start.UTC().Format("2006-01-02T15:04:05"))
	v.Set("endtime", q.End.UTC().Format("2006-01-02T15:04:05"))
	v.Set("minlatitude", strconv.FormatFloat(q.MinLat, 'f', 4, 64))
	v.Set("maxlatitude", strconv.FormatFloat(q.MaxLat, 'f', 4, 64))
	v.Set("minlongitude", strconv.FormatFloat(q.MinLon, 'f', 4, 64))
	v.Set("maxlongitude", strconv.FormatFloat(q.MaxLon, 'f', 4, 64))
	v.Set("minmagnitude", strconv.FormatFloat(q.MinMag, 'f', 1, 64))
	v.Set("orderby", "magnitude")
	v.Set("limit", strconv.Itoa(q.Limit))
	return c.Base + "?" + v.Encode()
}

type geo struct {
	Features []struct {
		ID         string `json:"id"`
		Properties struct {
			Mag     *float64 `json:"mag"`
			Place   string   `json:"place"`
			Time    int64    `json:"time"`
			URL     string   `json:"url"`
			Status  string   `json:"status"`
			Type    string   `json:"type"`
			MagType string   `json:"magType"`
		} `json:"properties"`
		Geometry struct {
			Coordinates []float64 `json:"coordinates"`
		} `json:"geometry"`
	} `json:"features"`
}

func Parse(b []byte) ([]Event, error) {
	var g geo
	if err := json.Unmarshal(b, &g); err != nil {
		return nil, fmt.Errorf("usgs: decode: %w", err)
	}
	out := make([]Event, 0, len(g.Features))
	for _, f := range g.Features {
		if len(f.Geometry.Coordinates) < 3 {
			continue
		}
		p := f.Properties
		out = append(out, Event{
			ID: f.ID, Lon: f.Geometry.Coordinates[0], Lat: f.Geometry.Coordinates[1], DepthKm: f.Geometry.Coordinates[2],
			Mag: p.Mag, MagType: p.MagType, Place: p.Place, Status: p.Status, Type: p.Type, URL: p.URL,
			Time: time.UnixMilli(p.Time).UTC().Format(time.RFC3339),
		})
	}
	return out, nil
}

func (c *Client) Search(ctx context.Context, q Query) (*Result, error) {
	if err := q.Validate(); err != nil {
		return nil, err
	}
	u := c.URL(q)
	b, origin, err := c.Cache.Load(ctx, u, func(ctx context.Context) ([]byte, error) {
		body, _, err := c.HTTP.Get(ctx, u)
		if err != nil {
			return nil, err
		}
		ev, err := Parse(body)
		if err != nil {
			return nil, err
		}
		return json.Marshal(struct {
			Events    []Event `json:"events"`
			Retrieved string  `json:"retrieved_at"`
		}{ev, c.Now().UTC().Format(time.RFC3339)})
	})
	if err != nil {
		return nil, err
	}
	var w struct {
		Events    []Event `json:"events"`
		Retrieved string  `json:"retrieved_at"`
	}
	if err := json.Unmarshal(b, &w); err != nil {
		return nil, err
	}
	result := &Result{
		Events: w.Events, Count: len(w.Events), Limit: q.Limit, Truncated: len(w.Events) >= q.Limit,
		OrderedBy: "magnitude (largest first)", RequestURL: u, Retrieved: w.Retrieved,
		Source: "U.S. Geological Survey, ANSS Comprehensive Earthquake Catalog (ComCat)",
		Stale:  origin == cache.Stale,
		Notes: []string{
			"Hypocentre depths are catalogue estimates with uncertainties; some events have fixed default depths (e.g. 10 km) assigned by the location algorithm.",
			"Catalogue completeness varies with time and region; counts over time are not a measure of changing seismicity.",
		},
	}
	if result.Stale {
		result.Notes = append(result.Notes, "USGS is unavailable. Showing a previously retrieved catalogue snapshot; events may have been added or revised since "+w.Retrieved+".")
	}
	return result, nil
}
