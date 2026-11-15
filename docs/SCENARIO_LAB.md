# Scenario Lab — status and contract

Status: **inactive**. The UI page is an architecture preview and states that no simulation runs.

A scenario adapter may only be enabled when it provides:

| Field | Meaning |
|---|---|
| `physical_basis` | The published model or relation it uses, with citation/DOI |
| `validity_domain` | Variables, regions, ranges and time horizons where it is valid |
| `inputs` | Baseline observations (with provenance) and user parameters with allowed ranges |
| `outputs` | Variables, units, uncertainty (spread, CI or ensemble range) |
| `provenance` | Model version, run identifier, code version, computed_at |
| `label` | One of: observation, model projection, experimental scenario |

Requests outside every adapter's validity domain return "not supported by a validated model".
Language models may help users find catalogue entries; they never produce physical numbers.

Planned order: (1) NEX-GDDP-CMIP6 projections via NASA POWER (selection among scenarios, shown with
model spread, never on the same unlabeled axis as observations); (2) a geometric water-level
illustration on ETOPO 2022, labelled as an illustration; (3) cited empirical relations.
Physical hydrology/land-surface models need research partners. Design: ARCHITECTURE.md §5F.
