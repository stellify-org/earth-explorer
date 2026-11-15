# Agent handoff

Running notes for whoever (human or agent) picks the work up next. Newest entry first.

## 2026-11-15 — submission deck built

**State:** done, not committed. `submission/` is untracked; nothing else in the working tree was touched
(the uncommitted changes to Makefile, docker-compose.yml, backend/Dockerfile, scripts/*, docs/DEPLOYMENT.md
and science/vis/* belong to someone else).

**Deliverables** (all under `submission/`):

- `Earth_Explorer_Stellify_NASA_2026.pptx` — 7 slides, 16:9, English, editable text and native charts.
- `Earth_Explorer_Stellify_NASA_2026.pdf` — 7 pages.
- `presentation_screenshots/` — crops used on slides; `original/` holds the untouched production screenshots.
- `PRESENTATION_NOTES.md` — sources, verified numbers, checks, Google Drive sharing steps.

**How it is built**

- `submission/build/capture.mjs` — Playwright screenshots of production (`ONLY=home,trend,events,scenario,interior`
  limits stages; a full run takes ~25 min headless, run it in the background).
- `submission/build/build_deck.py` — python-pptx generator: crops, QR (segno), two native charts from
  `build/data/dushanbe_t2m_1981_2025.json`, then the PPTX. It asserts the headline numbers against that JSON.
- PDF: `soffice --headless --convert-to pdf`.

**Verified today against production** (`/api/v1/trends?variable=t2m&lat=38.56&lon=68.78&start=1981&end=2025`):
+0.352 °C/decade, 95% CI 0.213–0.492, 540/540 months, adjusted OLS p ≈ 1.1e-6, modified Mann–Kendall p ≈ 1.4e-8,
verdict "Statistically significant increase", fitted change 1.58 °C.

**Open items**

- The NASA submission and the public PDF link are the team's to do; neither has been done.
- Four event stories timed out (90 s) during capture: `us100044k6` (earthquake / ShakeMap), `EONET_26330`,
  `EONET_3153`, `EONET_20710`. Cause not investigated — could be slow headless rendering rather than an app bug.
  They are not used or claimed in the deck. The failed captures were deleted.
- The deck was rendered and checked with LibreOffice only, not with PowerPoint itself.
- `docs/AGENT_HANDOFF.md` did not exist before this entry; `audit/EARTH_EXPLORER_AUDIT.pdf`, referenced by the
  original task, does not exist in the repository either.
