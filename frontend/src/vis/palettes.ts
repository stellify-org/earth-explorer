export const PALETTES: Record<string, { name: string; stops: string[]; diverging?: boolean }> = {
  temperature: { name: "Blue–yellow–red (ColorBrewer RdYlBu, reversed)", stops: ["#313695", "#4575b4", "#74add1", "#abd9e9", "#e0f3f8", "#ffffbf", "#fee090", "#fdae61", "#f46d43", "#d73027", "#a50026"] },
  precipitation: { name: "Yellow–cyan–dark blue (ColorBrewer YlGnBu)", stops: ["#ffffd9", "#edf8b1", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#253494", "#081d58"] },
  soil: { name: "Brown–green–blue (ColorBrewer BrBG)", stops: ["#8c510a", "#bf812d", "#dfc27d", "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30"] },
  humidity: { name: "Green–blue (ColorBrewer GnBu)", stops: ["#f7fcf0", "#e0f3db", "#ccebc5", "#a8ddb5", "#7bccc4", "#4eb3d3", "#2b8cbe", "#0868ac", "#084081"] },
  anomaly: { name: "Diverging blue–white–red (ColorBrewer RdBu)", diverging: true, stops: ["#053061", "#2166ac", "#4393c3", "#92c5de", "#d1e5f0", "#f7f7f7", "#fddbc7", "#f4a582", "#d6604d", "#b2182b", "#67001f"] },
  anomaly_wet: { name: "Diverging dry–wet (ColorBrewer BrBG)", diverging: true, stops: ["#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#f5f5f5", "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30"] },
  speed: { name: "Viridis", stops: ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"] },
};

const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

export function lut(name: string): Uint8ClampedArray {
  const stops = (PALETTES[name] ?? PALETTES.temperature).stops.map(hex);
  const out = new Uint8ClampedArray(256 * 3);
  for (let k = 0; k < 256; k++) {
    const t = (k / 255) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t));
    const f = t - i;
    for (let c = 0; c < 3; c++) out[k * 3 + c] = Math.round(stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f);
  }
  return out;
}

export function cssGradient(name: string): string {
  const s = (PALETTES[name] ?? PALETTES.temperature).stops;
  return `linear-gradient(90deg, ${s.map((c, i) => `${c} ${((i / (s.length - 1)) * 100).toFixed(1)}%`).join(", ")})`;
}

export function robustRange(values: Float32Array, symmetric: boolean): [number, number] {
  const v: number[] = [];
  const step = Math.max(1, Math.floor(values.length / 20000));
  for (let i = 0; i < values.length; i += step) if (Number.isFinite(values[i])) v.push(values[i]);
  if (!v.length) return [0, 1];
  v.sort((a, b) => a - b);
  const lo = v[Math.floor(v.length * 0.02)], hi = v[Math.min(v.length - 1, Math.floor(v.length * 0.98))];
  if (symmetric) { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; return [-m, m]; }
  return hi > lo ? [lo, hi] : [lo - 0.5, hi + 0.5];
}
