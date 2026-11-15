import { create } from "zustand";
import { api, ApiError } from "../api/client";
import { CATS, DAY, daySteps, fromEonet, fromQuake, isoDay, type Cat, type Ev, type Story } from "./model";

export type Period = 7 | 30 | 90 | 365;
export const PERIODS: { days: Period; label: string; minMag: number }[] = [
  { days: 7, label: "Last 7 days", minMag: 4.5 },
  { days: 30, label: "Last 30 days", minMag: 4.5 },
  { days: 90, label: "Last 90 days", minMag: 4.5 },
  { days: 365, label: "Last year (no fires or floods)", minMag: 6 },
];

const YEAR_CATEGORIES = "severeStorms,volcanoes,landslides,earthquakes,seaLakeIce,drought,dustHaze,snow,tempExtremes,waterColor,manmade";
const QUAKE_LIMIT = 2000;

export interface Loaded {
  days: Period;
  events: Ev[];
  from: number;
  to: number;
  eonet?: { count: number; retrieved: string; stale: boolean; url: string; notes: string[] };
  eonetError?: string;
  quakes?: { count: number; truncated: boolean; minMag: number; retrieved: string; stale: boolean; url: string };
  quakeError?: string;
}

interface State {
  days: Period;
  cats: Record<Cat, boolean>;

  minMag: number;
  data?: Loaded;
  loading: boolean;

  cursor: number;
  playing: boolean;
  selected?: Ev;
  detail: { loading: boolean; error?: string };

  story?: Story;
  focus?: Ev;
  storyError?: string;

  flyToken: number;

  catalogue: boolean;
  openCatalogue: (load: boolean) => void;

  load: (days?: Period) => Promise<void>;
  toggleCat: (c: Cat) => void;
  setMinMag: (m: number) => void;
  setCursor: (t: number) => void;
  setPlaying: (p: boolean) => void;
  select: (e?: Ev, fly?: boolean) => void;
  openStory: (s: Story) => Promise<void>;
  closeStory: () => void;
}

const msg = (e: unknown) => e instanceof ApiError ? e.message : String(e);
let loadSeq = 0, detailSeq = 0;

export const useEvents = create<State>((set, get) => ({
  days: 30,
  cats: Object.fromEntries(CATS.map((c) => [c, true])) as Record<Cat, boolean>,
  minMag: 4.5,
  loading: false,
  cursor: Date.now(),
  playing: false,
  detail: { loading: false },
  flyToken: 0,

  catalogue: false,
  openCatalogue: (load) => { set({ catalogue: true }); if (load && !get().data && !get().loading) void get().load(); },
  load: async (days = get().days) => {
    const seq = ++loadSeq;
    const period = PERIODS.find((p) => p.days === days)!;
    const to = Date.now(), from = to - days * DAY;
    set({ days, loading: true, playing: false, minMag: Math.max(get().minMag, period.minMag) });
    const [eonet, quakes] = await Promise.allSettled([
      api.events(days, days === 365 ? YEAR_CATEGORIES : undefined),
      api.earthquakes({ minlat: -90, maxlat: 90, minlon: -180, maxlon: 180, start: isoDay(from), end: isoDay(to), minmag: period.minMag, limit: QUAKE_LIMIT }),
    ]);
    if (seq !== loadSeq) return;
    const data: Loaded = { days, events: [], from, to };
    if (eonet.status === "fulfilled") {
      const d = eonet.value;
      data.events.push(...d.events.map((e) => fromEonet(e)));
      data.eonet = { count: d.count, retrieved: d.retrieved_at, stale: d.stale, url: d.request_url, notes: d.notes };
    } else data.eonetError = msg(eonet.reason);
    if (quakes.status === "fulfilled") {
      const d = quakes.value;

      data.events.push(...d.events.map(fromQuake).filter((e) => e.start >= from && e.start <= to));
      data.quakes = { count: d.count, truncated: d.possibly_truncated, minMag: period.minMag, retrieved: d.retrieved_at, stale: !!(d as { stale?: boolean }).stale, url: d.request_url };
    } else data.quakeError = msg(quakes.reason);
    data.events.sort((a, b) => b.end - a.end);
    const sel = get().selected;
    set({ data, loading: false, cursor: to, selected: sel && !get().focus ? data.events.find((e) => e.id === sel.id) : sel });
  },

  toggleCat: (c) => set((s) => ({ cats: { ...s.cats, [c]: !s.cats[c] } })),
  setMinMag: (minMag) => set({ minMag }),
  setCursor: (cursor) => set({ cursor }),
  setPlaying: (playing) => set({ playing }),

  select: (e, fly = false) => {
    const seq = ++detailSeq;
    set((s) => ({ selected: e, detail: { loading: false }, flyToken: e && fly ? s.flyToken + 1 : s.flyToken }));
    if (!e || e.catalog !== "eonet" || !e.polygonCount || e.polygons) return;
    set({ detail: { loading: true } });
    api.event(e.id).then((d) => {
      if (seq !== detailSeq) return;
      const full: Ev = { ...e, polygons: fromEonet(d.event).polygons };
      set((s) => ({
        selected: full, detail: { loading: false },
        data: s.data && { ...s.data, events: s.data.events.map((x) => x.id === full.id ? full : x) },
        focus: s.focus?.id === full.id ? full : s.focus,
      }));
    }).catch((err) => { if (seq === detailSeq) set({ detail: { loading: false, error: msg(err) } }); });
  },

  openStory: async (story) => {
    const seq = ++detailSeq;
    set({ story, focus: undefined, selected: undefined, storyError: undefined, playing: false, detail: { loading: true } });
    try {
      let ev: Ev | undefined;
      if (story.catalog === "eonet") ev = fromEonet((await api.event(story.id)).event, story.cat);
      else if (story.quake) {
        const q = story.quake, t = Date.parse(q.day);
        const r = await api.earthquakes({ minlat: q.lat - 1.5, maxlat: q.lat + 1.5, minlon: q.lon - 1.5, maxlon: q.lon + 1.5, start: isoDay(t - DAY), end: isoDay(t + DAY), minmag: 5, limit: 50 });
        const hit = r.events.find((x) => x.id === story.id);
        ev = hit && fromQuake(hit);
      }
      if (seq !== detailSeq) return;
      if (!ev) throw new Error("The catalogue did not return this record.");
      set((s) => ({ focus: ev, selected: ev, detail: { loading: false }, cursor: story.play && ev.track?.length ? ev.track[0].t : ev.end, flyToken: s.flyToken + 1 }));
    } catch (err) {
      if (seq === detailSeq) set({ storyError: msg(err), detail: { loading: false } });
    }
  },
  closeStory: () => set((s) => ({ story: undefined, focus: undefined, storyError: undefined, selected: undefined, playing: false, cursor: s.data?.to ?? Date.now() })),
}));

export function shownEvents(s: Pick<State, "focus" | "story" | "data" | "cats" | "minMag" | "cursor">): Ev[] {
  if (s.story) return s.focus && s.focus.start <= s.cursor ? [s.focus] : [];
  if (!s.data) return [];
  return s.data.events.filter((e) => s.cats[e.cat] && e.start <= s.cursor && (e.cat !== "earthquakes" || (e.mag ?? 0) >= s.minMag));
}

export function timeSteps(s: Pick<State, "focus" | "story" | "data">): number[] {
  if (s.story) return s.focus?.track?.length ? s.focus.track.map((f) => f.t) : [];
  return s.data ? daySteps(s.data.from, s.data.to) : [];
}
