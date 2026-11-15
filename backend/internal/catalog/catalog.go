package catalog

type DataKind string

const (
	KindObservation DataKind = "observation"
	KindRetrieval   DataKind = "satellite_retrieval"
	KindReanalysis  DataKind = "reanalysis"
	KindModel       DataKind = "model_estimate"
	KindProjection  DataKind = "climate_projection"
	KindDerived     DataKind = "derived_from_reanalysis"
	KindImagery     DataKind = "imagery"
	KindCatalog     DataKind = "event_catalog"
)

type Citation struct {
	Text string `json:"text"`
	DOI  string `json:"doi,omitempty"`
	URL  string `json:"url,omitempty"`
}

type Variable struct {
	ID                 string     `json:"id"`
	Name               string     `json:"name"`
	Description        string     `json:"description"`
	Theme              string     `json:"theme"`
	Provider           string     `json:"provider"`
	ProviderParameter  string     `json:"provider_parameter"`
	Units              string     `json:"units"`
	UnitsLabel         string     `json:"units_label"`
	DataKind           DataKind   `json:"data_kind"`
	UpstreamProducts   []string   `json:"upstream_products"`
	SpatialResolution  string     `json:"spatial_resolution"`
	TemporalResolution string     `json:"temporal_resolution"`
	CoverageStart      int        `json:"coverage_start_year"`
	CoverageEndNote    string     `json:"coverage_end_note"`
	Global             bool       `json:"global"`
	Limitations        []string   `json:"limitations"`
	Citations          []Citation `json:"citations"`
	RelatedGIBSLayer   string     `json:"related_gibs_layer,omitempty"`
}

var powerCitations = []Citation{
	{Text: "The data was obtained from the National Aeronautics and Space Administration (NASA) Langley Research Center (LaRC) Prediction of Worldwide Energy Resources (POWER) Project funded through the NASA Earth Science Division.", URL: "https://power.larc.nasa.gov/docs/referencing/"},
}

var merra2Citation = Citation{
	Text: "Global Modeling and Assimilation Office (GMAO) (2015), MERRA-2 tavgM_2d_slv_Nx: 2d, Monthly mean, Time-Averaged, Single-Level, Assimilation, Single-Level Diagnostics V5.12.4. Gelaro et al. (2017), J. Climate.",
	DOI:  "10.5067/AP1B0BA5PD2K",
}

var merra2Paper = Citation{Text: "Gelaro, R., et al. (2017). The Modern-Era Retrospective Analysis for Research and Applications, Version 2 (MERRA-2). J. Climate 30, 5419–5454.", DOI: "10.1175/JCLI-D-16-0758.1"}

var commonPowerLimits = []string{
	"Values are for the reanalysis grid cell containing the point (about 50 km), not a station measurement at that exact location.",
	"Reanalysis trends can include artefacts from changes in the assimilated observing system (Gelaro et al. 2017).",
	"NASA POWER re-packages MERRA-2; comparing POWER with MERRA-2 is not an independent validation.",
}

func Variables() []Variable {
	return []Variable{
		{
			ID: "t2m", Name: "Near-surface air temperature", Theme: "heat",
			Description: "Monthly mean air temperature at 2 m above the surface.",
			Provider:    "nasa-power", ProviderParameter: "T2M",
			Units: "C", UnitsLabel: "°C", DataKind: KindDerived,
			UpstreamProducts:  []string{"MERRA-2 (GMAO)"},
			SpatialResolution: "0.5° lat × 0.625° lon (MERRA-2 grid)", TemporalResolution: "monthly",
			CoverageStart: 1981, CoverageEndNote: "through the previous complete year (POWER monthly API)",
			Global: true, Limitations: commonPowerLimits,
			Citations:        append(append([]Citation{}, powerCitations...), merra2Citation, merra2Paper),
			RelatedGIBSLayer: "MERRA2_2m_Air_Temperature_Monthly",
		},
		{
			ID: "precip", Name: "Precipitation (corrected)", Theme: "water",
			Description: "Monthly mean precipitation rate. NASA POWER's corrected precipitation product (PRECTOTCORR).",
			Provider:    "nasa-power", ProviderParameter: "PRECTOTCORR",
			Units: "mm/day", UnitsLabel: "mm/day", DataKind: KindDerived,
			UpstreamProducts:  []string{"MERRA-2 (GMAO); the correction applied is described in the POWER methodology documentation"},
			SpatialResolution: "0.5° lat × 0.625° lon (MERRA-2 grid)", TemporalResolution: "monthly",
			CoverageStart: 1981, CoverageEndNote: "through the previous complete year (POWER monthly API)",
			Global: true,
			Limitations: append([]string{
				"Precipitation is highly variable in space; a ~50 km cell average can differ strongly from local rain-gauge totals, especially in mountains.",
				"Monthly precipitation is skewed; compare the Mann-Kendall (rank-based) result with the OLS result.",
			}, commonPowerLimits...),
			Citations:        append(append([]Citation{}, powerCitations...), merra2Paper),
			RelatedGIBSLayer: "MERRA2_Precipitation_Bias_Corrected_Monthly",
		},
		{
			ID: "rh2m", Name: "Relative humidity at 2 m", Theme: "water",
			Description: "Monthly mean relative humidity at 2 m.",
			Provider:    "nasa-power", ProviderParameter: "RH2M",
			Units: "%", UnitsLabel: "%", DataKind: KindDerived,
			UpstreamProducts:  []string{"MERRA-2 (GMAO)"},
			SpatialResolution: "0.5° lat × 0.625° lon (MERRA-2 grid)", TemporalResolution: "monthly",
			CoverageStart: 1981, CoverageEndNote: "through the previous complete year (POWER monthly API)",
			Global: true,
			Limitations: append([]string{
				"Relative humidity depends on temperature; a trend in RH can arise from warming at constant moisture. Compare with specific humidity.",
			}, commonPowerLimits...),
			Citations: append(append([]Citation{}, powerCitations...), merra2Paper),
		},
		{
			ID: "qv2m", Name: "Specific humidity at 2 m", Theme: "water",
			Description: "Monthly mean specific humidity (mass of water vapour per mass of air) at 2 m.",
			Provider:    "nasa-power", ProviderParameter: "QV2M",
			Units: "g/kg", UnitsLabel: "g/kg", DataKind: KindDerived,
			UpstreamProducts:  []string{"MERRA-2 (GMAO)"},
			SpatialResolution: "0.5° lat × 0.625° lon (MERRA-2 grid)", TemporalResolution: "monthly",
			CoverageStart: 1981, CoverageEndNote: "through the previous complete year (POWER monthly API)",
			Global: true, Limitations: commonPowerLimits,
			Citations: append(append([]Citation{}, powerCitations...), merra2Paper),
		},
		{
			ID: "ws2m", Name: "Wind speed at 2 m", Theme: "atmosphere",
			Description: "Monthly mean wind speed at 2 m above the surface.",
			Provider:    "nasa-power", ProviderParameter: "WS2M",
			Units: "m/s", UnitsLabel: "m/s", DataKind: KindDerived,
			UpstreamProducts:  []string{"MERRA-2 (GMAO)"},
			SpatialResolution: "0.5° lat × 0.625° lon (MERRA-2 grid)", TemporalResolution: "monthly",
			CoverageStart: 1981, CoverageEndNote: "through the previous complete year (POWER monthly API)",
			Global: true,
			Limitations: append([]string{
				"Near-surface wind in reanalysis is strongly affected by the model's surface roughness and is less constrained by observations than temperature.",
			}, commonPowerLimits...),
			Citations: append(append([]Citation{}, powerCitations...), merra2Paper),
		},
		{
			ID: "sw_down", Name: "Surface solar irradiance (all sky)", Theme: "energy",
			Description: "Monthly mean all-sky shortwave radiation reaching the surface.",
			Provider:    "nasa-power", ProviderParameter: "ALLSKY_SFC_SW_DWN",
			Units: "MJ/m^2/day", UnitsLabel: "MJ/m²/day", DataKind: KindDerived,
			UpstreamProducts:  []string{"GEWEX SRB", "CERES SYN1deg"},
			SpatialResolution: "1° × 1°", TemporalResolution: "monthly",
			CoverageStart: 1984, CoverageEndNote: "through the previous complete year (POWER monthly API)",
			Global: true,
			Limitations: []string{
				"The record is spliced from different satellite products (POWER response lists SRB and SYN1deg). A change of source can create a step that looks like a trend; treat trends across the splice with caution.",
				"Values before 1984 are not available (returned as fill values).",
				"Values are 1° grid-cell averages.",
			},
			Citations: powerCitations,
		},
	}
}

func ByID(id string) (Variable, bool) {
	for _, v := range Variables() {
		if v.ID == id {
			return v, true
		}
	}
	return Variable{}, false
}
