package series

import "math"

type Provenance struct {
	Provider        string   `json:"provider"`
	APIName         string   `json:"api_name,omitempty"`
	APIVersion      string   `json:"api_version,omitempty"`
	UpstreamSources []string `json:"upstream_sources,omitempty"`
	Parameter       string   `json:"parameter"`
	LongName        string   `json:"long_name,omitempty"`
	RequestURL      string   `json:"request_url"`
	RetrievedAt     string   `json:"retrieved_at"`
	FromCache       bool     `json:"from_cache"`

	Stale    bool     `json:"stale,omitempty"`
	Messages []string `json:"messages,omitempty"`
}

type Monthly struct {
	Year       []int
	Month      []int
	Value      []float64
	Units      string
	ElevationM *float64
	Provenance Provenance
}

func (s *Monthly) FracYear() []float64 {
	t := make([]float64, len(s.Value))
	for i := range t {
		t[i] = float64(s.Year[i]) + (float64(s.Month[i])-0.5)/12
	}
	return t
}

func (s *Monthly) Slice(y0, y1 int) *Monthly {
	out := &Monthly{Units: s.Units, ElevationM: s.ElevationM, Provenance: s.Provenance}
	for i := range s.Value {
		if s.Year[i] >= y0 && s.Year[i] <= y1 {
			out.Year = append(out.Year, s.Year[i])
			out.Month = append(out.Month, s.Month[i])
			out.Value = append(out.Value, s.Value[i])
		}
	}
	return out
}

func (s *Monthly) ValidCount() int {
	n := 0
	for _, v := range s.Value {
		if !math.IsNaN(v) {
			n++
		}
	}
	return n
}
