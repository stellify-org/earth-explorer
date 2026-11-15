import { t } from "./i18n";
import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "./api/client";
import { useLowBandwidth, useStore } from "./store";
import { Icon, NAV, navGroup, type NavGroupId } from "./components/Simple";
import ExploreMode from "./modes/ExploreMode";

const CompareMode = lazy(() => import("./modes/CompareMode"));
import { Notice } from "./components/ui";
import ErrorBoundary from "./components/ErrorBoundary";
import { useConnectivity } from "./lib/useConnectivity";
const OfflineData = lazy(() => import("./components/OfflineData"));
import { LowBandwidthToggle } from "./components/LowBandwidthToggle";
import { useBandwidthDetection } from "./lib/useBandwidth";

export default function App() {
  const { mode, setMode, setCatalog, setCatalogError, catalogError, advanced, setAdvanced, setWelcome, investigate, analyze, startInvestigation } = useStore();
  const group = navGroup(mode, investigate || analyze);
  const [sub, setSub] = useState<NavGroupId>();
  const low = useLowBandwidth();
  const net = useConnectivity();
  const [credits, setCredits] = useState(false);
  const [library, setLibrary] = useState(false);
  const [menu, setMenu] = useState(false);
  useBandwidthDetection();

  useEffect(() => {
    const ctl = new AbortController();
    api.datasets(ctl.signal)
      .then((d) => setCatalog(d.variables, useStore.getState().layers))
      .catch((e: Error) => e.name !== "AbortError" && setCatalogError(e.message));
    return () => ctl.abort();
  }, [setCatalog, setCatalogError]);

  const globe = mode !== "compare";
  const item = "flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] text-slate-200 hover:bg-space-700";
  const pick = (fn: () => void) => () => { setMenu(false); fn(); };

  return (
    <div className="flex h-full flex-col">
      <header className="relative z-40 flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-space-700 bg-space-950 px-3 py-1.5">
        <button className="flex items-center gap-2 rounded-lg py-1 pr-1" onClick={() => { setMode("explore"); setWelcome(true); }} title={t("Home")} data-testid="home-link">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><circle cx="16" cy="16" r="13" fill="#0b1a33" stroke="#22d3ee" strokeWidth="2" /><path d="M5 16h22M16 3c4 4 4 22 0 26M16 3c-4 4-4 22 0 26" stroke="#22d3ee" fill="none" strokeWidth="1.5" /></svg>
          <span className="text-[15px] font-semibold tracking-wide text-slate-50">{t("Earth Explorer")}</span>
        </button>
        <nav className="order-last flex w-full gap-1 sm:order-none sm:w-auto" aria-label={t("Modes")}>
          {NAV.map((g) => {
            const single = g.items.length === 1 ? g.items[0].mode : undefined;
            const act = () => {
              setMenu(false);
              if (g.id === "investigate") { setSub(undefined); startInvestigation(); }
              else if (single) { setSub(undefined); setMode(single); }
              else setSub((x) => (x === g.id ? undefined : g.id));
            };
            return (
              <div key={g.id} className="relative flex-1 sm:flex-none">
                <button onClick={act} aria-current={group === g.id ? "page" : undefined} aria-haspopup={g.items.length > 1 ? "menu" : undefined} aria-expanded={g.items.length > 1 ? sub === g.id : undefined}
                  data-testid={g.id === "investigate" ? "nav-investigate" : single ? `nav-${single}` : `nav-g-${g.id}`}
                  className={`flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11.5px] leading-tight transition-colors sm:min-h-10 sm:flex-row sm:gap-1.5 sm:px-3 sm:text-[13.5px] ${group === g.id ? "bg-accent/15 text-accent" : "text-slate-300 hover:text-white"}`}>
                  <Icon name={g.icon} size={17} />{t(g.label)}</button>
                {sub === g.id && (
                  <div className={`card fade-in absolute top-full z-50 mt-1 w-64 p-1.5 ${g.id === "discover" ? "right-0 sm:right-auto sm:left-0" : "left-0"}`} role="menu">
                    {g.items.map((e) => (
                      <button key={e.mode} role="menuitem" data-testid={`nav-${e.mode}`} onClick={() => { setSub(undefined); setMode(e.mode); }} aria-current={mode === e.mode && group === g.id ? "page" : undefined}
                        className={`flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-space-700 ${mode === e.mode && group === g.id ? "text-accent" : "text-slate-100"}`}>
                        <span className="shrink-0 text-accent"><Icon name={e.mode} size={20} /></span>
                        <span><span className="block text-[13.5px] font-medium">{t(e.label)}</span><span className="block text-[11.5px] leading-snug text-slate-400">{t(e.hint)}</span></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {sub && <button className="fixed inset-0 z-40 cursor-default" aria-hidden tabIndex={-1} onClick={() => setSub(undefined)} />}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {net.state !== "online" && <NetStatus net={net} />}
          {low && <span className="hidden rounded-full border border-amber-400/60 px-2 py-0.5 text-[11px] text-amber-200 sm:inline">{t("Low bandwidth")}</span>}
          <button className="icon-btn text-slate-300 hover:text-white" onClick={() => { setSub(undefined); setMenu((m) => !m); }} aria-expanded={menu} aria-haspopup="menu" aria-label={t("More")} title={t("More")} data-testid="more-menu"><Icon name="menu" /></button>
        </div>
        {menu && (
          <>
            <button className="fixed inset-0 z-40 cursor-default" aria-hidden tabIndex={-1} onClick={() => setMenu(false)} />
            <div className="card fade-in absolute top-full right-2 z-50 mt-1 w-72 p-2">
              <div className="flex flex-wrap items-center gap-2 px-2 pb-2"><NetStatus net={net} /><LowBandwidthToggle /></div>
              <label className={`${item} cursor-pointer`}>
                <input type="checkbox" className="h-4 w-4 accent-[#fbbf24]" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} data-testid="advanced-check" />
                <span><span className="block">{t("Advanced tools")}</span><span className="block text-[11px] text-slate-400">{t("Datasets, visual settings, statistics")}</span></span>
              </label>
              <button className={item} data-testid="nav-compare" onClick={pick(() => setMode("compare"))}>{t("Compare two dates")}</button>
              <button className={item} onClick={pick(() => setLibrary(true))}>{t("Offline data")}</button>
              <button className={item} onClick={pick(() => setCredits(true))}>{t("Data & credits")}</button>
            </div>
          </>
        )}
      </header>

      {catalogError && <div className="px-3 pt-2"><Notice tone="warn">{t("Data catalogue unavailable (")}{catalogError}{t("). The local globe works; data panels need a connection or a cached copy.")}</Notice></div>}

      <main className="flex min-h-0 flex-1">
        <ErrorBoundary key={globe ? "globe" : mode} label={t(`${mode} view`)}>
          {globe && <ExploreMode mode={mode} />}
          <Suspense fallback={<div className="p-6 text-xs text-slate-400">{t("Loading…")}</div>}>
            {mode === "compare" && <CompareMode />}
          </Suspense>
        </ErrorBoundary>
      </main>
      {credits && <Credits onClose={() => setCredits(false)} />}
      {library && <Suspense fallback={null}><OfflineData onClose={() => setLibrary(false)} /></Suspense>}
    </div>
  );
}

function Credits({ onClose }: { onClose: () => void }) {
  const variables = useStore((s) => s.variables);
  const cites = new Map<string, { text: string; doi?: string; url?: string }>();
  variables.forEach((v) => v.citations.forEach((c) => cites.set(c.text, c)));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="panel scroll-thin max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg p-5 text-[12.5px] text-slate-300" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("Data and credits")}>
        <div className="mb-3 flex justify-between"><h2 className="text-base font-semibold text-slate-50">{t("Data sources & credits")}</h2><button onClick={onClose} className="text-slate-400 hover:text-white">✕</button></div>
        <h3 className="label mt-2">{t("Quantitative data")}</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {[...cites.values()].map((c) => <li key={c.text}>{t(c.text)} {c.doi && <a className="text-accent hover:underline" href={`https://doi.org/${c.doi}`} target="_blank" rel="noreferrer">{t("doi:")}{c.doi}</a>}</li>)}
          <li>{t("Earthquakes: U.S. Geological Survey, ANSS Comprehensive Earthquake Catalog (ComCat), FDSN event web service.")}</li>
          <li>{t("Natural events (Event Detective): NASA EONET v3, Earth Observatory Natural Event Tracker, NASA Goddard Space Flight Center. EONET passes on reports from GDACS, IRWIN, JTWC, NOAA NHC, the Smithsonian Global Volcanism Program and others; each event links to its source.")}</li>
        </ul>
        <h3 className="label mt-3">{t("Imagery")}</h3>
        <p className="mt-1">{t("We acknowledge the use of imagery from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS). Imagery is used for visual context only.")}</p>
        <h3 className="label mt-3">{t("Geography and terrain")}</h3>
        <p className="mt-1">{t("Base map, borders, coasts, lakes, rivers, glaciers and country names: Natural Earth 1:110m / 1:50m / 1:10m (public domain), stored locally. Present-day boundaries; Natural Earth shows de-facto boundaries and marks disputed ones (dashed here). Shaded relief option: Natural Earth II raster bundled with CesiumJS.")}</p>
        <p className="mt-1">{t("Optional terrain: Terrain Tiles (Mapzen/Tilezen, AWS Open Data). SRTM, GMTED2010 and 3DEP courtesy of the U.S. Geological Survey; ETOPO1 courtesy of NOAA; national DEMs per the ")}<a className="text-accent hover:underline" href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noreferrer">{t("attribution list")}</a>.</p>
        <h3 className="label mt-3">{t("Software")}</h3>
        <p className="mt-1">{t("CesiumJS (Apache-2.0), React (MIT), Recharts (MIT), Zustand (MIT), Tailwind CSS (MIT), Vite (MIT); Go standard library and gonum (BSD-3-Clause). Cesium ion is not used.")}</p>
        <p className="mt-1">{t("The globe is drawn with the open-source CesiumJS library; its credit is shown at the bottom left of the globe. No Cesium ion service, token, terrain or imagery is used, so the Cesium ion logo is not displayed.")}</p>
        <h3 className="label mt-3">{t("Status")}</h3>
        <p className="mt-1">{t("Independent research prototype by team Stellify. Not an official NASA product. See README for what is complete, experimental and planned.")}</p>
      </div>
    </div>
  );
}

function NetStatus({ net: { state, detail } }: { net: ReturnType<typeof useConnectivity> }) {
  const look = {
    online: { dot: "#34d399", text: "Online", icon: "●" },
    degraded: { dot: "#fbbf24", text: "Limited: cached data", icon: "◐" },
    offline: { dot: "#f87171", text: "Offline: local data only", icon: "○" },
  }[state];
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-space-600 px-2.5 py-0.5 text-[11.5px] text-slate-200" title={detail} role="status" aria-live="polite">
      <span aria-hidden style={{ color: look.dot }}>{look.icon}</span>{t(look.text)}
    </span>
  );
}
