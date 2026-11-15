package stats

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

// The reference file is produced by science/reference/generate_reference.py
// using statsmodels, scipy and pymannkendall (independent implementations).

type refMK struct {
	S, VarS, Z, P, Tau float64
	SenPerYear         float64 `json:"sen_slope_per_year"`
}

func (r *refMK) UnmarshalJSON(b []byte) error {
	var m map[string]float64
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	r.S, r.VarS, r.Z, r.P, r.Tau, r.SenPerYear = m["s"], m["var_s"], m["z"], m["p"], m["tau"], m["sen_slope_per_year"]
	return nil
}

type refCase struct {
	Name        string     `json:"name"`
	Kind        string     `json:"kind"`
	T           []float64  `json:"t"`
	Month       []int      `json:"month"`
	Year        []int      `json:"year"`
	Y           []*float64 `json:"y"`
	SeasonalRaw []*float64 `json:"seasonal_raw"`
	OLS         struct {
		N                                                   int
		Slope, Intercept, SE, PNaive, R1, NEff, SEAdj, PAdj float64
		CILow, CIHigh                                       float64
	} `json:"-"`
	OLSRaw  map[string]float64 `json:"ols_santer"`
	MKOrig  refMK              `json:"mk_original"`
	MKHR    refMK              `json:"mk_hamed_rao"`
	Sen     map[string]float64 `json:"sen"`
	SeasonK *refMK             `json:"seasonal_kendall"`
}

func toNaN(p []*float64) []float64 {
	out := make([]float64, len(p))
	for i, v := range p {
		if v == nil {
			out[i] = math.NaN()
		} else {
			out[i] = *v
		}
	}
	return out
}

func near(t *testing.T, what string, got, want, rel float64) {
	t.Helper()
	tol := rel * math.Max(1, math.Abs(want))
	if math.Abs(got-want) > tol {
		t.Errorf("%s: got %.12g want %.12g (tol %.3g)", what, got, want, tol)
	}
}

func loadRef(t *testing.T) (alpha float64, cases []refCase) {
	t.Helper()
	b, err := os.ReadFile("testdata/stats_reference.json")
	if err != nil {
		t.Fatalf("reference file missing (run science/reference/generate_reference.py): %v", err)
	}
	var f struct {
		Alpha float64   `json:"alpha"`
		Cases []refCase `json:"cases"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) == 0 {
		t.Fatal("no reference cases")
	}
	return f.Alpha, f.Cases
}

func TestAgainstReferenceImplementations(t *testing.T) {
	alpha, cases := loadRef(t)
	const rel = 1e-6
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			y := toNaN(c.Y)

			ols, err := OLSAdjusted(c.T, y, alpha)
			if err != nil {
				t.Fatal(err)
			}
			o := c.OLSRaw
			near(t, "ols.slope", ols.Slope, o["slope"], rel)
			near(t, "ols.intercept", ols.Intercept, o["intercept"], 1e-6)
			near(t, "ols.se", ols.SE, o["se"], rel)
			near(t, "ols.p_naive", ols.PNaive, o["p_naive"], 1e-6)
			near(t, "ols.r1", ols.R1, o["r1"], rel)
			near(t, "ols.n_eff", ols.NEff, o["n_eff"], rel)
			near(t, "ols.se_adj", ols.SEAdj, o["se_adj"], rel)
			near(t, "ols.p_adj", ols.PAdj, o["p_adj"], 1e-6)
			near(t, "ols.ci_low", ols.CILow, o["ci_low"], 1e-6)
			near(t, "ols.ci_high", ols.CIHigh, o["ci_high"], 1e-6)

			m, err := MannKendall(y)
			if err != nil {
				t.Fatal(err)
			}
			near(t, "mk.s", m.S, c.MKOrig.S, 0)
			near(t, "mk.var_s", m.VarS, c.MKOrig.VarS, rel)
			near(t, "mk.z", m.Z, c.MKOrig.Z, rel)
			near(t, "mk.p", m.P, c.MKOrig.P, 1e-6)
			near(t, "mk.tau", m.Tau, c.MKOrig.Tau, rel)

			hr, err := HamedRao(c.T, y, alpha)
			if err != nil {
				t.Fatal(err)
			}
			hrTol := 1e-5
			if len(Compact(y)) != len(y) {
				// Documented deviation from pymannkendall for gapped series
				// (see HamedRao doc comment): allow a small difference.
				hrTol = 0.01
			}
			near(t, "hr.var_s", hr.VarS, c.MKHR.VarS, hrTol)
			near(t, "hr.z", hr.Z, c.MKHR.Z, hrTol)
			near(t, "hr.p", hr.P, c.MKHR.P, hrTol)

			sen, err := SenSlope(c.T, y, alpha)
			if err != nil {
				t.Fatal(err)
			}
			near(t, "sen.slope", sen.Slope, c.Sen["slope"], rel)
			near(t, "sen.intercept", sen.Intercept, c.Sen["intercept"], 1e-6)
			near(t, "sen.ci_low", sen.CILow, c.Sen["ci_low"], rel)
			near(t, "sen.ci_high", sen.CIHigh, c.Sen["ci_high"], rel)

			if c.SeasonK != nil {
				raw := toNaN(c.SeasonalRaw)
				seasons, years := SplitSeasons(raw, c.Month, c.Year, 12)
				sk, err := SeasonalKendall(seasons, years)
				if err != nil {
					t.Fatal(err)
				}
				near(t, "sk.s", sk.S, c.SeasonK.S, 0)
				near(t, "sk.var_s", sk.VarS, c.SeasonK.VarS, rel)
				near(t, "sk.z", sk.Z, c.SeasonK.Z, rel)
				near(t, "sk.p", sk.P, c.SeasonK.P, 1e-6)
				near(t, "sk.sen_slope_per_year", sk.SenSlopePerYear, c.SeasonK.SenPerYear, rel)
			}
		})
	}
}
