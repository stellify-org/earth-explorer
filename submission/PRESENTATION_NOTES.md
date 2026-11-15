# Earth Explorer — presentation notes (Team Stellify, NASA Space Apps 2026)

## Files

| File | What it is |
|---|---|
| `Earth_Explorer_Stellify_NASA_2026.pptx` | Editable deck, 16:9, 7 slides, English. All text and both charts are native (editable). |
| `Earth_Explorer_Stellify_NASA_2026.pdf` | Same deck, exactly 7 pages. This is the file to share. |
| `presentation_screenshots/original/` | Untouched screenshots (3200×1800) of the production app. |
| `presentation_screenshots/*.png` | The crops used on the slides (cropped only: no retouching, no rescaling). |
| `build/` | `capture.mjs` (screenshots), `build_deck.py` (deck generator), `data/` (raw API response), `assets/` (generated frames, backgrounds, QR). |

## The seven slides

1. **One Planet. Millions of Changes.** — title; the globe is the app's own globe.
2. **Can You Tell If Your City Is Getting Warmer?** — raw monthly values for four cities on four continents (Dushanbe, Paris, Nairobi, Sydney): the seasonal swing hides the answer.
3. **Meet Earth Explorer.** — the globe with its search box, and the real three-step workflow: where (any place on Earth) → what → how far back.
4. **We Found a Real Trend.** — case study Dushanbe: +0.35 °C per decade, plus the same analysis for five other cities; annual means with the fitted line, and the app's own result card.
5. **Not Just a Number. Scientific Evidence.** — significance, uncertainty, seasonal correction, provenance.
6. **Beyond the Graph.** — Event Detective (Park Fire) and Scenario Lab (Nurek Reservoir).
7. **Earth Science for Everyone.** — closing line, URL and QR code.

## Where the pictures come from

All screenshots were taken from production, <https://stellify.myspaceproject.app/>, on **2026-11-15**
with Playwright (1600×900 viewport, 2× device scale) by `build/capture.mjs`. Nothing is mocked up.

| Slide | Crop | Original |
|---|---|---|
| 1 | `slide1-globe.png` | `02-globe.png` |
| 3 | `slide3-globe-search.png` | `02-globe.png` |
| 3 | `slide3-investigate-steps.png` | `04-investigate-dushanbe.png` |
| 4 | `slide4-app-trend-card.png` | `05b-trend-panel.png` |
| 5 | `slide5-app-anomaly-chart.png` | `06b-trend-panel-details.png` |
| 6 | `slide6-event-park-fire.png` | `08-event-EONET_9035.png` |
| 6 | `slide6-scenario-nurek-900m.png` | `11-nurek-900.png` |

The charts on slides 2 and 4 are native PowerPoint charts drawn from raw API responses saved in `build/data/`
(`dushanbe_t2m_1981_2025.json`, `other_cities_monthly_t2m_1981_2025.json`).

## Numbers on the slides, and how they were checked

Source request (production API, 2026-11-15):
`GET /api/v1/trends?variable=t2m&lat=38.56&lon=68.78&start=1981&end=2025`

| On the slide | Value in the API response |
|---|---|
| +0.35 °C per decade | 0.3522 (OLS on monthly anomalies, AR(1)-adjusted, Santer et al. 2000) |
| 95% interval 0.21 to 0.49 | 0.2126 … 0.4918 |
| p < 0.001, two tests agree | adjusted OLS p ≈ 1.1e-6; modified Mann–Kendall (Hamed & Rao 1998) p ≈ 1.4e-8 |
| 540 of 540 months | coverage: 540 valid of 540, no gaps |
| ≈ +1.6 °C across the record | fitted total change 1.58 °C over 44.9 years |
| 3–27 °C seasonal swing (slide 2) | warmest minus coldest calendar-month mean, 1981–2025: Nairobi 2.9, Sydney 8.9, Paris 16.3, Dushanbe 27.3 °C |
| 540 monthly values per city (slide 2) | 540 points returned for each of the four cities |
| NASA POWER v2.10.0, T2M, MERRA-2 | provenance block of the response |
| ~50 km grid cell, not a station | 0.5° × 0.625° MERRA-2 grid; limitation text of the response |
| Trend line on slide 4 | OLS on annual means, +0.352 °C/decade (same value as the API's `annual_ols`) |
| Slide 4 city row: Paris +0.42, São Paulo +0.41, Nairobi +0.26, Sydney +0.31, Delhi −0.12 | same endpoint and period, queried 2026-11-15, saved in `build/data/other_cities_t2m_1981_2025.json`; 540/540 months each. First four: verdict "significant increase". Delhi: 95% CI −0.27 … +0.04 includes zero, verdict not significant |
| Park Fire: 429,603 acres, 12,839 detections | read from the app's event card (NIFC/WFIGS perimeter, NASA FIRMS VIIRS) |
| Nurek: 864 m → 900 m, +3.0 km³, 45 km² | read from the Scenario Lab panel (+3033 million m³, 45.0 km²) |

`build_deck.py` asserts the trend numbers against the saved response and stops if they ever differ.

Wording to keep if the slides are edited:

- The trend belongs to one NASA POWER / MERRA-2 grid cell, not to a weather station.
- A trend describes change in the data; it does not identify the cause.
- Dushanbe is the worked example, not the scope: the temperature analysis works for any point on Earth (slide 4 city row).
- Delhi is shown on purpose: the tool also says when a trend is *not* significant. Do not round it into "cooling".
- A single event (the Park Fire) is not a trend.
- Scenario Lab is a hypothetical model, not a forecast and not an observation.
- "Works on a weak connection" (slide 7) is taken from the project README (offline packs, Low Bandwidth Mode);
  it was not measured separately for this deck.

Not shown on purpose: the earthquake ShakeMap layer and three other event cases. Their screenshots timed out
during capture, so they are unverified and are not claimed anywhere in the deck.

## Checks done

- PPTX: 7 slides, passes structural validation; PDF: 7 pages, 16:9, fonts embedded (Arial).
- Every PDF page was rendered and inspected: no clipped or overlapping text.
- The QR code decodes to `https://stellify.myspaceproject.app/` (checked on the generated image and on PDF page 7).
- The PDF was rendered with LibreOffice. PowerPoint may lay text out a hair differently — open the PPTX once before presenting.

## Rebuilding

```bash
python3 -m venv --system-site-packages .venv && .venv/bin/pip install segno
.venv/bin/python submission/build/build_deck.py
soffice --headless --convert-to pdf --outdir submission submission/Earth_Explorer_Stellify_NASA_2026.pptx
```

## Sharing the PDF by link (Google Drive)

1. Open <https://drive.google.com>, press **New → File upload**, choose `Earth_Explorer_Stellify_NASA_2026.pdf`.
2. Right-click the uploaded file → **Share → Share**.
3. Under **General access** switch "Restricted" to **Anyone with the link**; keep the role **Viewer**.
4. Press **Copy link**, then **Done**.
5. Open the link in a private/incognito window to confirm it opens without signing in, and that it shows 7 pages.
6. Paste that link into the submission form.

The file has not been uploaded or shared anywhere, and the NASA submission has not been made — both are left to the team.
