package stats

import (
	"math/rand/v2"
	"testing"
)

// Monte-Carlo calibration (docs/SCIENTIFIC_METHODS.md §12): with zero true
// slope and AR(1) noise, the autocorrelation-adjusted tests should reject at
// roughly the nominal 5% rate, while the naive OLS test is inflated; with a
// true slope, the adjusted 95% CI should cover it roughly 95% of the time.
func TestCalibrationAR1(t *testing.T) {
	if testing.Short() {
		t.Skip("monte-carlo")
	}
	const sims, n, phi, alpha = 600, 240, 0.6, 0.05
	rng := rand.New(rand.NewPCG(1, 2))
	tt := make([]float64, n)
	for i := range tt {
		tt[i] = float64(i) / 12
	}
	var naive, adj, hr, both, cover int
	const trueSlope = 0.05
	for s := 0; s < sims; s++ {
		y := make([]float64, n)
		y2 := make([]float64, n)
		e := 0.0
		for i := range y {
			e = phi*e + rng.NormFloat64()
			y[i] = e
			y2[i] = trueSlope*tt[i] + e
		}
		o, _ := OLSAdjusted(tt, y, alpha)
		if o.PNaive < alpha {
			naive++
		}
		if o.PAdj < alpha {
			adj++
		}
		m, _ := HamedRao(tt, y, alpha)
		if m.P < alpha {
			hr++
		}
		if m.P < alpha && o.PAdj < alpha {
			both++
		}
		o2, _ := OLSAdjusted(tt, y2, alpha)
		if o2.CILow <= trueSlope && trueSlope <= o2.CIHigh {
			cover++
		}
	}
	fn, fa, fh, fb, cv := float64(naive)/sims, float64(adj)/sims, float64(hr)/sims, float64(both)/sims, float64(cover)/sims
	t.Logf("false-positive rate: naive OLS %.3f, Santer-adjusted OLS %.3f, Hamed-Rao MK %.3f, both agree %.3f; CI coverage %.3f", fn, fa, fh, fb, cv)
	if fn < 0.15 {
		t.Errorf("naive OLS should be clearly inflated under AR(1) noise, got %.3f", fn)
	}
	if fa > 0.09 {
		t.Errorf("adjusted OLS false-positive rate too high: %.3f", fa)
	}
	// Hamed-Rao alone is known to be anti-conservative under strong AR(1)
	// noise (pymannkendall reproduces ~14% at phi=0.6, n=240). This is why the
	// "significant" verdict requires agreement with the adjusted OLS test.
	if fh > 0.25 {
		t.Errorf("Hamed-Rao false-positive rate regressed: %.3f", fh)
	}
	if fb > 0.07 {
		t.Errorf("verdict rule (both tests significant) false-positive rate too high: %.3f", fb)
	}
	if cv < 0.90 {
		t.Errorf("adjusted CI coverage too low: %.3f", cv)
	}
}
