package stats

import (
	"math"
	"sort"
)

type OLSResult struct {
	N          int     `json:"n"`
	Slope      float64 `json:"slope"`
	Intercept  float64 `json:"intercept"`
	R1         float64 `json:"r1"`
	NEff       float64 `json:"n_eff"`
	SE         float64 `json:"se"`
	SEAdj      float64 `json:"se_adj"`
	DFAdj      float64 `json:"df_adj"`
	TAdj       float64 `json:"t_adj"`
	PNaive     float64 `json:"p_naive"`
	PAdj       float64 `json:"p_adj"`
	CILow      float64 `json:"ci_low"`
	CIHigh     float64 `json:"ci_high"`
	ResidualSD float64 `json:"residual_sd"`
}

func OLSAdjusted(t, y []float64, alpha float64) (OLSResult, error) {
	tv, yv := valid(t, y)
	n := len(yv)
	if n < 4 {
		return OLSResult{}, ErrTooFew
	}
	tm, ym := Mean(tv), Mean(yv)
	sxx, sxy := 0.0, 0.0
	for i := range tv {
		sxx += (tv[i] - tm) * (tv[i] - tm)
		sxy += (tv[i] - tm) * (yv[i] - ym)
	}
	if sxx == 0 {
		return OLSResult{}, ErrTooFew
	}
	b := sxy / sxx
	a := ym - b*tm
	e := make([]float64, n)
	sse := 0.0
	for i := range tv {
		e[i] = yv[i] - (a + b*tv[i])
		sse += e[i] * e[i]
	}
	num := 0.0
	for i := 0; i+1 < n; i++ {
		num += e[i] * e[i+1]
	}
	r1 := 0.0
	if sse > 0 {
		r1 = num / sse
	}
	fn := float64(n)
	neff := fn
	if r1 > 0 {
		neff = fn * (1 - r1) / (1 + r1)
	}
	res := OLSResult{N: n, Slope: b, Intercept: a, R1: r1, NEff: neff}
	res.SE = math.Sqrt(sse / (fn - 2) / sxx)
	res.ResidualSD = math.Sqrt(sse / (fn - 2))
	res.PNaive = TwoSidedTP(b/res.SE, fn-2)
	if neff <= 2.5 {

		res.SEAdj, res.DFAdj, res.TAdj, res.PAdj = math.NaN(), neff-2, math.NaN(), math.NaN()
		res.CILow, res.CIHigh = math.NaN(), math.NaN()
		return res, nil
	}
	res.DFAdj = neff - 2
	res.SEAdj = math.Sqrt(sse / res.DFAdj / sxx)
	res.TAdj = b / res.SEAdj
	res.PAdj = TwoSidedTP(res.TAdj, res.DFAdj)
	q := StudentTQuantile(1-alpha/2, res.DFAdj)
	res.CILow, res.CIHigh = b-q*res.SEAdj, b+q*res.SEAdj
	return res, nil
}

type MKResult struct {
	N        int     `json:"n"`
	S        float64 `json:"s"`
	VarS     float64 `json:"var_s"`
	Z        float64 `json:"z"`
	P        float64 `json:"p"`
	Tau      float64 `json:"tau"`
	VarRatio float64 `json:"variance_correction,omitempty"`
}

func sign(v float64) float64 {
	switch {
	case v > 0:
		return 1
	case v < 0:
		return -1
	}
	return 0
}

func mkScore(x []float64) float64 {
	s := 0.0
	for i := 0; i < len(x)-1; i++ {
		for j := i + 1; j < len(x); j++ {
			s += sign(x[j] - x[i])
		}
	}
	return s
}

func mkVariance(x []float64) float64 {
	n := float64(len(x))
	v := n * (n - 1) * (2*n + 5)
	for _, tp := range tieGroups(x) {
		v -= tp * (tp - 1) * (2*tp + 5)
	}
	return v / 18
}

func mkZ(s, v float64) float64 {
	if v <= 0 {
		return 0
	}
	switch {
	case s > 0:
		return (s - 1) / math.Sqrt(v)
	case s < 0:
		return (s + 1) / math.Sqrt(v)
	}
	return 0
}

func MannKendall(y []float64) (MKResult, error) {
	x := Compact(y)
	n := len(x)
	if n < 4 {
		return MKResult{}, ErrTooFew
	}
	s := mkScore(x)
	v := mkVariance(x)
	z := mkZ(s, v)
	return MKResult{N: n, S: s, VarS: v, Z: z, P: TwoSidedNormalP(z),
		Tau: s / (0.5 * float64(n) * float64(n-1))}, nil
}

func acf(x []float64, nlags int) []float64 {
	n := len(x)
	m := Mean(x)
	y := make([]float64, n)
	for i := range x {
		y[i] = x[i] - m
	}
	out := make([]float64, nlags+1)
	c0 := 0.0
	for i := range y {
		c0 += y[i] * y[i]
	}
	for k := 0; k <= nlags; k++ {
		c := 0.0
		for i := 0; i+k < n; i++ {
			c += y[i] * y[i+k]
		}
		if c0 == 0 {
			out[k] = 0
		} else {
			out[k] = c / c0
		}
	}
	return out
}

func HamedRao(t, y []float64, alpha float64) (MKResult, error) {
	tv, x := valid(t, y)
	n := len(x)
	if n < 4 {
		return MKResult{}, ErrTooFew
	}
	s := mkScore(x)
	v := mkVariance(x)
	sen, err := SenSlope(tv, x, alpha)
	if err != nil {
		return MKResult{}, err
	}
	det := make([]float64, n)
	for i := range x {
		det[i] = x[i] - tv[i]*sen.Slope
	}
	r := acf(Ranks(det), n-1)
	bound := NormalQuantile(1-alpha/2) / math.Sqrt(float64(n))
	fn := float64(n)
	sni := 0.0
	for i := 1; i < n; i++ {
		if r[i] > bound || r[i] < -bound {
			fi := float64(i)
			sni += (fn - fi) * (fn - fi - 1) * (fn - fi - 2) * r[i]
		}
	}
	ratio := 1 + 2/(fn*(fn-1)*(fn-2))*sni
	v *= ratio
	z := mkZ(s, v)
	return MKResult{N: n, S: s, VarS: v, Z: z, P: TwoSidedNormalP(z),
		Tau: s / (0.5 * fn * (fn - 1)), VarRatio: ratio}, nil
}

type SenResult struct {
	N         int     `json:"n"`
	Slope     float64 `json:"slope"`
	Intercept float64 `json:"intercept"`
	CILow     float64 `json:"ci_low"`
	CIHigh    float64 `json:"ci_high"`
}

func SenSlope(t, y []float64, alpha float64) (SenResult, error) {
	tv, yv := valid(t, y)
	n := len(yv)
	if n < 3 {
		return SenResult{}, ErrTooFew
	}
	sl := make([]float64, 0, n*(n-1)/2)
	for i := 0; i < n-1; i++ {
		for j := i + 1; j < n; j++ {
			dx := tv[j] - tv[i]
			if dx > 0 {
				sl = append(sl, (yv[j]-yv[i])/dx)
			} else if dx < 0 {
				sl = append(sl, (yv[i]-yv[j])/(-dx))
			}
		}
	}
	sort.Float64s(sl)
	med := Median(sl)
	res := SenResult{N: n, Slope: med}

	res.Intercept = Median(yv) - med*Median(tv)

	fn := float64(n)
	sig2 := fn * (fn - 1) * (2*fn + 5)
	for _, k := range tieGroups(tv) {
		sig2 -= k * (k - 1) * (2*k + 5)
	}
	for _, k := range tieGroups(yv) {
		sig2 -= k * (k - 1) * (2*k + 5)
	}
	sigma := math.Sqrt(sig2 / 18)
	z := NormalQuantile(alpha / 2)
	nt := float64(len(sl))
	ru := int(math.Min(math.RoundToEven((nt-z*sigma)/2), nt-1))
	rl := int(math.Max(math.RoundToEven((nt+z*sigma)/2)-1, 0))
	if ru < 0 || rl >= len(sl) || len(sl) == 0 {
		res.CILow, res.CIHigh = math.NaN(), math.NaN()
		return res, nil
	}
	res.CILow, res.CIHigh = sl[rl], sl[ru]
	return res, nil
}

type SeasonalKendallResult struct {
	MKResult
	SenSlopePerYear float64 `json:"sen_slope_per_year"`
	Seasons         int     `json:"seasons_used"`
}

func SeasonalKendall(seasons [][]float64, years []float64) (SeasonalKendallResult, error) {
	var s, v, denom float64
	var slopes []float64
	used, ntot := 0, 0
	for _, col := range seasons {
		yrs, vals := valid(years, col)
		n := len(vals)
		if n < 2 {
			continue
		}
		used++
		ntot += n
		s += mkScore(vals)
		v += mkVariance(vals)
		denom += float64(n*(n-1)) / 2
		for i := 0; i < n-1; i++ {
			for j := i + 1; j < n; j++ {
				slopes = append(slopes, (vals[j]-vals[i])/(yrs[j]-yrs[i]))
			}
		}
	}
	if used == 0 || denom == 0 {
		return SeasonalKendallResult{}, ErrTooFew
	}
	z := mkZ(s, v)
	return SeasonalKendallResult{
		MKResult:        MKResult{N: ntot, S: s, VarS: v, Z: z, P: TwoSidedNormalP(z), Tau: s / denom},
		SenSlopePerYear: Median(slopes),
		Seasons:         used,
	}, nil
}

type WelchResult struct {
	NA, NB int
	MeanA  float64
	MeanB  float64
	Diff   float64
	SE     float64
	DF     float64
	T      float64
	P      float64
	CILow  float64
	CIHigh float64
}

func Welch(a, b []float64, alpha float64) (WelchResult, error) {
	a, b = Compact(a), Compact(b)
	if len(a) < 2 || len(b) < 2 {
		return WelchResult{}, ErrTooFew
	}
	ma, mb := Mean(a), Mean(b)
	va, vb := math.Pow(StdDev(a), 2), math.Pow(StdDev(b), 2)
	na, nb := float64(len(a)), float64(len(b))
	qa, qb := va/na, vb/nb
	se := math.Sqrt(qa + qb)
	r := WelchResult{NA: len(a), NB: len(b), MeanA: ma, MeanB: mb, Diff: mb - ma, SE: se}
	if se == 0 {
		r.T, r.P, r.CILow, r.CIHigh, r.DF = math.NaN(), math.NaN(), r.Diff, r.Diff, na+nb-2
		return r, nil
	}
	r.DF = (qa + qb) * (qa + qb) / (qa*qa/(na-1) + qb*qb/(nb-1))
	r.T = r.Diff / se
	r.P = TwoSidedTP(r.T, r.DF)
	q := StudentTQuantile(1-alpha/2, r.DF)
	r.CILow, r.CIHigh = r.Diff-q*se, r.Diff+q*se
	return r, nil
}

func SplitSeasons(v []float64, season, year []int, period int) ([][]float64, []float64) {
	if len(v) == 0 {
		return nil, nil
	}
	y0, y1 := year[0], year[0]
	for _, y := range year {
		if y < y0 {
			y0 = y
		}
		if y > y1 {
			y1 = y
		}
	}
	ny := y1 - y0 + 1
	years := make([]float64, ny)
	for i := range years {
		years[i] = float64(y0 + i)
	}
	out := make([][]float64, period)
	for s := range out {
		out[s] = make([]float64, ny)
		for i := range out[s] {
			out[s][i] = math.NaN()
		}
	}
	for i := range v {
		if season[i] >= 1 && season[i] <= period {
			out[season[i]-1][year[i]-y0] = v[i]
		}
	}
	return out, years
}
