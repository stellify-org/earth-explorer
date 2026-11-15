package analysis

import (
	"encoding/json"
	"math"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/power"
	"github.com/stellify/earth-explorer/backend/internal/series"
)

const fixture = "../../../data/fixtures/power_monthly_T2M_PRECTOTCORR_38.56N_68.78E_1981-2025.json"

func load(t *testing.T, param, units string) *series.Monthly {
	t.Helper()
	b, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	s, err := power.Parse(b, param, units)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// The analysis of a real POWER series must reproduce the independent Python
// reference (anomalies and primary slope).
func TestRealSeriesMatchesPythonReference(t *testing.T) {
	s := load(t, "T2M", "C")
	if len(s.Value) != 45*12 {
		t.Fatalf("expected 540 months, got %d", len(s.Value))
	}
	r := Analyze(s, Options{Alpha: 0.05, UnitsLabel: "°C", VarName: "air temperature", Now: time.Unix(0, 0)})

	b, err := os.ReadFile("../stats/testdata/stats_reference.json")
	if err != nil {
		t.Fatal(err)
	}
	var ref struct {
		Cases []struct {
			Name string             `json:"name"`
			Y    []*float64         `json:"y"`
			OLS  map[string]float64 `json:"ols_santer"`
			HR   map[string]float64 `json:"mk_hamed_rao"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(b, &ref); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, c := range ref.Cases {
		if c.Name != "power_dushanbe_T2M_anomaly" {
			continue
		}
		found = true
		for i, p := range r.Points {
			if math.Abs(float64(p.Anomaly)-*c.Y[i]) > 1e-9 {
				t.Fatalf("anomaly %s: got %v want %v", p.Date, p.Anomaly, *c.Y[i])
			}
		}
		if got, want := float64(r.Trend.Primary.SlopePerDecade), c.OLS["slope"]*10; math.Abs(got-want) > 1e-9 {
			t.Errorf("slope/decade got %v want %v", got, want)
		}
		if got, want := float64(r.Trend.Primary.PAdjusted), c.OLS["p_adj"]; math.Abs(got-want) > 1e-9 {
			t.Errorf("p_adj got %v want %v", got, want)
		}
		if got, want := float64(r.Trend.MannKendall.P), c.HR["p"]; math.Abs(got-want) > 1e-6 {
			t.Errorf("hamed-rao p got %v want %v", got, want)
		}
	}
	if !found {
		t.Fatal("reference case missing")
	}
	t.Logf("verdict=%s summary=%s", r.Trend.Verdict.Code, r.Trend.Summary)
	if _, err := json.Marshal(r); err != nil {
		t.Fatalf("result must be JSON-encodable: %v", err)
	}
}

func TestShortPeriodIsInsufficient(t *testing.T) {
	s := load(t, "T2M", "C").Slice(2018, 2025)
	r := Analyze(s, Options{})
	if r.Trend.Verdict.Code != "insufficient_data" {
		t.Fatalf("got %s", r.Trend.Verdict.Code)
	}
	if !strings.Contains(r.Trend.Summary, "No trend is reported") {
		t.Fatalf("summary should refuse a conclusion: %s", r.Trend.Summary)
	}
}

func TestGapsAreReportedNotInterpolated(t *testing.T) {
	s := load(t, "PRECTOTCORR", "mm/day").Slice(1990, 2020)
	for i := 24; i < 24+30; i++ { // 30-month gap
		s.Value[i] = math.NaN()
	}
	r := Analyze(s, Options{})
	if r.Coverage.MaxGapMonths != 30 {
		t.Fatalf("max gap %d", r.Coverage.MaxGapMonths)
	}
	if r.Trend.Verdict.Code != "insufficient_data" {
		t.Fatalf("a 30-month gap must block the verdict, got %s", r.Trend.Verdict.Code)
	}
	if !math.IsNaN(float64(r.Points[30].Anomaly)) {
		t.Fatal("missing months must stay missing")
	}
}

func TestUnitMismatchIsAnError(t *testing.T) {
	b, _ := os.ReadFile(fixture)
	if _, err := power.Parse(b, "T2M", "K"); err == nil {
		t.Fatal("expected unit mismatch error")
	}
}

func TestNumEncodesNaNAsNull(t *testing.T) {
	b, _ := json.Marshal(struct{ X Num }{Num(math.NaN())})
	if string(b) != `{"X":null}` {
		t.Fatal(string(b))
	}
}
