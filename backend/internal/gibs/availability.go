package gibs

import (
	"fmt"
	"regexp"
	"strconv"
	"time"
)

const day = "2006-01-02"

var periodRe = regexp.MustCompile(`^P(\d+)([DMY])$`)

type step struct {
	n    int
	unit byte
}

func parseStep(p string) (step, error) {
	m := periodRe.FindStringSubmatch(p)
	if m == nil {
		return step{}, fmt.Errorf("gibs: unsupported period %q", p)
	}
	n, _ := strconv.Atoi(m[1])
	if n <= 0 {
		return step{}, fmt.Errorf("gibs: bad period %q", p)
	}
	return step{n, m[2][0]}, nil
}

func (s step) add(t time.Time, k int) time.Time {
	switch s.unit {
	case 'D':
		return t.AddDate(0, 0, k*s.n)
	case 'M':
		return t.AddDate(0, k*s.n, 0)
	}
	return t.AddDate(k*s.n, 0, 0)
}

func (s step) estimate(a, b time.Time) int {
	switch s.unit {
	case 'D':
		return int(b.Sub(a).Hours()/24) / s.n
	case 'M':
		return ((b.Year()-a.Year())*12 + int(b.Month()-a.Month())) / s.n
	}
	return (b.Year() - a.Year()) / s.n
}

type ival struct {
	s, e time.Time
	st   step
}

func parseIntervals(iv []Interval) ([]ival, error) {
	out := make([]ival, 0, len(iv))
	for _, x := range iv {
		s, err1 := time.Parse(day, x.Start)
		e, err2 := time.Parse(day, x.End)
		st, err3 := parseStep(x.Period)
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		out = append(out, ival{s, e, st})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("gibs: no parseable intervals")
	}
	return out, nil
}

func floorIn(iv ival, d time.Time) (time.Time, bool) {
	if d.Before(iv.s) {
		return time.Time{}, false
	}
	if d.After(iv.e) {
		d = iv.e
	}
	k := iv.st.estimate(iv.s, d)
	c := iv.st.add(iv.s, k)
	for c.After(d) && k > 0 {
		k--
		c = iv.st.add(iv.s, k)
	}
	for nx := iv.st.add(iv.s, k+1); !nx.After(d); nx = iv.st.add(iv.s, k+1) {
		k++
		c = nx
	}
	return c, !c.After(d)
}

func ceilIn(iv ival, d time.Time) (time.Time, bool) {
	if d.After(iv.e) {
		return time.Time{}, false
	}
	if !d.After(iv.s) {
		return iv.s, true
	}
	f, ok := floorIn(iv, d)
	if ok && f.Equal(d) {
		return f, true
	}
	k := iv.st.estimate(iv.s, f) + 1
	c := iv.st.add(iv.s, k)
	for c.Before(d) {
		k++
		c = iv.st.add(iv.s, k)
	}
	return c, !c.After(iv.e)
}

type Availability struct {
	Requested string `json:"requested"`
	Shown     string `json:"shown"`
	Exact     bool   `json:"exact"`
	DeltaDays int    `json:"delta_days"`
	Previous  string `json:"previous,omitempty"`
	Next      string `json:"next,omitempty"`
	First     string `json:"first"`
	Last      string `json:"last"`
	Actual    string `json:"gibs_time_actual,omitempty"`
}

func Snap(intervals []Interval, date string) (Availability, error) {
	d, err := time.Parse(day, date)
	if err != nil {
		return Availability{}, fmt.Errorf("invalid date %q, expected YYYY-MM-DD", date)
	}
	ivs, err := parseIntervals(intervals)
	if err != nil {
		return Availability{}, err
	}
	first, last := ivs[0].s, time.Time{}
	for _, iv := range ivs {
		if iv.s.Before(first) {
			first = iv.s
		}
		if f, ok := floorIn(iv, iv.e); ok && f.After(last) {
			last = f
		}
	}
	floor := func(t time.Time) (time.Time, bool) {
		var best time.Time
		found := false
		for _, iv := range ivs {
			if c, ok := floorIn(iv, t); ok && (!found || c.After(best)) {
				best, found = c, true
			}
		}
		return best, found
	}
	ceil := func(t time.Time) (time.Time, bool) {
		var best time.Time
		found := false
		for _, iv := range ivs {
			if c, ok := ceilIn(iv, t); ok && (!found || c.Before(best)) {
				best, found = c, true
			}
		}
		return best, found
	}
	shown, ok := floor(d)
	if !ok {
		shown, ok = ceil(d)
		if !ok {
			return Availability{}, fmt.Errorf("gibs: no available dates")
		}
	}
	a := Availability{Requested: date, Shown: shown.Format(day), Exact: shown.Equal(d),
		DeltaDays: int(shown.Sub(d).Hours() / 24), First: first.Format(day), Last: last.Format(day)}
	if p, ok := floor(shown.AddDate(0, 0, -1)); ok {
		a.Previous = p.Format(day)
	}
	if n, ok := ceil(shown.AddDate(0, 0, 1)); ok {
		a.Next = n.Format(day)
	}
	return a, nil
}
