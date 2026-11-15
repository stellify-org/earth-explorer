export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseISODate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || toISODate(d) !== s ? null : d;
}

export function addDays(s: string, n: number): string {
  const d = parseISODate(s);
  if (!d) return s;
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}

export function diffDays(a: string, b: string): number {
  const da = parseISODate(a), db = parseISODate(b);
  if (!da || !db) return NaN;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

const EPOCH = Date.UTC(1980, 0, 1);
export function dayIndex(s: string): number {
  const d = parseISODate(s);
  return d ? Math.round((d.getTime() - EPOCH) / 86_400_000) : 0;
}
export function fromDayIndex(i: number): string {
  return toISODate(new Date(EPOCH + i * 86_400_000));
}
