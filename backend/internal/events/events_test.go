package events

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/cache"
	"github.com/stellify/earth-explorer/backend/internal/fetch"
)

// Five real records cut from the EONET response of 2026-11-14 (see data/fixtures/README.md).
const fixture = "../../../data/fixtures/eonet_v3_events_5-of-1730_2026-11-14.json"

func load(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func byID(t *testing.T, ev []Event, id string) Event {
	t.Helper()
	for _, e := range ev {
		if e.ID == id {
			return e
		}
	}
	t.Fatalf("event %s missing", id)
	return Event{}
}

func TestParseListKeepsTheGeometryTheSourceGave(t *testing.T) {
	ev, err := ParseList(load(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(ev) != 5 {
		t.Fatalf("got %d events, want 5", len(ev))
	}
	for i := 1; i < len(ev); i++ {
		if ev[i-1].End < ev[i].End {
			t.Fatalf("not newest first at %d", i)
		}
	}

	fire := byID(t, ev, "EONET_26331")
	if fire.Geometry != "point" || fire.Position != "reported_point" || fire.Lon != -89.063853 || fire.Lat != 31.130069 {
		t.Errorf("fire point changed: %+v", fire)
	}
	if fire.Mag == nil || *fire.Mag != 519 || fire.MagUnit != "acres" || fire.Closed != "" || len(fire.Track) != 0 || fire.PolygonCount != 0 {
		t.Errorf("fire metadata: %+v", fire)
	}
	if len(fire.Sources) != 1 || fire.Sources[0].ID != "IRWIN" {
		t.Errorf("fire sources: %+v", fire.Sources)
	}

	storm := byID(t, ev, "EONET_24317")
	if storm.Geometry != "track" || len(storm.Track) != 24 || storm.Position != "latest_reported_point" {
		t.Fatalf("storm: geometry %s, %d fixes", storm.Geometry, len(storm.Track))
	}
	if storm.Start != "2026-09-16T12:00:00Z" || storm.End != "2026-09-22T06:00:00Z" || storm.Closed != "2026-09-27T00:00:00Z" {
		t.Errorf("storm dates: %s %s %s", storm.Start, storm.End, storm.Closed)
	}
	last := storm.Track[len(storm.Track)-1]
	if storm.Lon != 150.2 || storm.Lat != 39 || last.Lon != 150.2 || last.Mag == nil || *last.Mag != 60 || last.Unit != "kts" {
		t.Errorf("storm head: %+v / %+v", storm, last)
	}
	for i := 1; i < len(storm.Track); i++ {
		if storm.Track[i-1].Date > storm.Track[i].Date {
			t.Fatalf("track not in time order at %d", i)
		}
	}
	if storm.MagMax == nil || *storm.MagMax < *storm.Mag {
		t.Errorf("mag_max below latest: %v %v", storm.MagMax, storm.Mag)
	}

	flood := byID(t, ev, "EONET_25820")
	if flood.Geometry != "polygon" || flood.Position != "polygon_bbox_centre" || flood.PolygonCount != 1 || flood.PolygonVertices != 6 {
		t.Fatalf("flood: %+v", flood)
	}
	if flood.Polygons != nil {
		t.Error("the list must not carry polygon rings")
	}
	want := [4]float64{7.4086637, 54.0068062, 7.549833, 54.1378463}
	if flood.BBox == nil || *flood.BBox != want {
		t.Errorf("bbox %v, want %v", flood.BBox, want)
	}
	if flood.Lon != (want[0]+want[2])/2 || flood.Lat != (want[1]+want[3])/2 {
		t.Errorf("marker is not the bbox centre: %v %v", flood.Lon, flood.Lat)
	}
}

func TestParseDetailReturnsEveryVertexUnchanged(t *testing.T) {
	var raw struct {
		Events []json.RawMessage `json:"events"`
	}
	if err := json.Unmarshal(load(t), &raw); err != nil {
		t.Fatal(err)
	}
	for _, r := range raw.Events {
		if !strings.Contains(string(r), `"EONET_25820"`) {
			continue
		}
		e, err := ParseDetail(r)
		if err != nil {
			t.Fatal(err)
		}
		if len(e.Polygons) != 1 || len(e.Polygons[0]) != 1 || len(e.Polygons[0][0]) != 6 {
			t.Fatalf("polygon shape: %v", e.Polygons)
		}
		var src struct {
			Geometry []struct {
				Coordinates [][][]float64 `json:"coordinates"`
			} `json:"geometry"`
		}
		if err := json.Unmarshal(r, &src); err != nil {
			t.Fatal(err)
		}
		for i, p := range src.Geometry[0].Coordinates[0] {
			got := e.Polygons[0][0][i]
			if got[0] != p[0] || got[1] != p[1] {
				t.Fatalf("vertex %d changed: %v != %v", i, got, p)
			}
		}
		return
	}
	t.Fatal("flood record not in fixture")
}

func TestRecordsWithoutUsableGeometryAreDropped(t *testing.T) {
	body := `{"events":[
	 {"id":"EONET_1","title":"no geometry","categories":[{"id":"floods","title":"Floods"}],"sources":[],"geometry":[]},
	 {"id":"EONET_2","title":"bad point","categories":[{"id":"floods","title":"Floods"}],"sources":[],"geometry":[{"date":"2026-01-01T00:00:00Z","type":"Point","coordinates":[500,10]}]},
	 {"id":"EONET_3","title":"two-vertex ring","categories":[{"id":"floods","title":"Floods"}],"sources":[],"geometry":[{"date":"2026-01-01T00:00:00Z","type":"Polygon","coordinates":[[[1,1],[2,2]]]}]}]}`
	ev, err := ParseList([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if len(ev) != 0 {
		t.Fatalf("kept %d records without geometry", len(ev))
	}
	if _, err := ParseList([]byte(`{"error":"x"}`)); err == nil {
		t.Error("a response without an events list must be an error")
	}
}

func TestSearchCachesAndServesStaleWhenUpstreamFails(t *testing.T) {
	body := load(t)
	var calls atomic.Int32
	var gotQuery atomic.Value
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery.Store(r.URL.RawQuery)
		if calls.Add(1) > 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Write(body)
	}))
	defer upstream.Close()
	dir := t.TempDir()
	at := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
	client := func() *Client {
		f := fetch.New("NASA EONET", time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)))
		f.MaxRetries = 0
		return &Client{Base: upstream.URL, HTTP: f, Cache: cache.New(4, time.Nanosecond, dir), Now: func() time.Time { return at }}
	}
	first, err := client().Search(context.Background(), 30, "")
	if err != nil {
		t.Fatal(err)
	}
	if first.Count != 5 || first.Stale || first.Retrieved != "2026-11-14T12:00:00Z" || gotQuery.Load() != "days=30&status=all" {
		t.Fatalf("first: count %d stale %v retrieved %s query %v", first.Count, first.Stale, first.Retrieved, gotQuery.Load())
	}
	if len(first.Categories) != 4 || first.Categories[0].ID != "wildfires" || first.Categories[0].Count != 2 {
		t.Errorf("categories: %+v", first.Categories)
	}
	time.Sleep(2 * time.Millisecond) // the 1 ns TTL has passed: a new process must ask upstream again
	second, err := client().Search(context.Background(), 30, "")
	if err != nil {
		t.Fatalf("expected the stored list when upstream fails, got %v", err)
	}
	if !second.Stale || second.Count != 5 || second.Retrieved != first.Retrieved {
		t.Errorf("stale copy: stale %v count %d retrieved %s", second.Stale, second.Count, second.Retrieved)
	}
	if !strings.Contains(second.Notes[len(second.Notes)-1], "unavailable") {
		t.Errorf("no stale note: %v", second.Notes)
	}

	c := client()
	for _, bad := range []struct {
		days int
		cat  string
	}{{0, ""}, {MaxDays + 1, ""}, {30, "floods;drop"}, {30, "a b"}} {
		if _, err := c.Search(context.Background(), bad.days, bad.cat); err == nil {
			t.Errorf("accepted days=%d category=%q", bad.days, bad.cat)
		}
	}
	if _, err := c.Get(context.Background(), "../etc"); err == nil {
		t.Error("accepted a malformed id")
	}
}
