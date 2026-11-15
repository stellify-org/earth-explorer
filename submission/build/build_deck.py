#!/usr/bin/env python3
"""Build the 7-slide Earth Explorer deck (Stellify, NASA Space Apps 2026).

Usage:  python build_deck.py            (needs python-pptx, Pillow, segno)

Inputs
  ../presentation_screenshots/original/*.png   real production screenshots (capture.mjs)
  data/dushanbe_t2m_1981_2025.json             raw /api/v1/trends response (production)
Outputs
  ../presentation_screenshots/*.png            crops used on the slides (pixels untouched)
  assets/*.png                                 framed crops, backgrounds, QR code
  ../Earth_Explorer_Stellify_NASA_2026.pptx
"""
import json
from pathlib import Path

import segno
from PIL import Image, ImageDraw, ImageFilter
from pptx import Presentation
from pptx.chart.data import XyChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_AXIS_CROSSES, XL_CHART_TYPE, XL_LEGEND_POSITION, XL_MARKER_STYLE, XL_TICK_MARK
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

HERE = Path(__file__).resolve().parent
SUB = HERE.parent
ORIG = SUB / "presentation_screenshots" / "original"
CROPS = SUB / "presentation_screenshots"
ASSETS = HERE / "assets"
ASSETS.mkdir(exist_ok=True)
OUT = SUB / "Earth_Explorer_Stellify_NASA_2026.pptx"
URL = "https://stellify.myspaceproject.app/"
URL_SHORT = "stellify.myspaceproject.app"

BG = "03060F"
CARD = "0A1426"
LINE = "1D3050"
TEXT = "F2F6FC"
MUTED = "93A4BD"
CYAN = "22D3EE"
AMBER = "E9B04A"
FONT = "Arial"
W, H = 13.333, 7.5


def rgb(h):
    return RGBColor.from_string(h)


def tup(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# ---------------------------------------------------------------- data
D = json.loads((HERE / "data" / "dushanbe_t2m_1981_2025.json").read_text())
R = D["result"]
P = R["trend"]["primary"]
assert R["coverage"]["n_valid"] == 540 and R["coverage"]["n_months"] == 540
assert round(P["slope_per_decade"], 3) == 0.352
assert round(P["ci_low_per_decade"], 3) == 0.213 and round(P["ci_high_per_decade"], 3) == 0.492
assert P["p_value"] < 0.001 and R["trend"]["mann_kendall"]["p_value"] < 0.001
assert R["trend"]["verdict"]["code"] == "significant_increase"
assert round(R["trend"]["practical"]["total_change"], 1) == 1.6
clim = [c["mean"] for c in R["climatology"]]
SEASONAL_SWING = round(max(clim) - min(clim))          # Jul mean minus Jan mean
assert SEASONAL_SWING == 27
years = [a["year"] for a in R["annual"]]
ann = [a["mean"] for a in R["annual"]]
_mx, _my = sum(years) / len(years), sum(ann) / len(ann)
slope = sum((x - _mx) * (y - _my) for x, y in zip(years, ann)) / sum((x - _mx) ** 2 for x in years)
icpt = _my - slope * _mx
assert abs(slope * 10 - R["trend"]["annual_ols"]["slope_per_decade"]) < 1e-6
fit = [icpt + slope * x for x in years]
# same analysis for other places (same endpoint, same period) — proves the tool is global
OTHER = json.loads((HERE / "data" / "other_cities_t2m_1981_2025.json").read_text())
CITIES = [("Paris", "Paris"), ("São Paulo", "Sao Paulo"), ("Nairobi", "Nairobi"), ("Sydney", "Sydney"), ("Delhi", "Delhi")]
for _, k in CITIES:
    assert OTHER[k]["n_valid"] == 540
    assert (OTHER[k]["verdict"] == "significant_increase") == (k != "Delhi")
MONTHLY = json.loads((HERE / "data" / "other_cities_monthly_t2m_1981_2025.json").read_text())
MONTHLY["Dushanbe"] = {"t": [round(p["t"], 3) for p in R["points"]], "value": [p["value"] for p in R["points"]],
                       "climatology": clim}
PANELS = [("Dushanbe", "ASIA"), ("Paris", "EUROPE"), ("Nairobi", "AFRICA"), ("Sydney", "AUSTRALIA")]
SWINGS = [round(max(MONTHLY[k]["climatology"]) - min(MONTHLY[k]["climatology"])) for k, _ in PANELS]
assert all(len(MONTHLY[k]["value"]) == 540 for k, _ in PANELS)


# ---------------------------------------------------------------- images
def crop(src, box, name):
    im = Image.open(ORIG / src).convert("RGB").crop(box)
    im.save(CROPS / name)
    return im


def framed(im, name, radius=26, border=3):
    im = im.convert("RGBA")
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius, fill=255)
    im.putalpha(mask)
    ImageDraw.Draw(im).rounded_rectangle((1, 1, im.width - 2, im.height - 2), radius,
                                         outline=tup("2A4368") + (255,), width=border)
    im.save(ASSETS / name)
    return ASSETS / name, im.width / im.height


def make_assets():
    a = {}
    globe = crop("02-globe.png", (930, 276, 2270, 1616), "slide1-globe.png")
    a["globeui"] = framed(crop("02-globe.png", (0, 110, 2280, 1640), "slide3-globe-search.png"), "f-globeui.png")
    a["wizard"] = framed(crop("04-investigate-dushanbe.png", (26, 132, 782, 798), "slide3-investigate-steps.png"),
                         "f-wizard.png")
    a["trendcard"] = framed(crop("05b-trend-panel.png", (24, 390, 776, 884), "slide4-app-trend-card.png"),
                            "f-trendcard.png")
    a["evidence"] = framed(crop("06b-trend-panel-details.png", (16, 110, 784, 924), "slide5-app-anomaly-chart.png"),
                           "f-evidence.png")
    a["fire"] = framed(crop("08-event-EONET_9035.png", (796, 255, 2516, 1548), "slide6-event-park-fire.png"),
                       "f-fire.png")
    a["nurek"] = framed(crop("11-nurek-900.png", (560, 150, 2500, 1608), "slide6-scenario-nurek-900m.png"),
                        "f-nurek.png")

    # plain background: near-black navy with one soft glow
    cw, ch = 2400, 1350
    bg = Image.new("RGB", (cw, ch), tup(BG))
    glow = Image.new("RGB", (cw, ch), tup(BG))
    ImageDraw.Draw(glow).ellipse((1500, -700, 2900, 500), fill=tup("0C2A4A"))
    bg = Image.blend(bg, glow.filter(ImageFilter.GaussianBlur(260)), 0.9)
    bg.save(ASSETS / "bg.png")
    a["bg"] = ASSETS / "bg.png"

    # title background: the app's own globe, large, bleeding off the right edge
    t = Image.new("RGB", (cw, ch), tup(BG))
    halo = Image.new("RGB", (cw, ch), tup(BG))
    dia, cx, cy = 1640, 2090, 720
    ImageDraw.Draw(halo).ellipse((cx - dia // 2 - 60, cy - dia // 2 - 60, cx + dia // 2 + 60, cy + dia // 2 + 60),
                                 fill=tup("0E4A66"))
    t = Image.blend(t, halo.filter(ImageFilter.GaussianBlur(120)), 0.85)
    g = globe.resize((dia, dia), Image.LANCZOS)
    gm = Image.new("L", (dia, dia), 0)
    ImageDraw.Draw(gm).ellipse((6, 6, dia - 6, dia - 6), fill=255)
    fade = Image.linear_gradient("L").rotate(90, expand=True).resize((dia, dia))   # dark left -> bright right
    fade = fade.point(lambda v: min(255, int(70 + v * 2.6)))
    gm = Image.composite(fade, Image.new("L", (dia, dia), 0), gm).filter(ImageFilter.GaussianBlur(2))
    t.paste(g, (cx - dia // 2, cy - dia // 2), gm)
    t.save(ASSETS / "bg-title.png")
    a["bgtitle"] = ASSETS / "bg-title.png"

    qr = segno.make(URL, error="m")
    qr.save(str(ASSETS / "qr.png"), scale=24, border=3, dark="#03060F", light="#FFFFFF")
    a["qr"] = ASSETS / "qr.png"
    return a


# ---------------------------------------------------------------- pptx helpers
prs = Presentation()
prs.slide_width, prs.slide_height = Inches(W), Inches(H)
LAYOUT = prs.slide_layouts[5]   # Title Only


def new_slide(bg_path, title, tx, ty, tw, th, size, colors=None):
    s = prs.slides.add_slide(LAYOUT)
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = rgb(BG)
    pic = s.shapes.add_picture(str(bg_path), 0, 0, prs.slide_width, prs.slide_height)
    pic._element.nvPicPr.cNvPr.set("descr", "")
    s.shapes._spTree.remove(pic._element)
    s.shapes._spTree.insert(2, pic._element)        # behind everything, incl. the title
    t = s.shapes.title
    t.left, t.top, t.width, t.height = Inches(tx), Inches(ty), Inches(tw), Inches(th)
    tf = t.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = MSO_ANCHOR.TOP
    for m in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
        setattr(tf, m, 0)
    lines = title if isinstance(title, list) else [title]
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = PP_ALIGN.LEFT
        r = p.add_run()
        r.text = line
        style(r, size, True, (colors or [TEXT] * len(lines))[i])
    return s


def style(run, size, bold=False, color=TEXT, italic=False, spc=None):
    f = run.font
    f.name, f.size, f.bold, f.italic = FONT, Pt(size), bold, italic
    f.color.rgb = rgb(color)
    if spc:
        run._r.get_or_add_rPr().set("spc", str(spc))


def text(s, x, y, w, h, paras, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, space_after=0, line=None):
    """paras: list of paragraphs; a paragraph is a list of (text, size, bold, color[, italic[, spc]]) runs."""
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    for m in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
        setattr(tf, m, 0)
    for i, runs in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.space_after = Pt(space_after)
        if line:
            p.line_spacing = line
        for r_ in runs:
            r = p.add_run()
            r.text = r_[0]
            style(r, *r_[1:])
    return tb


def card(s, x, y, w, h, fill=CARD, line=LINE, radius=0.14):
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.adjustments[0] = min(0.5, radius / min(w, h))      # radius in inches
    sh.fill.solid()
    sh.fill.fore_color.rgb = rgb(fill)
    if line:
        sh.line.color.rgb = rgb(line)
        sh.line.width = Pt(1)
    else:
        sh.line.fill.background()
    sh.shadow.inherit = False
    return sh


def dot(s, x, y, d, fill, label=None, label_color=BG, size=14):
    sh = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x), Inches(y), Inches(d), Inches(d))
    sh.fill.solid()
    sh.fill.fore_color.rgb = rgb(fill)
    sh.line.fill.background()
    sh.shadow.inherit = False
    if label:
        tf = sh.text_frame
        for m in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
            setattr(tf, m, 0)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = label
        style(r, size, True, label_color)
    return sh


def picture(s, asset, x, y, w=None, h=None, alt=""):
    path, ar = asset
    if w is None:
        w = h * ar
    if h is None:
        h = w / ar
    pic = s.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(w), Inches(h))
    pic._element.nvPicPr.cNvPr.set("descr", alt)
    return x, y, w, h


def footer(s, n):
    text(s, 0.7, 7.0, 6, 0.25, [[("Earth Explorer  ·  Team Stellify", 10, False, MUTED)]])
    text(s, 10.63, 7.0, 2.0, 0.25, [[(f"{n} / 7", 10, False, MUTED)]], align=PP_ALIGN.RIGHT)


def eyebrow(s, x, y, w, label, color=AMBER):
    text(s, x, y, w, 0.3, [[(label, 12, True, color, False, 150)]])


def line_chart(s, x, y, w, h, series, xmin, xmax, xmajor, vmin, vmax, major, legend=False, fs=12):
    """Native XY chart (numeric year axis). series: (name, xs, ys, color, width_pt)."""
    cd = XyChartData()
    for name, xs, ys, _, _ in series:
        ser = cd.add_series(name)
        for xv, yv in zip(xs, ys):
            ser.add_data_point(xv, yv)
    gf = s.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER_LINES_NO_MARKERS, Inches(x), Inches(y), Inches(w), Inches(h), cd)
    ch = gf.chart
    ch.has_title = False
    ch.font.name, ch.font.size = FONT, Pt(fs)
    ch.font.color.rgb = rgb(MUTED)
    ch.has_legend = legend
    if legend:
        ch.legend.position = XL_LEGEND_POSITION.BOTTOM
        ch.legend.include_in_layout = False
        ch.legend.font.size = Pt(12)
        ch.legend.font.color.rgb = rgb(TEXT)
    for ser, (_, _, _, color, width) in zip(ch.plots[0].series, series):
        ser.smooth = False
        ser.format.line.color.rgb = rgb(color)
        ser.format.line.width = Pt(width)
        ser.marker.style = XL_MARKER_STYLE.NONE
    va, ca = ch.value_axis, ch.category_axis
    va.minimum_scale, va.maximum_scale, va.major_unit = vmin, vmax, major
    va.has_major_gridlines = True
    va.major_gridlines.format.line.color.rgb = rgb(LINE)
    va.major_gridlines.format.line.width = Pt(0.75)
    va.format.line.fill.background()
    va.major_tick_mark = XL_TICK_MARK.NONE
    va.tick_labels.number_format, va.tick_labels.number_format_is_linked = "0", False
    va.crosses = XL_AXIS_CROSSES.MINIMUM            # year axis sits at the bottom, not at 0 °C
    ca.minimum_scale, ca.maximum_scale, ca.major_unit = xmin, xmax, xmajor
    ca.has_major_gridlines = False
    ca.format.line.color.rgb = rgb("3A5378")
    ca.major_tick_mark = XL_TICK_MARK.OUTSIDE
    ca.tick_labels.number_format, ca.tick_labels.number_format_is_linked = "0", False
    ca.crosses = XL_AXIS_CROSSES.MINIMUM
    return gf


# ---------------------------------------------------------------- slides
def build():
    A = make_assets()

    # 1 — title
    s = new_slide(A["bgtitle"], ["One Planet.", "Millions of Changes."], 0.8, 2.35, 8.0, 1.75, 50,
                  colors=[TEXT, CYAN])
    eyebrow(s, 0.8, 1.75, 8, "NASA SPACE APPS CHALLENGE 2026")
    text(s, 0.8, 4.45, 7, 1.0, [
        [("Earth Explorer", 30, True, TEXT)],
        [("by Team Stellify", 18, False, MUTED)],
    ], space_after=4)
    text(s, 0.8, 6.55, 7, 0.35, [[(URL_SHORT, 14, False, CYAN)]])
    s.shapes[0]._element.nvPicPr.cNvPr.set(
        "descr", "Earth Explorer's 3D globe (real app screenshot) on a dark background")

    # 2 — the question
    s = new_slide(A["bg"], ["Can You Tell", "If Your City Is", "Getting Warmer?"], 0.7, 1.35, 5.0, 2.3, 40,
                  colors=[TEXT, TEXT, AMBER])
    text(s, 0.7, 4.1, 4.7, 1.9, [
        [("The data is open.", 20, True, TEXT)],
        [("The answer is not obvious.", 20, True, TEXT)],
        [("45 years of real monthly temperatures for four cities on four continents. "
          "Which ones are warming? How sure can you be?", 15, False, MUTED)],
    ], space_after=6)
    card(s, 5.9, 0.75, 6.73, 4.35)
    eyebrow(s, 6.15, 0.95, 6.2, "MONTHLY AIR TEMPERATURE, °C  ·  1981–2025", MUTED)
    for i, (city, cont) in enumerate(PANELS):
        x = 6.05 + (i % 2) * 3.27
        y = 1.3 + (i // 2) * 1.88
        text(s, x + 0.12, y, 3.0, 0.28, [[(city, 14, True, TEXT), ("    " + cont, 10, True, MUTED, False, 150)]])
        line_chart(s, x, y + 0.26, 3.2, 1.58,
                   [(city, MONTHLY[city]["t"], MONTHLY[city]["value"], CYAN, 0.75)],
                   1980, 2026, 20, -10, 30, 20, fs=10)
    facts = [("540", "monthly values per city, from NASA POWER"),
             (f"{min(SWINGS)}–{max(SWINGS)} °C", "seasonal swing hides the slow change"),
             ("1 month", "of heat is an anomaly, not a trend")]
    for i, (big, small) in enumerate(facts):
        x = 5.9 + i * 2.3
        card(s, x, 5.35, 2.13, 1.4)
        text(s, x + 0.18, 5.5, 1.8, 1.15, [
            [(big, 24, True, AMBER if i == 2 else CYAN)],
            [(small, 12, False, TEXT)],
        ], space_after=3)
    footer(s, 2)

    # 3 — workflow
    s = new_slide(A["bg"], "Meet Earth Explorer.", 0.7, 0.55, 12, 0.7, 36)
    text(s, 0.7, 1.28, 12, 0.4, [[("Three plain questions turn open NASA data into an answer, for any place on Earth.",
                                   18, False, MUTED)]])
    picture(s, A["globeui"], 0.7, 2.05, w=5.3,
            alt="Earth Explorer screenshot: the 3D globe with the search box 'Search a country, a place or lat, lon'")
    picture(s, A["wizard"], 0.9, 3.75, w=3.1,
            alt="Earth Explorer screenshot: Start an investigation — where, what, how far back; Analyze Changes button")
    steps = [("Where?", "Search a city, a country or coordinates, or click the globe.", "Any place on Earth"),
             ("What?", "Choose what to investigate.", "Temperature"),
             ("How far back?", "Full record 1981–2025, last 30 years, or a custom period.", "Up to 45 years")]
    for i, (h_, d_, v_) in enumerate(steps):
        y = 2.1 + i * 1.22
        dot(s, 6.35, y + 0.05, 0.62, CYAN, str(i + 1), size=20)
        text(s, 7.25, y, 5.38, 1.0, [
            [(h_ + "   ", 24, True, TEXT), (v_, 20, True, CYAN)],
            [(d_, 15, False, MUTED)],
        ], space_after=4)
    b = card(s, 6.35, 5.8, 6.28, 0.7, fill="1A1608", line=AMBER, radius=0.3)
    text(s, 6.6, 5.8, 5.8, 0.7, [[("Analyze Changes", 16, True, AMBER),
                                  ("   →   one click, real NASA data", 15, False, TEXT)]],
         anchor=MSO_ANCHOR.MIDDLE)
    footer(s, 3)

    # 4 — the trend
    s = new_slide(A["bg"], "We Found a Real Trend.", 0.7, 0.55, 12, 0.7, 36)
    text(s, 0.7, 1.45, 5.0, 1.5, [[("+0.35", 96, True, AMBER)]])
    text(s, 0.7, 3.0, 5.0, 1.2, [
        [("°C per decade", 28, True, TEXT)],
        [("Case study: Dushanbe, Tajikistan  ·  1981–2025", 15, False, MUTED)],
        [("≈ +1.6 °C of fitted warming across the record", 15, False, MUTED)],
    ], space_after=4)
    picture(s, A["trendcard"], 0.7, 4.55, w=3.35,
            alt="Earth Explorer screenshot: Dushanbe is getting warmer. Rising trend detected, "
                "+0.35 °C per decade, 95% range 0.21 to 0.49 °C per decade")
    text(s, 4.2, 4.6, 1.5, 1.2, [[("Straight from the live app", 12, False, MUTED, True)]])
    card(s, 5.9, 1.45, 6.73, 3.55)
    eyebrow(s, 6.15, 1.65, 6.2, "DUSHANBE  ·  ANNUAL MEAN AIR TEMPERATURE, °C", MUTED)
    line_chart(s, 6.0, 1.9, 6.5, 2.6,
               [("Annual mean (NASA POWER, T2M)", years, [round(v, 3) for v in ann], CYAN, 2.25),
                ("Linear trend, +0.35 °C per decade", years, [round(v, 3) for v in fit], AMBER, 3.0)],
               1980, 2026, 10, 11, 16, 1, legend=True)
    text(s, 6.15, 4.52, 6.25, 0.4, [[(
        "NASA POWER v2.10.0 (from MERRA-2), one ~50 km grid cell. "
        "Headline trend: AR(1)-adjusted OLS on 540 monthly anomalies.", 10, False, MUTED)]])
    eyebrow(s, 5.9, 5.2, 6.73, "SAME ANALYSIS, ANYWHERE ON EARTH  ·  °C PER DECADE")
    cw_ = (6.73 - 4 * 0.15) / 5
    for i, (label, key) in enumerate(CITIES):
        c = OTHER[key]
        sig = c["verdict"] == "significant_increase"
        x = 5.9 + i * (cw_ + 0.15)
        card(s, x, 5.55, cw_, 1.2)
        text(s, x + 0.13, 5.66, cw_ - 0.2, 1.0, [
            [(f"{c['slope_per_decade']:+.2f}".replace("-", "−"), 20, True, CYAN if sig else MUTED)],
            [(label, 12, True, TEXT)],
            [("significant" if sig else "not significant", 10, False, MUTED if sig else AMBER)],
        ], space_after=1)
    footer(s, 4)

    # 5 — evidence
    s = new_slide(A["bg"], "Not Just a Number. Scientific Evidence.", 0.7, 0.55, 12, 0.7, 36)
    _, _, pw, ph = picture(s, A["evidence"], 0.7, 1.6, h=4.75,
                           alt="Earth Explorer screenshot: monthly anomaly chart 1981–2026 with OLS trend and "
                               "95% confidence interval of the slope, and the verdict 'Statistically "
                               "significant increase'")
    text(s, 0.7, 6.45, pw, 0.3, [[("What the app shows under “How do we know?”", 12, False, MUTED, True)]])
    cards = [("SIGNIFICANCE", "p < 0.001", "Two tests must agree: AR(1)-adjusted OLS and modified Mann–Kendall."),
             ("UNCERTAINTY", "0.21 to 0.49", "95% confidence interval, in °C per decade. The headline is 0.35."),
             ("SEASONAL CORRECTION", "540 of 540", "Months valid. Each is compared with its own 1981–2025 average."),
             ("PROVENANCE", "NASA POWER", "T2M v2.10.0, from MERRA-2. A ~50 km grid cell, not a weather station.")]
    x0 = 0.7 + pw + 0.4
    cw_ = (12.63 - x0 - 0.25) / 2
    for i, (lab, big, small) in enumerate(cards):
        x = x0 + (i % 2) * (cw_ + 0.25)
        y = 1.6 + (i // 2) * 2.5
        card(s, x, y, cw_, 2.25)
        eyebrow(s, x + 0.25, y + 0.25, cw_ - 0.5, lab)
        text(s, x + 0.25, y + 0.6, cw_ - 0.5, 0.6, [[(big, 28, True, CYAN)]])
        text(s, x + 0.25, y + 1.22, cw_ - 0.5, 0.95, [[(small, 14, False, TEXT)]])
    text(s, x0, 6.45, 12.63 - x0, 0.3, [[(
        "Same checks for every place. A trend describes change in the data, not its cause.", 12, False, MUTED, True)]])
    footer(s, 5)

    # 6 — beyond the graph
    s = new_slide(A["bg"], "Beyond the Graph.", 0.7, 0.55, 12, 0.7, 36)
    cols = [(0.7, A["fire"], "Event Detective", CYAN, "OBSERVED",
             "Park Fire, California, 2024. 429,603 acres of mapped perimeter and "
             "12,839 satellite heat detections (VIIRS), replayed day by day.",
             "Earth Explorer screenshot: Park Fire perimeter (NIFC/WFIGS) filled with NASA FIRMS VIIRS "
             "thermal detections"),
            (7.3, A["nurek"], "Scenario Lab", AMBER, "HYPOTHETICAL MODEL",
             "Nurek Reservoir, Tajikistan. Raise the water from 864 m to 900 m: about "
             "+3.0 km³ stored, 45 km² newly flooded. A model, not a forecast.",
             "Earth Explorer screenshot: 3D terrain of Nurek Reservoir with baseline water in blue and "
             "added scenario water in cyan at 900 m")]
    for x, asset, name, color, tag, body, alt in cols:
        _, _, pw, ph = picture(s, asset, x, 1.45, h=4.0, alt=alt)
        yb = 1.45 + ph + 0.2
        text(s, x, yb, pw, 0.4, [[(name, 22, True, color), ("    " + tag, 11, True, MUTED, False, 150)]])
        text(s, x, yb + 0.45, pw, 0.75, [[(body, 14, False, TEXT)]])
    footer(s, 6)

    # 7 — closing
    s = new_slide(A["bg"], "Earth Science for Everyone.", 0.7, 0.55, 12, 0.7, 36)
    rows = [("Learn by investigating", "Every result says what it means, and what it does not prove."),
            ("Works on a weak connection", "Local globe, offline data packs and a Low Bandwidth Mode."),
            ("Open about its sources", "Each number shows its NASA dataset, method and known limits.")]
    for i, (h_, d_) in enumerate(rows):
        y = 1.75 + i * 1.05
        dot(s, 0.7, y + 0.1, 0.22, CYAN)
        text(s, 1.2, y, 6.6, 0.9, [[(h_, 20, True, TEXT)], [(d_, 15, False, MUTED)]], space_after=3)
    text(s, 0.7, 5.15, 7.4, 1.5, [
        [("Explore the planet.", 28, True, TEXT)],
        [("Question the data.", 28, True, CYAN)],
        [("Discover the change.", 28, True, AMBER)],
    ])
    card(s, 8.78, 1.6, 3.85, 3.85, fill="FFFFFF", line=None, radius=0.2)
    pic = s.shapes.add_picture(str(A["qr"]), Inches(8.955), Inches(1.775), Inches(3.5), Inches(3.5))
    pic._element.nvPicPr.cNvPr.set("descr", "QR code linking to " + URL)
    text(s, 8.28, 5.65, 4.85, 0.4, [[(URL_SHORT, 18, True, CYAN)]], align=PP_ALIGN.CENTER)
    text(s, 8.28, 6.1, 4.85, 0.3, [[("Scan to open Earth Explorer", 13, False, MUTED)]], align=PP_ALIGN.CENTER)
    footer(s, 7)

    assert len(prs.slides) == 7
    prs.core_properties.title = "Earth Explorer — Team Stellify — NASA Space Apps Challenge 2026"
    prs.core_properties.author = "Team Stellify"
    prs.save(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    build()
