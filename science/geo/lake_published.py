"""Published figures for the Scenario Lab locations, transcribed on 2026-11-14. Every entry names its source.

build_lakes.py copies PUBLISHED[<id>] into <id>.json unchanged. Rules followed here:
- a value is entered only if it was read in the named document (quotes are kept in docs/SCENARIO_LAB_SCIENCE.md);
- values from different surveys are NOT combined into one curve: the Kayrakkum storage table uses one document only.
"""

S1 = "CAWater-Info (SIC ICWC), reservoir card “Bakhri Tojik reservoir”, https://www.cawater-info.net/bk/1-1-1-1-3-tj_e.htm"
S2 = ("Qairokkum HPP Climate Resilience Upgrade. Environmental and Social Appraisal and Action Plan (project 47253), Table 1, "
      "copy in the EIB public register: https://www.eib.org/attachments/registers/159697604.pdf")
S3 = ("GIBB Ltd for IFAS / GEF (March 2000). Kayrakkum Dam Safety Assessment Report, "
      "https://www.cawater-info.net/bk/dam-safety/files/kayrakkum-dam-en.pdf")
S4 = "Green Climate Fund funding proposal FP040, p. 50, https://ewsdata.rightsindevelopment.org/files/documents/40/GCF-FP040.pdf"

SA04 = ("Schuster, R.L. & Alford, D. (2004). Usoi Landslide Dam and Lake Sarez, Pamir Mountains, Tajikistan. Environmental & Engineering "
        "Geoscience 10(2), 151–168 (abstract), https://www.usgs.gov/node/112371")
ISDR = ("Alford, D. & Schuster, R.L. (eds.) (2000). Usoi Landslide Dam and Lake Sarez: an assessment of hazard and risk in the Pamir "
        "Mountains, Tajikistan. UN ISDR, https://www.eird.org/deslizamientos/pdf/eng/doc13369/doc13369.htm")
WBICR = ("World Bank (2007). Lake Sarez Risk Mitigation Project, Implementation Completion Report ICR0000363, "
         "https://documents.worldbank.org/curated/en/194071468303546078/pdf/ICR363.pdf")
EO = "NASA Earth Observatory (2002). Lake Sarez, Tajikistan, https://science.nasa.gov/earth/earth-observatory/lake-sarez-tajikistan-2077/"

PUBLISHED: dict[str, dict] = {
    "kayrakkum": {
        "citation": "Qairokkum HPP Climate Resilience Upgrade. Environmental and Social Appraisal and Action Plan (project 47253), Table 1.",
        "url": "https://www.eib.org/attachments/registers/159697604.pdf", "transcribed": "2026-11-14",
        "full_supply_level_masl": {"value": 347.5, "where": "Table 1, PDF p. 4 (the same level in CAWater-Info and the 2000 dam safety report)"},
        "minimum_operating_level_masl": {"value": 340.6, "where": "Table 1, PDF p. 4–5"},
        "storage_table": {
            "levels_masl": [340.6, 347.5], "volumes_hm3": [0, 2300],
            "where": "Table 1, PDF p. 4–5: active storage volume 2300 million m³ “acc. to 2009 survey” between the minimum operation level and the full supply level",
            "note": "Approximate. No level–volume curve was found for this reservoir, so the change is taken as a straight line between two "
                    "published levels (333 million m³ per metre). The real lake is wider near the top: this line gives too little near the "
                    "full level and too much near the lowest level. A change, not the volume stored today.",
        },
        "mean_inflow_m3s": {"value": 520, "where": "Kayrakkum Dam Safety Assessment Report (2000), p. 12: long-term average discharge of the river at the dam site"},
        "facts": [
            {"label": "Water surface at the full level", "value": "513 km²", "where": "CAWater-Info reservoir card; dam safety report (2000)", "kind": "observed"},
            {"label": "Length, width, greatest depth", "value": "55 km, 20 km, 25 m", "where": "CAWater-Info reservoir card", "kind": "observed"},
            {"label": "Total volume at the full level, as designed", "value": "4.0–4.2 km³", "where": "4,160 (CAWater-Info), 4,200 (dam safety report), 4,000 “originally” (appraisal, Table 1) million m³", "kind": "observed"},
            {"label": "Total volume at the full level, 2009 survey", "value": "3.0 km³", "where": "Appraisal, Table 1: “3000 (acc. to 2009 survey)”", "kind": "observed"},
            {"label": "Lost to sediment since construction", "value": "about 25%", "where": "GCF FP040, p. 50; about 10 million m³ per year today", "kind": "observed"},
            {"label": "Filling began / commissioned", "value": "1956 / 1959", "where": "Dam safety report (2000), section 2.1", "kind": "observed"},
            {"label": "Mean river flow, 2002–2005", "value": "570 m³/s", "where": "Appraisal, Table 1", "kind": "observed"},
        ],
        "notes": [
            "Published volumes disagree because they refer to different years and lower levels: 4.0–4.2 km³ as designed, 3.0 km³ in the 2009 survey. They are shown side by side and never mixed in a calculation.",
            "The lowest level is 340.6 m in the 2009-based appraisal and 342.5 m (“dead storage level”) in the 2000 dam safety report. The appraisal's value is used, together with its own storage figure.",
            "No published evaporation figure for this reservoir was found. Evaporation is therefore an input you set yourself (0 by default), not data.",
            "None of the documents states which height system its levels use.",
        ],
        "references": [{"citation": S1, "url": "https://www.cawater-info.net/bk/1-1-1-1-3-tj_e.htm"}, {"citation": S3, "url": "https://www.cawater-info.net/bk/dam-safety/files/kayrakkum-dam-en.pdf"},
                       {"citation": S4, "url": "https://ewsdata.rightsindevelopment.org/files/documents/40/GCF-FP040.pdf"}],
    },
    "sarez": {
        "facts": [
            {"label": "Earthquake that released the landslide", "value": "18 February 1911, magnitude 7.2", "where": "USGS earthquake catalog, event iscgem16958134 (ISC-GEM, Mw 7.23)", "kind": "observed"},
            {"label": "Rock that fell", "value": "about 2 km³", "where": "Schuster & Alford (2004), abstract; 2–2.5 km³ in the UN report (2000)", "kind": "observed"},
            {"label": "Height of the natural dam", "value": "about 600 m", "where": "Schuster & Alford (2004): “the highest dam, natural or man-made, in the world”", "kind": "observed"},
            {"label": "Lake length, greatest depth, volume", "value": "60 km, 550 m, about 17 km³", "where": "Schuster & Alford (2004), abstract. Historical reference estimates, not a current measurement", "kind": "observed"},
            {"label": "Lake surface elevation", "value": "3265 m (1999); 3260–3265 m (2007)", "where": "UN report (2000), chapter 3; World Bank completion report (2007), p. 11", "kind": "observed"},
            {"label": "Lowest part of the dam above the lake", "value": "about 50 m", "where": "Schuster & Alford (2004), abstract", "kind": "observed"},
            {"label": "Long-term rise of the lake", "value": "18.5 cm per year", "where": "Schuster & Alford (2004), abstract", "kind": "observed"},
            {"label": "Level change within a year", "value": "about ± 6 m", "where": "UN report (2000), chapter 4: “reported to be ± 6 m”", "kind": "observed"},
            {"label": "Water leaving through the dam (seepage)", "value": "45 m³/s on average", "where": "UN report (2000), chapter 4: measured since 1943, yearly range 35–80 m³/s", "kind": "observed"},
            {"label": "Monitoring and early-warning system", "value": "installed December 2004", "where": "World Bank completion report (2007), p. 25", "kind": "observed"},
        ],
        "notes": [
            "No open bathymetry and no level–volume or level–area curve of Lake Sarez was found. The 17 km³ and 550 m are historical reference estimates from the literature; they are shown as such and not used in any calculation.",
            "The lake surface in the elevation data (February 2000) is 3264 m with radar noise of about ± 2 m; the noise was flattened to one level. The published 3265 m (1999) uses a different height system.",
            "Only raising the level is offered, and only a little: below the recorded surface the lake bed is unknown, and the natural dam's lowest point is about 50 m above the lake.",
            "This scene does not simulate a failure of the dam, a flood wave or any hazard downstream. That needs dedicated hydraulic and geotechnical models.",
        ],
        "references": [{"citation": SA04, "url": "https://www.usgs.gov/node/112371"}, {"citation": ISDR, "url": "https://www.eird.org/deslizamientos/pdf/eng/doc13369/doc13369.htm"},
                       {"citation": WBICR, "url": "https://documents.worldbank.org/curated/en/194071468303546078/pdf/ICR363.pdf"}, {"citation": EO, "url": "https://science.nasa.gov/earth/earth-observatory/lake-sarez-tajikistan-2077/"}],
    },
}

QUAKES = {
    "sarez": "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=1900-01-01&endtime=2026-11-01&minmagnitude=5.5"
             "&minlatitude=37.3&maxlatitude=39.3&minlongitude=71.3&maxlongitude=74.3&orderby=time-asc",
}
