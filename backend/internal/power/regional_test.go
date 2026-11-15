package power

import "testing"

func TestRegionBoxStaysWithinLimitsAndBounds(t *testing.T) {
	cases := [][2]float64{{38.56, 68.78}, {89, 0}, {-89, 179.9}, {0, -179.9}}
	for _, c := range cases {
		a, b, x, y := RegionBox(c[0], c[1])
		if b-a > MaxRegionalSpan || y-x > MaxRegionalSpan || a < -90 || b > 90 || x < -180 || y > 180 {
			t.Errorf("%v -> [%v %v %v %v]", c, a, b, x, y)
		}
		if c[0] < a || c[0] > b || c[1] < x || c[1] > y {
			t.Errorf("%v not inside its box [%v %v %v %v]", c, a, b, x, y)
		}
	}
}
