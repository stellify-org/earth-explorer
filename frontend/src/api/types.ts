export type DataKind =
  | "observation" | "satellite_retrieval" | "reanalysis" | "model_estimate"
  | "climate_projection" | "derived_from_reanalysis" | "imagery" | "event_catalog";

export interface Citation { text: string; doi?: string; url?: string }

export interface Variable {
  id: string; name: string; description: string; theme: string;
  provider: string; provider_parameter: string;
  units: string; units_label: string; data_kind: DataKind;
  upstream_products: string[]; spatial_resolution: string; temporal_resolution: string;
  coverage_start_year: number; coverage_end_note: string; global: boolean;
  limitations: string[]; citations: Citation[]; related_gibs_layer?: string;
}

export interface DatasetsResponse { variables: Variable[]; data_kinds: Record<DataKind, string> }

export interface Interval { start: string; end: string; period: string }

export interface Layer {
  id: string; group: "base" | "true_color" | "science" | "reference";
  short_name: string; measures: string; data_resolution_note: string; caveat?: string;
  default_on?: boolean; quantitative: boolean;
  title: string; format: string; tile_matrix_set: string; max_level: number; url_template: string;
  time_enabled: boolean; default_date?: string; intervals?: Interval[];
  intervals_maybe_truncated?: boolean; legend_url?: string; attribution: string;
}

export interface Availability {
  requested: string; shown: string; exact: boolean; delta_days: number;
  previous?: string; next?: string; first: string; last: string; gibs_time_actual?: string;
}

export interface Provenance {
  provider: string; api_name?: string; api_version?: string; upstream_sources?: string[];
  parameter: string; long_name?: string; request_url: string; retrieved_at: string; from_cache: boolean;
  messages?: string[];
  stale?: boolean;
}

export type N = number | null;

export interface Point { date: string; t: number; value: N; anomaly: N }
export interface ClimMonth { month: number; mean: N; n_years: number }
export interface AnnualPoint { year: number; mean: N; n_months: number }

export interface LinearTrend {
  method: string; n: number; slope_per_decade: N; ci_low_per_decade: N; ci_high_per_decade: N;
  intercept: N; lag1_autocorrelation: N; n_eff: N; df: N; p_value: N; p_value_naive: N;
  se_per_decade: N; residual_sd: N;
}
export interface RankTrend {
  method: string; n: number; s: N; var_s: N; z: N; p_value: N; tau: N; variance_correction?: N;
  sen_slope_per_decade: N; sen_ci_low_per_decade: N; sen_ci_high_per_decade: N;
}
export interface Sensitivity { label: string; start_year: number; end_year: number; slope_per_decade: N; ci_low_per_decade: N; ci_high_per_decade: N; p_value: N }
export interface Verdict { code: string; label: string; explanation: string }
export interface Trend {
  primary: LinearTrend; mann_kendall: RankTrend; mann_kendall_unadjusted: RankTrend;
  seasonal_kendall?: RankTrend; annual_ols?: LinearTrend; annual_mann_kendall?: RankTrend;
  sensitivity: Sensitivity[] | null;
  practical: { span_years: number; total_change: N; interannual_sd: N; change_to_variability_ratio: N; explanation: string };
  verdict: Verdict; summary: string; causality_note: string;
}
export interface Method { alpha: number; deseasonalization: string; baseline: string; tests: string[]; verdict_rule: string; references: string[]; code_version: string; computed_at: string }
export interface AnalysisResult {
  start_year: number; end_year: number; units: string; points: Point[]; climatology: ClimMonth[];
  annual: AnnualPoint[]; coverage: { n_months: number; n_valid: number; fraction: number; max_gap_months: number };
  trend: Trend | null; warnings: string[] | null; method: Method; provenance: Provenance;
}
export interface Location { lat: number; lon: number; elevation_m?: number; elevation_note?: string; cell_note: string }
export interface TrendResponse { variable: Variable; location: Location; result: AnalysisResult }

export interface CompareResponse {
  variable: Variable; location: Location; units: string; notes: string[]; provenance: Provenance;
  period_a: { start: number; end: number; n_years: number; mean: N };
  period_b: { start: number; end: number; n_years: number; mean: N };
  difference: { b_minus_a: N; ci_low: N; ci_high: N; p_value: N; df: N; test: string };
}

export interface Quake { id: string; lat: number; lon: number; depth_km: number; mag: number | null; mag_type: string; time: string; place: string; status: string; type: string; url: string }
export interface QuakeResponse { events: Quake[]; count: number; limit: number; possibly_truncated: boolean; ordered_by: string; request_url: string; retrieved_at: string; source: string; notes: string[] }

export interface ApiErrorBody { error: { code: string; message: string; field?: string } }

export interface GridCell { lat: number; lon: number; months: N[]; annual: N }
export interface GridResponse {
  variable: Variable;
  grid: { year: number; units: string; bbox: [number, number, number, number]; dlat: number; dlon: number; cells: GridCell[]; provenance: Provenance };
  notes: string[];
}

export interface VisVariable {
  id: string; name: string; units: string; units_label: string; dataset: string; data_kind: DataKind;
  palette: string; anom_palette?: string; modes: ("surface" | "shell" | "extrude" | "flow")[]; anomaly: boolean;
  vector?: [string, string]; shell_alpha: "constant" | "value"; note?: string; fixed_min?: number; fixed_max?: number;
  first: string; last: string; missing: string[]; count: number;

  months: string[]; years: string[]; long_name?: string; definition?: string; source: string;
}
export interface VisCatalog { version: string; variables: VisVariable[]; lod: Record<string, string>; citation: string; precision: string }
