package visgrid

type Mode string

const (
	ModeSurface Mode = "surface"
	ModeShell   Mode = "shell"
	ModeExtrude Mode = "extrude"
	ModeFlow    Mode = "flow"
)

type VisVariable struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Units       string   `json:"units"`
	UnitsLabel  string   `json:"units_label"`
	Dataset     string   `json:"dataset"`
	DataKind    string   `json:"data_kind"`
	Palette     string   `json:"palette"`
	AnomPalette string   `json:"anom_palette"`
	Modes       []Mode   `json:"modes"`
	Anomaly     bool     `json:"anomaly"`
	Vector      []string `json:"vector,omitempty"`
	ShellAlpha  string   `json:"shell_alpha"`
	Note        string   `json:"note,omitempty"`

	FixedMin *float64 `json:"fixed_min,omitempty"`
	FixedMax *float64 `json:"fixed_max,omitempty"`
}

func f(x float64) *float64 { return &x }

var Catalog = []VisVariable{
	{ID: "t2m", Name: "Near-surface air temperature (2 m)", Units: "C", UnitsLabel: "°C", Dataset: "power-merra2",
		DataKind: "derived_from_reanalysis", Palette: "temperature", AnomPalette: "anomaly",
		Modes: []Mode{ModeSurface, ModeShell, ModeExtrude}, Anomaly: true, ShellAlpha: "constant",
		FixedMin: f(-40), FixedMax: f(40)},
	{ID: "precip", Name: "Precipitation (corrected)", Units: "mm/day", UnitsLabel: "mm/day", Dataset: "power-merra2",
		DataKind: "derived_from_reanalysis", Palette: "precipitation", AnomPalette: "anomaly_wet",
		Modes: []Mode{ModeSurface, ModeShell, ModeExtrude}, Anomaly: true, ShellAlpha: "value",
		FixedMin: f(0), FixedMax: f(15)},
	{ID: "soilwet", Name: "Root-zone soil wetness", Units: "1", UnitsLabel: "fraction (0–1)", Dataset: "power-merra2",
		DataKind: "derived_from_reanalysis", Palette: "soil", AnomPalette: "anomaly_wet",
		Modes: []Mode{ModeSurface, ModeExtrude}, Anomaly: true, ShellAlpha: "constant",
		FixedMin: f(0), FixedMax: f(1), Note: "Land only; model estimate of the fraction of water in the root zone (upper ~1 m)."},
	{ID: "qv2m", Name: "Specific humidity (2 m)", Units: "g/kg", UnitsLabel: "g/kg", Dataset: "power-merra2",
		DataKind: "derived_from_reanalysis", Palette: "humidity", AnomPalette: "anomaly_wet",
		Modes: []Mode{ModeSurface, ModeShell, ModeExtrude}, Anomaly: true, ShellAlpha: "value",
		FixedMin: f(0), FixedMax: f(22)},
	{ID: "rh2m", Name: "Relative humidity (2 m)", Units: "%", UnitsLabel: "%", Dataset: "power-merra2",
		DataKind: "derived_from_reanalysis", Palette: "humidity", AnomPalette: "anomaly_wet",
		Modes: []Mode{ModeSurface, ModeShell, ModeExtrude}, Anomaly: true, ShellAlpha: "value",
		FixedMin: f(0), FixedMax: f(100)},
	{ID: "wind10m", Name: "Wind at 10 m (monthly-mean vector)", Units: "m/s", UnitsLabel: "m/s", Dataset: "power-merra2",
		DataKind: "derived_from_reanalysis", Palette: "speed", Modes: []Mode{ModeFlow}, Vector: []string{"u10m", "v10m"},
		ShellAlpha: "constant",
		Note:       "Particles follow the monthly-mean eastward/northward 10 m wind components (U10M, V10M). A monthly-mean vector is not an instantaneous wind and its magnitude is not the monthly-mean wind speed."},
}

func FindVar(id string) (VisVariable, bool) {
	for _, v := range Catalog {
		if v.ID == id {
			return v, true
		}
	}
	return VisVariable{}, false
}
