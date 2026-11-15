package analysis

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/stellify/earth-explorer/backend/internal/series"
	"github.com/stellify/earth-explorer/backend/internal/stats"
)

const CodeVersion = "analysis/0.1.0"

const (
	MinYears             = 10
	RecommendedYears     = 20
	MinClimatologyYears  = 5
	MinCoverage          = 0.80
	MaxGapMonths         = 24
	MinNEff              = 10
	SuggestiveAlpha      = 0.10
	SensitivityDropYears = 3
)

type Num float64

func (n Num) MarshalJSON() ([]byte, error) {
	f := float64(n)
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return []byte("null"), nil
	}
	return []byte(strconv.FormatFloat(f, 'g', 10, 64)), nil
}

func (n *Num) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		*n = Num(math.NaN())
		return nil
	}
	var f float64
	if err := json.Unmarshal(b, &f); err != nil {
		return err
	}
	*n = Num(f)
	return nil
}

type Point struct {
	Date    string  `json:"date"`
	T       float64 `json:"t"`
	Value   Num     `json:"value"`
	Anomaly Num     `json:"anomaly"`
}

type ClimMonth struct {
	Month  int `json:"month"`
	Mean   Num `json:"mean"`
	NYears int `json:"n_years"`
}

type AnnualPoint struct {
	Year    int `json:"year"`
	Mean    Num `json:"mean"`
	NMonths int `json:"n_months"`
}

type Coverage struct {
	NMonths      int     `json:"n_months"`
	NValid       int     `json:"n_valid"`
	Fraction     float64 `json:"fraction"`
	MaxGapMonths int     `json:"max_gap_months"`
}

type LinearTrend struct {
	Method           string `json:"method"`
	N                int    `json:"n"`
	SlopePerDecade   Num    `json:"slope_per_decade"`
	CILowPerDecade   Num    `json:"ci_low_per_decade"`
	CIHighPerDecade  Num    `json:"ci_high_per_decade"`
	Intercept        Num    `json:"intercept"`
	R1               Num    `json:"lag1_autocorrelation"`
	NEff             Num    `json:"n_eff"`
	DF               Num    `json:"df"`
	PAdjusted        Num    `json:"p_value"`
	PNaive           Num    `json:"p_value_naive"`
	SEAdjustedDecade Num    `json:"se_per_decade"`
	ResidualSD       Num    `json:"residual_sd"`
}

type RankTrend struct {
	Method             string `json:"method"`
	N                  int    `json:"n"`
	S                  Num    `json:"s"`
	VarS               Num    `json:"var_s"`
	Z                  Num    `json:"z"`
	P                  Num    `json:"p_value"`
	Tau                Num    `json:"tau"`
	VarianceCorrection Num    `json:"variance_correction,omitempty"`
	SenPerDecade       Num    `json:"sen_slope_per_decade"`
	SenCILowDecade     Num    `json:"sen_ci_low_per_decade"`
	SenCIHighDecade    Num    `json:"sen_ci_high_per_decade"`
}

type Sensitivity struct {
	Label           string `json:"label"`
	StartYear       int    `json:"start_year"`
	EndYear         int    `json:"end_year"`
	SlopePerDecade  Num    `json:"slope_per_decade"`
	CILowPerDecade  Num    `json:"ci_low_per_decade"`
	CIHighPerDecade Num    `json:"ci_high_per_decade"`
	P               Num    `json:"p_value"`
}

type Practical struct {
	SpanYears          float64 `json:"span_years"`
	TotalChange        Num     `json:"total_change"`
	InterannualSD      Num     `json:"interannual_sd"`
	ChangeToNoiseRatio Num     `json:"change_to_variability_ratio"`
	Explanation        string  `json:"explanation"`
}

type Verdict struct {
	Code        string `json:"code"`
	Label       string `json:"label"`
	Explanation string `json:"explanation"`
}

type Trend struct {
	Primary     LinearTrend   `json:"primary"`
	MannKendall RankTrend     `json:"mann_kendall"`
	MKOriginal  RankTrend     `json:"mann_kendall_unadjusted"`
	Seasonal    *RankTrend    `json:"seasonal_kendall,omitempty"`
	AnnualOLS   *LinearTrend  `json:"annual_ols,omitempty"`
	AnnualMK    *RankTrend    `json:"annual_mann_kendall,omitempty"`
	Sensitivity []Sensitivity `json:"sensitivity"`
	Practical   Practical     `json:"practical"`
	Verdict     Verdict       `json:"verdict"`
	Summary     string        `json:"summary"`
	Causality   string        `json:"causality_note"`
}

type Method struct {
	Alpha             float64  `json:"alpha"`
	Deseasonalization string   `json:"deseasonalization"`
	Baseline          string   `json:"baseline"`
	Tests             []string `json:"tests"`
	VerdictRule       string   `json:"verdict_rule"`
	References        []string `json:"references"`
	CodeVersion       string   `json:"code_version"`
	ComputedAt        string   `json:"computed_at"`
}

type Result struct {
	StartYear   int               `json:"start_year"`
	EndYear     int               `json:"end_year"`
	Units       string            `json:"units"`
	Points      []Point           `json:"points"`
	Climatology []ClimMonth       `json:"climatology"`
	Annual      []AnnualPoint     `json:"annual"`
	Coverage    Coverage          `json:"coverage"`
	Trend       *Trend            `json:"trend"`
	Warnings    []string          `json:"warnings"`
	Method      Method            `json:"method"`
	Provenance  series.Provenance `json:"provenance"`
}

type Options struct {
	Alpha      float64
	UnitsLabel string
	VarName    string
	Now        time.Time
}

func nan(x float64) Num { return Num(x) }

func Prepare(s *series.Monthly) *Result {
	r := &Result{Units: s.Units, Provenance: s.Provenance}
	if len(s.Value) == 0 {
		return r
	}
	r.StartYear, r.EndYear = s.Year[0], s.Year[len(s.Year)-1]
	t := s.FracYear()

	var sum [13]float64
	var cnt [13]int
	for i, v := range s.Value {
		if !math.IsNaN(v) {
			sum[s.Month[i]] += v
			cnt[s.Month[i]]++
		}
	}
	clim := [13]float64{}
	for m := 1; m <= 12; m++ {
		clim[m] = math.NaN()
		if cnt[m] >= MinClimatologyYears {
			clim[m] = sum[m] / float64(cnt[m])
		}
		r.Climatology = append(r.Climatology, ClimMonth{Month: m, Mean: nan(clim[m]), NYears: cnt[m]})
		if cnt[m] < MinClimatologyYears {
			r.Warnings = append(r.Warnings, fmt.Sprintf("Calendar month %d has only %d valid years (< %d); its anomalies are left missing.", m, cnt[m], MinClimatologyYears))
		}
	}
	gap, maxGap := 0, 0
	for i, v := range s.Value {
		a := math.NaN()
		if !math.IsNaN(v) {
			a = v - clim[s.Month[i]]
			gap = 0
		} else {
			gap++
			maxGap = max(maxGap, gap)
		}
		r.Points = append(r.Points, Point{Date: fmt.Sprintf("%04d-%02d", s.Year[i], s.Month[i]), T: t[i], Value: nan(v), Anomaly: nan(a)})
	}
	nv := s.ValidCount()
	r.Coverage = Coverage{NMonths: len(s.Value), NValid: nv, Fraction: float64(nv) / float64(len(s.Value)), MaxGapMonths: maxGap}

	for y := r.StartYear; y <= r.EndYear; y++ {
		ss, n := 0.0, 0
		for i := range s.Value {
			if s.Year[i] == y && !math.IsNaN(s.Value[i]) {
				ss += s.Value[i]
				n++
			}
		}
		m := math.NaN()
		if n == 12 {
			m = ss / 12
		}
		r.Annual = append(r.Annual, AnnualPoint{Year: y, Mean: nan(m), NMonths: n})
	}
	return r
}

func linear(method string, o stats.OLSResult) LinearTrend {
	return LinearTrend{
		Method: method, N: o.N,
		SlopePerDecade: nan(o.Slope * 10), CILowPerDecade: nan(o.CILow * 10), CIHighPerDecade: nan(o.CIHigh * 10),
		Intercept: nan(o.Intercept), R1: nan(o.R1), NEff: nan(o.NEff), DF: nan(o.DFAdj),
		PAdjusted: nan(o.PAdj), PNaive: nan(o.PNaive), SEAdjustedDecade: nan(o.SEAdj * 10), ResidualSD: nan(o.ResidualSD),
	}
}

func rank(method string, m stats.MKResult, sen *stats.SenResult) RankTrend {
	r := RankTrend{Method: method, N: m.N, S: nan(m.S), VarS: nan(m.VarS), Z: nan(m.Z), P: nan(m.P), Tau: nan(m.Tau),
		VarianceCorrection: nan(m.VarRatio), SenPerDecade: Num(math.NaN()), SenCILowDecade: Num(math.NaN()), SenCIHighDecade: Num(math.NaN())}
	if m.VarRatio == 0 {
		r.VarianceCorrection = Num(math.NaN())
	}
	if sen != nil {
		r.SenPerDecade, r.SenCILowDecade, r.SenCIHighDecade = nan(sen.Slope*10), nan(sen.CILow*10), nan(sen.CIHigh*10)
	}
	return r
}

func fmtNum(x float64) string {
	ax := math.Abs(x)
	switch {
	case math.IsNaN(x):
		return "n/a"
	case ax == 0:
		return "0"
	case ax >= 100:
		return strconv.FormatFloat(x, 'f', 0, 64)
	case ax >= 1:
		return strconv.FormatFloat(x, 'f', 2, 64)
	case ax >= 0.01:
		return strconv.FormatFloat(x, 'f', 3, 64)
	}
	return strconv.FormatFloat(x, 'g', 2, 64)
}

func fmtP(p float64) string {
	if math.IsNaN(p) {
		return "n/a"
	}
	if p < 0.001 {
		return "< 0.001"
	}
	return "= " + strconv.FormatFloat(p, 'f', 3, 64)
}

func Analyze(s *series.Monthly, o Options) *Result {
	if o.Alpha <= 0 || o.Alpha >= 0.5 {
		o.Alpha = 0.05
	}
	if o.Now.IsZero() {
		o.Now = time.Now()
	}
	r := Prepare(s)
	r.Method = Method{
		Alpha:             o.Alpha,
		Deseasonalization: "Monthly anomalies: each value minus the mean of its calendar month over the selected period.",
		Baseline:          fmt.Sprintf("%d–%d (the full selected period)", r.StartYear, r.EndYear),
		Tests: []string{
			"Primary: OLS on monthly anomalies with AR(1) effective-sample-size adjustment (Santer et al. 2000): n_eff = n(1−r1)/(1+r1), t-test with n_eff−2 df, 95% CI.",
			"Modified Mann-Kendall test with Hamed & Rao (1998) variance correction, on monthly anomalies; Theil–Sen slope with rank-based CI.",
			"Seasonal Kendall test (Hirsch et al. 1982) on raw monthly values, as an independent check that needs no baseline.",
			"Robustness: OLS and Mann-Kendall on annual means; adjusted OLS with the first/last 3 years removed.",
		},
		VerdictRule: fmt.Sprintf("'Statistically significant' only if the adjusted OLS test AND the modified Mann-Kendall test both give p < %.2f with the same sign; 'methods disagree' if exactly one does; 'suggestive' if neither does but at least one has p < %.2f; otherwise 'not detected'. Requires ≥ %d years, ≥ %.0f%% valid months, no gap > %d months and n_eff ≥ %d.", o.Alpha, SuggestiveAlpha, MinYears, MinCoverage*100, MaxGapMonths, MinNEff),
		References: []string{
			"Santer et al. (2000) doi:10.1029/1999JD901105",
			"Hamed & Rao (1998) doi:10.1016/S0022-1694(97)00125-X",
			"Sen (1968) doi:10.1080/01621459.1968.10480934",
			"Hirsch, Slack & Smith (1982) doi:10.1029/WR018i001p00107",
		},
		CodeVersion: CodeVersion,
		ComputedAt:  o.Now.UTC().Format(time.RFC3339),
	}
	if len(r.Points) == 0 {
		r.Warnings = append(r.Warnings, "No data returned for this request.")
		return r
	}

	years := r.EndYear - r.StartYear + 1
	insufficient := []string{}
	if years < MinYears {
		insufficient = append(insufficient, fmt.Sprintf("the period covers %d years; at least %d are required", years, MinYears))
	} else if years < RecommendedYears {
		r.Warnings = append(r.Warnings, fmt.Sprintf("Only %d years selected. For climate variables, 20–30+ years are recommended; short records are dominated by natural variability.", years))
	}
	if r.Coverage.Fraction < MinCoverage {
		insufficient = append(insufficient, fmt.Sprintf("only %.0f%% of months have valid data (≥ %.0f%% required)", r.Coverage.Fraction*100, MinCoverage*100))
	}
	if r.Coverage.MaxGapMonths > MaxGapMonths {
		insufficient = append(insufficient, fmt.Sprintf("the series has a gap of %d consecutive months (> %d)", r.Coverage.MaxGapMonths, MaxGapMonths))
	}

	t := make([]float64, len(r.Points))
	anom := make([]float64, len(r.Points))
	for i, p := range r.Points {
		t[i], anom[i] = p.T, float64(p.Anomaly)
	}
	ols, errO := stats.OLSAdjusted(t, anom, o.Alpha)
	hr, errH := stats.HamedRao(t, anom, o.Alpha)
	mko, _ := stats.MannKendall(anom)
	sen, errS := stats.SenSlope(t, anom, o.Alpha)
	if errO != nil || errH != nil || errS != nil {
		r.Warnings = append(r.Warnings, "Not enough valid values to compute a trend.")
		return r
	}
	tr := &Trend{
		Primary:     linear("OLS on monthly anomalies, AR(1)-adjusted (Santer et al. 2000)", ols),
		MannKendall: rank("Modified Mann-Kendall (Hamed & Rao 1998) + Theil–Sen slope", hr, &sen),
		MKOriginal:  rank("Original Mann-Kendall (assumes independent values; shown for transparency)", mko, nil),
		Causality:   "A statistical trend describes change in this dataset. It does not by itself identify the cause of the change.",
	}

	seasons, yrs := stats.SplitSeasons(s.Value, s.Month, s.Year, 12)
	if sk, err := stats.SeasonalKendall(seasons, yrs); err == nil {
		rt := rank("Seasonal Kendall (Hirsch et al. 1982) on raw monthly values", sk.MKResult, nil)
		rt.SenPerDecade = nan(sk.SenSlopePerYear * 10)
		tr.Seasonal = &rt
	}

	var at, av []float64
	for _, a := range r.Annual {
		at = append(at, float64(a.Year)+0.5)
		av = append(av, float64(a.Mean))
	}
	interannualSD := math.NaN()
	if ao, err := stats.OLSAdjusted(at, av, o.Alpha); err == nil {
		lt := linear("OLS on annual means, AR(1)-adjusted", ao)
		tr.AnnualOLS = &lt
		interannualSD = ao.ResidualSD
	}
	if am, err := stats.MannKendall(av); err == nil {
		as, _ := stats.SenSlope(at, av, o.Alpha)
		rt := rank("Mann-Kendall on annual means + Theil–Sen", am, &as)
		tr.AnnualMK = &rt
	}

	if years-SensitivityDropYears >= MinYears {
		for _, c := range []struct {
			label  string
			y0, y1 int
		}{
			{fmt.Sprintf("without first %d years", SensitivityDropYears), r.StartYear + SensitivityDropYears, r.EndYear},
			{fmt.Sprintf("without last %d years", SensitivityDropYears), r.StartYear, r.EndYear - SensitivityDropYears},
		} {
			var ts, ys []float64
			for i, p := range r.Points {
				y := s.Year[i]
				if y >= c.y0 && y <= c.y1 {
					ts = append(ts, p.T)
					ys = append(ys, float64(p.Anomaly))
				}
			}
			if so, err := stats.OLSAdjusted(ts, ys, o.Alpha); err == nil {
				tr.Sensitivity = append(tr.Sensitivity, Sensitivity{Label: c.label, StartYear: c.y0, EndYear: c.y1,
					SlopePerDecade: nan(so.Slope * 10), CILowPerDecade: nan(so.CILow * 10), CIHighPerDecade: nan(so.CIHigh * 10), P: nan(so.PAdj)})
			}
		}
	}

	span := t[len(t)-1] - t[0]
	total := ols.Slope * span
	ratio := math.Abs(total) / interannualSD
	tr.Practical = Practical{SpanYears: span, TotalChange: nan(total), InterannualSD: nan(interannualSD), ChangeToNoiseRatio: nan(ratio),
		Explanation: "Statistical significance says whether a trend is distinguishable from noise; it does not say whether the change is large. 'Total change' is the fitted slope times the record length. It is compared with the typical year-to-year variability (standard deviation of detrended annual means). Whether a change of this size matters depends on the application and is not judged automatically."}

	unit := o.UnitsLabel
	if unit == "" {
		unit = s.Units
	}
	pO, pM := ols.PAdj, hr.P
	sameSign := (ols.Slope > 0) == (sen.Slope > 0)
	switch {
	case len(insufficient) > 0:
		tr.Verdict = Verdict{Code: "insufficient_data", Label: "Insufficient data",
			Explanation: "No conclusion is drawn because " + joinAnd(insufficient) + "."}
	case math.IsNaN(pO) || ols.NEff < MinNEff:
		tr.Verdict = Verdict{Code: "unreliable", Label: "Unreliable",
			Explanation: fmt.Sprintf("Strong autocorrelation leaves an effective sample size of only %.1f (< %d); a significance test is not meaningful.", ols.NEff, MinNEff)}
	case pO < o.Alpha && pM < o.Alpha && sameSign:
		dir := "increase"
		if ols.Slope < 0 {
			dir = "decrease"
		}
		tr.Verdict = Verdict{Code: "significant_" + dir, Label: "Statistically significant " + dir,
			Explanation: fmt.Sprintf("Both the autocorrelation-adjusted OLS test (p %s) and the modified Mann-Kendall test (p %s) reject 'no trend' at the %.0f%% level.", fmtP(pO), fmtP(pM), o.Alpha*100)}
	case (pO < o.Alpha) != (pM < o.Alpha) || (pO < o.Alpha && pM < o.Alpha && !sameSign):
		tr.Verdict = Verdict{Code: "methods_disagree", Label: "Methods disagree",
			Explanation: fmt.Sprintf("Adjusted OLS p %s, modified Mann-Kendall p %s. Only one method finds a significant trend, so the evidence is not robust.", fmtP(pO), fmtP(pM))}
	case pO < SuggestiveAlpha || pM < SuggestiveAlpha:
		tr.Verdict = Verdict{Code: "suggestive", Label: "Suggestive, not significant",
			Explanation: fmt.Sprintf("Adjusted OLS p %s, modified Mann-Kendall p %s: weak evidence, below the %.0f%% significance threshold.", fmtP(pO), fmtP(pM), o.Alpha*100)}
	default:
		tr.Verdict = Verdict{Code: "not_detected", Label: "No significant trend detected",
			Explanation: fmt.Sprintf("Adjusted OLS p %s, modified Mann-Kendall p %s. The data do not show a trend distinguishable from natural variability over this period. This is not proof that there is no change.", fmtP(pO), fmtP(pM))}
	}
	if ols.NEff < 30 && tr.Verdict.Code != "insufficient_data" && tr.Verdict.Code != "unreliable" {
		r.Warnings = append(r.Warnings, fmt.Sprintf("Effective sample size is %.0f after accounting for autocorrelation; the test has limited power.", ols.NEff))
	}
	for _, sv := range tr.Sensitivity {
		if !math.IsNaN(float64(sv.SlopePerDecade)) && (float64(sv.SlopePerDecade) > 0) != (ols.Slope > 0) {
			r.Warnings = append(r.Warnings, fmt.Sprintf("The trend changes sign when the period is shortened (%s). The result is sensitive to the endpoints.", sv.Label))
		}
	}

	name := o.VarName
	if name == "" {
		name = "the variable"
	}
	if tr.Verdict.Code == "insufficient_data" {
		tr.Summary = fmt.Sprintf("No trend is reported for %s: %s.", name, joinAnd(insufficient))
	} else if len(tr.Verdict.Code) > 12 && tr.Verdict.Code[:12] == "significant_" {
		dir := "increased"
		if ols.Slope < 0 {
			dir = "decreased"
		}
		tr.Summary = fmt.Sprintf("From %d to %d, %s at this location %s by %s %s per decade (95%% CI %s to %s; adjusted OLS on monthly anomalies). Verdict: %s. %s",
			r.StartYear, r.EndYear, name, dir, fmtNum(math.Abs(ols.Slope*10)), unit, fmtNum(ols.CILow*10), fmtNum(ols.CIHigh*10), tr.Verdict.Label, tr.Causality)
	} else {
		tr.Summary = fmt.Sprintf("From %d to %d, the fitted linear trend of %s at this location is %s %s per decade (95%% CI %s to %s), but the evidence does not support a confident conclusion. Verdict: %s.",
			r.StartYear, r.EndYear, name, fmtNum(ols.Slope*10), unit, fmtNum(ols.CILow*10), fmtNum(ols.CIHigh*10), tr.Verdict.Label)
	}
	r.Trend = tr
	return r
}

func joinAnd(xs []string) string {
	switch len(xs) {
	case 0:
		return ""
	case 1:
		return xs[0]
	}
	out := ""
	for i, x := range xs {
		switch {
		case i == 0:
			out = x
		case i == len(xs)-1:
			out += " and " + x
		default:
			out += ", " + x
		}
	}
	return out
}
