const R = 6_371_000;
const START = 1_000_000;
const END = 10_000_000;

export function maxOffNadir(distance: number): number | undefined {
  const h = distance - R;
  if (!(h > START)) return undefined;
  const limb = Math.asin(Math.min(1, R / distance));
  return limb * (1 - Math.min(1, (h - START) / (END - START)));
}

export function groundRange(distance: number, offNadir: number): number | undefined {
  const along = distance * Math.cos(offNadir);
  const disc = along * along - (distance * distance - R * R);
  if (!(disc >= 0) || along <= 0) return undefined;
  return along - Math.sqrt(disc);
}
