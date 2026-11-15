package stats

import (
	"errors"
	"math"
	"sort"

	"gonum.org/v1/gonum/stat/distuv"
)

var ErrTooFew = errors.New("stats: not enough valid values")

func NormalCDF(z float64) float64 { return 0.5 * math.Erfc(-z/math.Sqrt2) }

func NormalQuantile(p float64) float64 {
	return distuv.UnitNormal.Quantile(p)
}

func TwoSidedNormalP(z float64) float64 { return 2 * (1 - NormalCDF(math.Abs(z))) }

func StudentTQuantile(p, df float64) float64 {
	return distuv.StudentsT{Mu: 0, Sigma: 1, Nu: df}.Quantile(p)
}

func TwoSidedTP(t, df float64) float64 {
	d := distuv.StudentsT{Mu: 0, Sigma: 1, Nu: df}
	return 2 * d.Survival(math.Abs(t))
}

func valid(t, y []float64) (tv, yv []float64) {
	for i := range y {
		if math.IsNaN(y[i]) || (t != nil && math.IsNaN(t[i])) {
			continue
		}
		if t != nil {
			tv = append(tv, t[i])
		}
		yv = append(yv, y[i])
	}
	return tv, yv
}

func Compact(y []float64) []float64 {
	_, yv := valid(nil, y)
	return yv
}

func Mean(y []float64) float64 {
	s, n := 0.0, 0
	for _, v := range y {
		if !math.IsNaN(v) {
			s += v
			n++
		}
	}
	if n == 0 {
		return math.NaN()
	}
	return s / float64(n)
}

func StdDev(y []float64) float64 {
	yv := Compact(y)
	if len(yv) < 2 {
		return math.NaN()
	}
	m := Mean(yv)
	ss := 0.0
	for _, v := range yv {
		ss += (v - m) * (v - m)
	}
	return math.Sqrt(ss / float64(len(yv)-1))
}

func Median(x []float64) float64 {
	if len(x) == 0 {
		return math.NaN()
	}
	c := append([]float64(nil), x...)
	sort.Float64s(c)
	m := len(c) / 2
	if len(c)%2 == 1 {
		return c[m]
	}
	return (c[m-1] + c[m]) / 2
}

func Ranks(x []float64) []float64 {
	n := len(x)
	idx := make([]int, n)
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return x[idx[a]] < x[idx[b]] })
	r := make([]float64, n)
	for i := 0; i < n; {
		j := i
		for j+1 < n && x[idx[j+1]] == x[idx[i]] {
			j++
		}
		avg := float64(i+j)/2 + 1
		for k := i; k <= j; k++ {
			r[idx[k]] = avg
		}
		i = j + 1
	}
	return r
}

func tieGroups(x []float64) []float64 {
	c := append([]float64(nil), x...)
	sort.Float64s(c)
	var g []float64
	for i := 0; i < len(c); {
		j := i
		for j+1 < len(c) && c[j+1] == c[i] {
			j++
		}
		if j > i {
			g = append(g, float64(j-i+1))
		}
		i = j + 1
	}
	return g
}
