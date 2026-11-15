package gibs

import (
	"os"
	"testing"
)

var ivs = []Interval{
	{"1980-01-01", "2023-11-01", "P1M"},
	{"2024-02-01", "2024-04-01", "P1M"},
	{"2025-07-01", "2026-08-01", "P1M"},
}

func TestSnapMonthly(t *testing.T) {
	cases := []struct{ date, shown, prev, next string }{
		{"1985-07-15", "1985-07-01", "1985-06-01", "1985-08-01"},
		{"1980-01-01", "1980-01-01", "", "1980-02-01"},
		{"1975-05-05", "1980-01-01", "", "1980-02-01"},           // before coverage
		{"2024-01-10", "2023-11-01", "2023-10-01", "2024-02-01"}, // inside a gap
		{"2024-04-01", "2024-04-01", "2024-03-01", "2025-07-01"}, // across a gap
		{"2030-01-01", "2026-08-01", "2026-07-01", ""},           // after coverage
	}
	for _, c := range cases {
		a, err := Snap(ivs, c.date)
		if err != nil {
			t.Fatal(err)
		}
		if a.Shown != c.shown || a.Previous != c.prev || a.Next != c.next {
			t.Errorf("%s: got shown=%s prev=%s next=%s; want %s %s %s", c.date, a.Shown, a.Previous, a.Next, c.shown, c.prev, c.next)
		}
	}
}

func TestSnapDailyAndYearly(t *testing.T) {
	a, _ := Snap([]Interval{{"2000-02-24", "2000-04-25", "P1D"}, {"2000-04-28", "2000-08-06", "P1D"}}, "2000-04-26")
	if a.Shown != "2000-04-25" || a.Next != "2000-04-28" || a.DeltaDays != -1 {
		t.Errorf("daily gap: %+v", a)
	}
	y, _ := Snap([]Interval{{"1983-12-01", "1985-12-01", "P1Y"}, {"1998-12-01", "2000-12-01", "P1Y"}}, "1992-06-01")
	if y.Shown != "1985-12-01" || y.Next != "1998-12-01" || y.Previous != "1984-12-01" {
		t.Errorf("yearly: %+v", y)
	}
}

func TestSnapRejectsBadDate(t *testing.T) {
	if _, err := Snap(ivs, "2020-13-01"); err == nil {
		t.Fatal("expected error")
	}
}

func TestParseRealCapabilitiesSubset(t *testing.T) {
	b, err := os.ReadFile("testdata/capabilities_subset.xml")
	if err != nil {
		t.Fatal(err)
	}
	ls, err := ParseCapabilities(b)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]Layer{}
	for _, l := range ls {
		got[l.ID] = l
	}
	m, ok := got["MERRA2_2m_Air_Temperature_Monthly"]
	if !ok || !m.TimeEnabled || m.TileMatrixSet != "GoogleMapsCompatible_Level6" || m.MaxLevel != 6 || m.Intervals[0].Start != "1980-01-01" {
		t.Fatalf("merra2 parsed wrong: %+v", m)
	}
	if m.LegendURL == "" || m.URLTemplate == "" {
		t.Fatalf("missing legend/template: %+v", m)
	}
	if !got["MERRA2_Precipitation_Bias_Corrected_Monthly"].MaybeTruncated {
		t.Error("layer with 100 listed periods must be flagged as possibly truncated")
	}
	if b := got["BlueMarble_ShadedRelief_Bathymetry"]; b.TimeEnabled || b.MaxLevel != 8 {
		t.Errorf("static base layer parsed wrong: %+v", b)
	}
	if a, err := Snap(m.Intervals, "1985-07-15"); err != nil || a.Shown != "1985-07-01" {
		t.Errorf("snap on real domain: %+v %v", a, err)
	}
}
