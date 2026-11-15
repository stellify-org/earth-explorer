import type { N } from "../api/types";

export function fmt(x: N | undefined, digits = 3): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "n/a";
  const a = Math.abs(x);
  if (a === 0) return "0";
  if (a >= 1000) return x.toFixed(0);
  if (a >= 1) return x.toFixed(Math.max(0, digits - 1));
  if (a >= 0.001) return x.toPrecision(digits);
  return x.toExponential(1);
}

export function fmtSigned(x: N | undefined, digits = 3): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "n/a";
  return (x > 0 ? "+" : x < 0 ? "−" : "") + fmt(Math.abs(x), digits);
}

export function fmtP(p: N | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "n/a";
  if (p < 0.001) return "< 0.001";
  return p.toFixed(3);
}

export function fmtLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}° ${ns}, ${Math.abs(lon).toFixed(3)}° ${ew}`;
}

export function parseLatLon(s: string): { lat: number; lon: number } | null {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
  return { lat, lon };
}
