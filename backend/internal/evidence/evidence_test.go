package evidence

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/cache"
	"github.com/stellify/earth-explorer/backend/internal/fetch"
)

const fixtures = "../../../data/fixtures/shakemap_us100044k6/"

// upstream serves the saved USGS answers for us100044k6 (M 7.2, Tajikistan, 2015-12-07); `after` is the
// body of the nearby-earthquake search, `down` makes every request fail.
func upstream(t *testing.T, after string, withShakeMap bool, down *bool) *httptest.Server {
	t.Helper()
	read := func(name string) []byte {
		b, err := os.ReadFile(fixtures + name)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if down != nil && *down {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		q := r.URL.Query()
		switch {
		case q.Get("eventid") == "us100044k6":
			body := strings.ReplaceAll(string(read("detail.geojson")), "https://earthquake.usgs.gov", srv.URL)
			if !withShakeMap {
				body = strings.Replace(body, `"shakemap":`, `"shakemap_removed_for_test":`, 1)
			}
			io.WriteString(w, body)
		case q.Get("eventid") != "":
			w.WriteHeader(http.StatusNotFound)
		case q.Get("maxradiuskm") != "":
			if q.Get("maxradiuskm") != "100" || q.Get("orderby") != "time-asc" || q.Get("starttime") != "2015-12-07T07:50:06" || q.Get("endtime") != "2016-01-06T07:50:05" {
				t.Errorf("unexpected search %s", r.URL.RawQuery)
			}
			io.WriteString(w, after)
		case strings.HasSuffix(r.URL.Path, "coverage_mmi_low_res.covjson"):
			w.Write(read("coverage_mmi_low_res.covjson"))
		case strings.HasSuffix(r.URL.Path, "rupture.json"):
			w.Write(read("rupture.json"))
		case strings.HasSuffix(r.URL.Path, "stationlist.json"):
			w.Write(read("stationlist.json"))
		default:
			t.Errorf("unexpected request %s", r.URL)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func client(base, dir string) *Client {
	f := fetch.New("USGS", 5*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)))
	f.MaxRetries = 0
	return &Client{Base: base, HTTP: f, Cache: cache.New(4, time.Hour, dir), Now: func() time.Time { return time.Date(2026, 11, 15, 4, 0, 0, 0, time.UTC) }}
}

// Two real-format later events (ids invented for the test, marked as such) plus the main shock itself, which must be skipped.
const afterBody = `{"type":"FeatureCollection","features":[
{"id":"us100044k6","properties":{"mag":7.2,"place":"main","time":1449474605950,"magType":"mww"},"geometry":{"coordinates":[72.7797,38.2107,22]}},
{"id":"testafter1","properties":{"mag":4.6,"place":"synthetic test event","time":1449478205950,"magType":"mb"},"geometry":{"coordinates":[72.9,38.3,10]}},
{"id":"testafter2","properties":{"mag":5.1,"place":"synthetic test event","time":1449647405950,"magType":"mb"},"geometry":{"coordinates":[72.6,38.1,10]}}]}`

func layer(b *Bundle, id string) *Layer {
	for i := range b.Layers {
		if b.Layers[i].ID == id {
			return &b.Layers[i]
		}
	}
	return nil
}

func TestEarthquakeBundleFromShakeMap(t *testing.T) {
	srv := upstream(t, afterBody, true, nil)
	b, err := client(srv.URL, t.TempDir()).Earthquake(context.Background(), "us100044k6")
	if err != nil {
		t.Fatal(err)
	}
	if b.Category != "earthquakes" || b.Stale || !strings.Contains(b.Title, "Murghob") {
		t.Fatalf("header: %+v", b)
	}
	sh := layer(b, "shaking")
	if sh == nil || sh.Evidence != "model" || sh.Kind != "raster" {
		t.Fatalf("shaking layer: %+v", sh)
	}
	r := sh.Raster
	// Grid of the file: 184 x 146 cell centres, 67.1167..79.3167 E and 33.3333..43.0 N, 1/15 degree apart.
	if r.NX != 184 || r.NY != 146 || len(r.Values) != 184*146 {
		t.Fatalf("grid %d x %d (%d values)", r.NX, r.NY, len(r.Values))
	}
	want := [4]float64{67.08333, 33.3, 79.35, 43.03333}
	for k := range want {
		if d := r.BBox[k] - want[k]; d > 1e-4 || d < -1e-4 {
			t.Fatalf("bbox %v, want %v", r.BBox, want)
		}
	}
	// The strongest cell of the low-resolution grid is 7.2 (the full grid reaches 7.424) and must lie on the fault: this checks the row order.
	best, at := 0, 0
	for i, v := range r.Values {
		if v > best {
			best, at = v, i
		}
	}
	lat := r.BBox[3] - (float64(at/r.NX)+0.5)*(r.BBox[3]-r.BBox[1])/float64(r.NY)
	lon := r.BBox[0] + (float64(at%r.NX)+0.5)*(r.BBox[2]-r.BBox[0])/float64(r.NX)
	if best != 72 || lat < 37.9 || lat > 38.8 || lon < 72.4 || lon > 73.3 {
		t.Fatalf("maximum %d at %.2fN %.2fE", best, lat, lon)
	}
	if len(r.Ramp) != 11 || r.Ramp[0].V != 0 || r.Ramp[10].V != 10 || !strings.HasPrefix(r.Ramp[7].Color, "rgb(") {
		t.Fatalf("ramp %+v", r.Ramp)
	}
	if b.View == nil || b.View.BBox[0] < r.BBox[0] || b.View.BBox[2] > r.BBox[2] || b.View.BBox[0] > 72.7 || b.View.BBox[2] < 72.8 {
		t.Fatalf("view %+v", b.View)
	}
	rup := layer(b, "rupture")
	if rup == nil || rup.Evidence != "model" || len(rup.Polygons) != 1 || len(rup.Polygons[0][0]) != 5 || rup.Polygons[0][0][0][0] != 72.654 {
		t.Fatalf("rupture %+v", rup)
	}
	if b.Depth == nil || b.Depth.Km != 22 || *b.Depth.RuptureTop != 15.3 || *b.Depth.RuptureBase != 54.7 {
		t.Fatalf("depth %+v", b.Depth)
	}
	// The saved station file of this event has broken coordinates (longitude 0, the real longitude in the
	// latitude field): all 12 felt reports fall outside the map and must be dropped, not drawn in the wrong place.
	if felt := layer(b, "felt"); felt != nil {
		t.Fatalf("felt reports with broken coordinates were drawn: %+v", felt.Points)
	}
	if layer(b, "stations") != nil {
		t.Fatal("the fixture has no instrument stations")
	}
	after := layer(b, "after")
	if after == nil || len(after.Points.Lon) != 2 || after.Points.TMin[0] != 60 || after.Points.TMin[1] != 2880 || after.Points.V[1] != 5.1 {
		t.Fatalf("later earthquakes %+v", after)
	}
	// Steps: the main shock, then whole days until the last later event (2 days) is covered.
	if len(b.Steps) != 4 || b.Steps[0].Label != "Main shock" || b.Steps[3].T != 1449474605950+3*86_400_000 {
		t.Fatalf("steps %+v", b.Steps)
	}
	labels := map[string]string{}
	for _, m := range b.Summary {
		labels[m.Label] = m.Value + " " + m.Unit + " " + m.Evidence
	}
	if labels["Magnitude"] != "7.2 mww observed" || labels["Depth of the hypocentre"] != "22 km observed" || labels["Strongest estimated shaking"] != "VII MMI model" || labels["Later earthquakes nearby"] != "2  observed" {
		t.Fatalf("summary %v", labels)
	}
	for _, l := range b.Layers {
		if l.Source.URL == "" || l.Source.Retrieved == "" || l.Note == "" || len(l.Legend) == 0 || l.Evidence == "" {
			t.Fatalf("layer %s lacks provenance: %+v", l.ID, l)
		}
	}
}

func TestEarthquakeWithoutShakeMapSaysSo(t *testing.T) {
	srv := upstream(t, `{"features":[]}`, false, nil)
	b, err := client(srv.URL, t.TempDir()).Earthquake(context.Background(), "us100044k6")
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Layers) != 0 || b.View != nil {
		t.Fatalf("no geometry may be invented without a ShakeMap: %+v", b.Layers)
	}
	if len(b.Unavailable) != 2 || !strings.Contains(b.Unavailable[0].Reason, "has not published a ShakeMap") {
		t.Fatalf("unavailable %+v", b.Unavailable)
	}
	if len(b.Summary) != 2 {
		t.Fatalf("summary %+v", b.Summary)
	}
}

func TestEarthquakeUnknownAndStale(t *testing.T) {
	down := false
	srv := upstream(t, afterBody, true, &down)
	dir := t.TempDir()
	if _, err := client(srv.URL, dir).Earthquake(context.Background(), "us0000zzzz"); err != ErrNotFound {
		t.Fatalf("unknown id: %v", err)
	}
	if _, err := client(srv.URL, dir).Earthquake(context.Background(), "../etc"); err != ErrNotFound {
		t.Fatalf("bad id: %v", err)
	}
	c := client(srv.URL, dir)
	if _, err := c.Earthquake(context.Background(), "us100044k6"); err != nil {
		t.Fatal(err)
	}
	// USGS goes down and the copy expires: the stored bundle is served and marked stale.
	down = true
	old := client(srv.URL, dir)
	old.Cache = cache.New(4, time.Nanosecond, dir)
	time.Sleep(5 * time.Millisecond)
	b, err := old.Earthquake(context.Background(), "us100044k6")
	if err != nil || !b.Stale || layer(b, "shaking") == nil {
		t.Fatalf("stale copy: %v %+v", err, b)
	}
}
