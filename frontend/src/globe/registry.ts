import type { CesiumWidget } from "@cesium/engine";

let main: CesiumWidget | null = null;
const listeners = new Set<(v: CesiumWidget | null) => void>();
export function setMainViewer(v: CesiumWidget | null) {
  main = v;

  (window as unknown as { __ee?: Record<string, unknown> }).__ee = { ...((window as unknown as { __ee?: Record<string, unknown> }).__ee ?? {}), viewer: v };
  listeners.forEach((l) => l(v));
}
export function getMainViewer() { return main; }
export function onMainViewer(l: (v: CesiumWidget | null) => void) { listeners.add(l); l(main); return () => { listeners.delete(l); }; }
