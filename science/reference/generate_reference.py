"""Generate independent reference values for the Go statistics module.

Run:  science/.venv/bin/python -I science/reference/generate_reference.py

Reference implementations (not our code):
  * statsmodels OLS                      -> slope, naive SE / p
  * scipy.stats.theilslopes              -> Sen slope + CI
  * pymannkendall.original_test          -> Mann-Kendall S, Var(S), Z, p, tau
  * pymannkendall.hamed_rao_modification_test
  * pymannkendall.seasonal_test (period=12)
The AR(1) effective-sample-size adjustment (Santer et al. 2000) is re-implemented
here independently with numpy/scipy from the published formulas.

Inputs: real NASA POWER responses in data/fixtures/ and seeded synthetic series.
Output: backend/internal/stats/testdata/stats_reference.json
"""

from __future__ import annotations

import json
import pathlib
import sys

import numpy as np
import pymannkendall as mk
import scipy
import statsmodels
import statsmodels.api as sm
from scipy import stats

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIX = ROOT / "data" / "fixtures"
OUT = ROOT / "backend" / "internal" / "stats" / "testdata" / "stats_reference.json"
ALPHA = 0.05
FILL = -999.0


def power_monthly(path: pathlib.Path, param: str):
    """Return (frac_year, month, year, values) for monthly keys, skipping the '13' annual key."""
    d = json.loads(path.read_text())
    p = d["properties"]["parameter"][param]
    t, mo, yr, v = [], [], [], []
    for k in sorted(p):
        y, m = int(k[:4]), int(k[4:])
        if m == 13:
            continue
        val = p[k]
        t.append(y + (m - 0.5) / 12.0)
        mo.append(m)
        yr.append(y)
        v.append(np.nan if val == FILL else float(val))
    return np.array(t), np.array(mo), np.array(yr), np.array(v)


def anomalies(month: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Subtract the month-of-year mean over the full record."""
    out = np.full_like(v, np.nan)
    for m in range(1, 13):
        sel = month == m
        out[sel] = v[sel] - np.nanmean(v[sel])
    return out


def santer(t: np.ndarray, y: np.ndarray, alpha: float):
    ok = ~np.isnan(y)
    t, y = t[ok], y[ok]
    n = len(y)
    X = sm.add_constant(t)
    fit = sm.OLS(y, X).fit()
    b = float(fit.params[1])
    e = fit.resid
    r1 = float(np.sum(e[:-1] * e[1:]) / np.sum(e * e))
    neff = n * (1 - r1) / (1 + r1) if r1 > 0 else float(n)
    sxx = float(np.sum((t - t.mean()) ** 2))
    df = neff - 2
    se_adj = float(np.sqrt(np.sum(e * e) / df / sxx))
    tstat = b / se_adj
    p_adj = float(2 * stats.t.sf(abs(tstat), df))
    q = float(stats.t.ppf(1 - alpha / 2, df))
    return {
        "n": n,
        "slope": b,
        "intercept": float(fit.params[0]),
        "se": float(fit.bse[1]),
        "p_naive": float(fit.pvalues[1]),
        "r1": r1,
        "n_eff": float(neff),
        "se_adj": se_adj,
        "p_adj": p_adj,
        "ci_low": b - q * se_adj,
        "ci_high": b + q * se_adj,
    }


def mk_dict(r) -> dict:
    return {"s": float(r.s), "var_s": float(r.var_s), "z": float(r.z), "p": float(r.p), "tau": float(r.Tau)}


def case(name: str, kind: str, t, month, year, y, source: str, seasonal_raw=None):
    ts = stats.theilslopes(y[~np.isnan(y)], t[~np.isnan(y)], alpha=0.95)
    c = {
        "name": name,
        "kind": kind,
        "source": source,
        "t": [float(x) for x in t],
        "month": [int(x) for x in month],
        "year": [int(x) for x in year],
        "y": [None if np.isnan(x) else float(x) for x in y],
        "ols_santer": santer(np.asarray(t), np.asarray(y), ALPHA),
        "mk_original": mk_dict(mk.original_test(y, alpha=ALPHA)),
        "mk_hamed_rao": mk_dict(mk.hamed_rao_modification_test(y, alpha=ALPHA)),
        "sen": {"slope": float(ts.slope), "intercept": float(ts.intercept),
                "ci_low": float(ts.low_slope), "ci_high": float(ts.high_slope)},
    }
    if seasonal_raw is not None:
        r = mk.seasonal_test(seasonal_raw, period=12, alpha=ALPHA)
        c["seasonal_raw"] = [None if np.isnan(x) else float(x) for x in seasonal_raw]
        c["seasonal_kendall"] = mk_dict(r) | {"sen_slope_per_year": float(r.slope)}
    return c


def main() -> None:
    cases = []
    for fname, label in [
        ("power_monthly_T2M_PRECTOTCORR_38.56N_68.78E_1981-2025.json", "dushanbe"),
        ("power_monthly_T2M_PRECTOTCORR_-3.0S_-60.0W_1981-2025.json", "amazon"),
    ]:
        for param in ("T2M", "PRECTOTCORR"):
            t, mo, yr, v = power_monthly(FIX / fname, param)
            a = anomalies(mo, v)
            cases.append(case(f"power_{label}_{param}_anomaly", "real", t, mo, yr, a,
                              f"NASA POWER monthly point, data/fixtures/{fname}", seasonal_raw=v))
            years = np.unique(yr)
            am = np.array([np.nanmean(v[yr == y]) for y in years])
            cases.append(case(f"power_{label}_{param}_annual", "real", years.astype(float),
                              np.zeros_like(years), years, am, f"annual mean of {fname}"))

    rng = np.random.default_rng(20261105)
    n = 480
    t = 1990 + (np.arange(n) + 0.5) / 12
    e = np.zeros(n)
    for i in range(1, n):
        e[i] = 0.6 * e[i - 1] + rng.normal(0, 0.5)
    y = 0.02 * (t - t[0]) + e
    y[[17, 18, 200, 333]] = np.nan
    mo = (np.arange(n) % 12) + 1
    yr = 1990 + np.arange(n) // 12
    cases.append(case("synthetic_ar1_trend_with_gaps", "synthetic", t, mo, yr, y,
                      "seed 20261105, slope 0.02/yr, AR(1) phi=0.6 sigma=0.5"))

    yt = np.clip(np.round(rng.normal(1, 2, 240) + np.linspace(0, 1.5, 240)), 0, None)
    t2 = 2000 + (np.arange(240) + 0.5) / 12
    cases.append(case("synthetic_ties", "synthetic", t2, (np.arange(240) % 12) + 1,
                      2000 + np.arange(240) // 12, yt, "seed 20261105, rounded, clipped at 0"))

    out = {
        "generated_by": "science/reference/generate_reference.py",
        "versions": {"python": sys.version.split()[0], "numpy": np.__version__, "scipy": scipy.__version__,
                     "statsmodels": statsmodels.__version__, "pymannkendall": mk.__version__},
        "alpha": ALPHA,
        "cases": cases,
    }
    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT} ({len(cases)} cases)")


if __name__ == "__main__":
    main()
