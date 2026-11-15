"""Scientific checks for the reference data used to validate the Go stats module.

Run: science/.venv/bin/python -I -m pytest science/tests -q
"""
import json
import pathlib
import subprocess
import sys

import numpy as np
import pymannkendall as mk
from scipy import stats

ROOT = pathlib.Path(__file__).resolve().parents[2]
REF = ROOT / "backend" / "internal" / "stats" / "testdata" / "stats_reference.json"


def load():
    return json.loads(REF.read_text())


def test_reference_is_reproducible(tmp_path):
    """Regenerating the reference from the fixtures must give identical numbers."""
    before = load()
    subprocess.run([sys.executable, "-I", str(ROOT / "science/reference/generate_reference.py")], check=True)
    after = load()
    assert len(before["cases"]) == len(after["cases"])
    for a, b in zip(before["cases"], after["cases"]):
        assert a["name"] == b["name"]
        for k in ("slope", "p_adj", "n_eff"):
            assert np.isclose(a["ols_santer"][k], b["ols_santer"][k], rtol=1e-12)


def test_real_cases_are_labelled_real_and_use_fixtures():
    for c in load()["cases"]:
        assert c["kind"] in ("real", "synthetic")
        if c["kind"] == "real":
            assert "data/fixtures/" in c["source"] or "annual mean of" in c["source"]


def test_santer_adjustment_reduces_confidence_when_autocorrelated():
    for c in load()["cases"]:
        o = c["ols_santer"]
        if o["r1"] > 0:
            assert o["n_eff"] < o["n"]
            assert o["p_adj"] >= o["p_naive"]


def test_independent_kendall_tau_agrees_with_pymannkendall():
    """scipy's Kendall tau-b vs time should match the MK sign (independent code path)."""
    for c in load()["cases"]:
        y = np.array([np.nan if v is None else v for v in c["y"]])
        t = np.array(c["t"])
        ok = ~np.isnan(y)
        tau, _ = stats.kendalltau(t[ok], y[ok])
        assert np.sign(tau) == np.sign(c["mk_original"]["s"]) or c["mk_original"]["s"] == 0


def test_mk_detects_known_synthetic_trend():
    rng = np.random.default_rng(1)
    y = 0.05 * np.arange(200) + rng.normal(0, 1, 200)
    assert mk.original_test(y).p < 0.001
