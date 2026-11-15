import { create } from "zustand";
import type { Ev } from "../model";
import { adapterFor } from "./adapters";
import type { Bundle, Tier } from "./types";

interface State {

  eventId?: string;
  status: "idle" | "loading" | "ready" | "error";
  bundle?: Bundle;
  error?: string;
  on: Record<string, boolean>;
  tier: Tier;

  flyToken: number;
  open: (ev: Ev) => Promise<Bundle | undefined>;
  close: () => void;
  toggle: (id: string) => void;
  setTier: (t: Tier) => void;
}

const loaded = new Map<string, Bundle>();
let seq = 0, abort: AbortController | undefined;

export const useEvidence = create<State>((set, get) => ({
  status: "idle",
  on: {},
  tier: "global",
  flyToken: 0,

  open: async (ev) => {
    const mine = ++seq;
    abort?.abort();
    abort = new AbortController();
    const cached = loaded.get(ev.id);
    const ready = (bundle: Bundle) => set((s) => ({ eventId: ev.id, status: "ready", bundle, error: undefined, on: Object.fromEntries(bundle.layers.map((l) => [l.id, l.on])), flyToken: s.flyToken + 1 }));
    if (cached) { ready(cached); return cached; }
    set({ eventId: ev.id, status: "loading", bundle: undefined, error: undefined, on: {} });
    try {
      const bundle = await adapterFor(ev).load(ev, abort.signal);
      if (mine !== seq) return undefined;

      if (ev.geometry !== "polygon" || ev.polygons || bundle.builder !== "catalogue record") loaded.set(ev.id, bundle);
      ready(bundle);
      return bundle;
    } catch (e) {
      if (mine === seq && (e as Error).name !== "AbortError") set({ status: "error", error: (e as Error).message });
      return undefined;
    }
  },
  close: () => { seq++; abort?.abort(); if (get().status !== "idle") set({ eventId: undefined, status: "idle", bundle: undefined, error: undefined, on: {} }); },
  toggle: (id) => set((s) => ({ on: { ...s.on, [id]: !s.on[id] } })),
  setTier: (tier) => { if (tier !== get().tier) set({ tier }); },
}));

export const activeBundle = (s: Pick<State, "status" | "bundle" | "eventId">, eventId?: string) => s.status === "ready" && s.bundle && s.eventId === eventId ? s.bundle : undefined;
