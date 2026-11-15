import { BillboardCollection, type Billboard, type CesiumWidget } from "@cesium/engine";
import { Cartesian2, Cartesian3, Color } from "@cesium/core";
import { STYLE, type Cat } from "./model";

export interface EffectItem {

  key: string;
  kind: Cat | "cluster";
  position: Cartesian3;
  lat: number;

  strong?: boolean;

  size?: number;

  id?: unknown;
}

const SPRITE = 64;

function canvas(draw: (c: CanvasRenderingContext2D) => void): string {
  const el = document.createElement("canvas");
  el.width = el.height = SPRITE;
  const c = el.getContext("2d")!;
  c.translate(SPRITE / 2, SPRITE / 2);
  c.lineCap = "round"; c.lineJoin = "round";
  draw(c);
  return el.toDataURL("image/png");
}

function spiral(color: string, dir: 1 | -1) {
  return canvas((c) => {
    c.scale(dir, 1);
    for (const arm of [0, Math.PI]) {
      c.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = arm + i / 40 * Math.PI * 1.35, r = 5 + i / 40 * 23;

        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      }
      const g = c.createLinearGradient(0, 0, Math.cos(arm + 4) * 28, Math.sin(arm + 4) * 28);
      g.addColorStop(0, "#ffffff"); g.addColorStop(1, color);
      c.strokeStyle = g; c.lineWidth = 6; c.stroke();
    }
    c.beginPath(); c.arc(0, 0, 5.5, 0, Math.PI * 2); c.fillStyle = "#0b1a33"; c.fill();
    c.lineWidth = 2.5; c.strokeStyle = "#ffffff"; c.stroke();
  });
}
const flame = () => canvas((c) => {
  const body = (s: number, fill: string) => {
    c.beginPath();
    c.moveTo(0, -28 * s);
    c.bezierCurveTo(16 * s, -10 * s, 20 * s, 6 * s, 12 * s, 18 * s);
    c.bezierCurveTo(8 * s, 26 * s, -8 * s, 26 * s, -12 * s, 18 * s);
    c.bezierCurveTo(-20 * s, 6 * s, -8 * s, -4 * s, -8 * s, -14 * s);
    c.bezierCurveTo(-4 * s, -10 * s, -2 * s, -18 * s, 0, -28 * s);
    c.fillStyle = fill; c.fill();
  };
  c.translate(0, 4);
  body(1, "#ef4444"); c.translate(0, 6); body(0.66, "#fb923c"); c.translate(0, 5); body(0.36, "#fde68a");
});
const ringSprite = (color: string, width: number) => canvas((c) => {
  c.beginPath(); c.arc(0, 0, 26, 0, Math.PI * 2); c.strokeStyle = color; c.lineWidth = width; c.stroke();
});
const puff = () => canvas((c) => {
  const g = c.createRadialGradient(0, 0, 2, 0, 0, 24);
  g.addColorStop(0, "rgba(226,232,240,0.95)"); g.addColorStop(1, "rgba(148,163,184,0)");
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, 24, 0, Math.PI * 2); c.fill();
});
const cone = (color: string) => canvas((c) => {
  c.beginPath(); c.moveTo(-26, 24); c.lineTo(-7, -8); c.lineTo(7, -8); c.lineTo(26, 24); c.closePath();
  c.fillStyle = "#57534e"; c.fill(); c.strokeStyle = "#e7e5e4"; c.lineWidth = 2; c.stroke();
  c.beginPath(); c.moveTo(-7, -8); c.lineTo(-3, 2); c.lineTo(0, -3); c.lineTo(4, 4); c.lineTo(7, -8); c.closePath(); c.fillStyle = color; c.fill();
});
const slope = (color: string) => canvas((c) => {
  c.beginPath(); c.moveTo(-28, -18); c.lineTo(28, 22); c.lineTo(-28, 22); c.closePath();
  c.fillStyle = "#57534e"; c.fill(); c.strokeStyle = color; c.lineWidth = 2.5; c.stroke();
});
const stone = () => canvas((c) => {
  c.beginPath(); c.moveTo(-14, -6); c.lineTo(-2, -15); c.lineTo(13, -8); c.lineTo(15, 8); c.lineTo(0, 15); c.lineTo(-13, 9); c.closePath();
  c.fillStyle = "#d6d3d1"; c.fill(); c.strokeStyle = "#44403c"; c.lineWidth = 3; c.stroke();
});

interface Part { b: Billboard; move: (b: Billboard, t: number) => void }

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 10_000) / 10_000; };
const frac = (x: number) => x - Math.floor(x);
const WHITE = Color.WHITE;

export class EventEffects {
  private bills = new BillboardCollection();
  private parts: Part[] = [];
  private pops: { position: Cartesian3; color: Color; born: number; b?: Billboard }[] = [];
  private sprites?: Record<string, string>;
  private raf = 0;
  private last = 0;
  private started = false;
  private items: EffectItem[] = [];
  enabled = true;
  readonly reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  stats = { symbols: 0, billboards: 0, frames: 0, running: false, pops: 0 };

  constructor(private viewer: CesiumWidget) {}

  start() {
    if (this.started) return;
    this.started = true;
    this.viewer.scene.primitives.add(this.bills);
    document.addEventListener("visibilitychange", this.onVisibility);
  }
  destroy() {
    if (!this.started) return;
    this.started = false;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.stats.running = false;
    if (!this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(this.bills);
  }
  private onVisibility = () => { if (!document.hidden) this.run(); };

  snapshot() {
    const out: { rot: number; scale: number; alpha: number; dx: number; dy: number }[] = [];
    if (!this.started) return out;
    for (let i = 0; i < this.bills.length; i++) { const b = this.bills.get(i); out.push({ rot: b.rotation, scale: b.scale, alpha: b.color.alpha, dx: b.pixelOffset.x, dy: b.pixelOffset.y }); }
    return out;
  }

  owns(primitive: unknown) { return this.started && this.bills.contains(primitive as Billboard); }

  setEnabled(on: boolean) { this.enabled = on; this.set(this.items); }

  private sprite(name: string): string {
    this.sprites ??= {
      stormN: spiral(STYLE.severeStorms.color, 1), stormS: spiral(STYLE.severeStorms.color, -1),
      flame: flame(), puff: puff(), stone: stone(),
      cone: cone(STYLE.volcanoes.color), slope: slope(STYLE.landslides.color),
      water: ringSprite("#93c5fd", 5), quake: ringSprite("#e9d5ff", 4), pop: ringSprite("#ffffff", 5), other: ringSprite("#cbd5e1", 3),
    };
    return this.sprites[name];
  }

  private add(image: string, position: Cartesian3, id: unknown, move: Part["move"], init: Partial<{ scale: number; color: Color; offset: Cartesian2; front: boolean }> = {}) {

    const b = this.bills.add({ image: this.sprite(image), position, id, scale: init.scale ?? 1, color: init.color ?? WHITE,
      pixelOffset: init.offset ?? Cartesian2.ZERO, disableDepthTestDistance: init.front ? Number.POSITIVE_INFINITY : 0 });
    this.parts.push({ b, move });
    return b;
  }

  set(items: EffectItem[]) {
    if (!this.started || this.viewer.isDestroyed()) return;
    this.items = items;
    this.bills.removeAll();
    this.parts = [];
    for (const p of this.pops) p.b = undefined;
    if (this.enabled) for (const it of items) this.build(it);
    this.stats.symbols = this.enabled ? items.length : 0;
    this.stats.billboards = this.parts.length;
    this.frame(performance.now());
    this.run();
  }

  private build(it: EffectItem) {
    const ph = hash(it.key), k = it.strong ? 1.6 : 1, front = !!it.strong, { position: p, id } = it;

    const up = (px: number) => new Cartesian2(0, -px * k);
    const rings = (image: string, n: number, period: number, max: number) => {
      for (let i = 0; i < n; i++) this.add(image, p, id, (b, t) => {
        const u = frac(t / period + ph + i / n);
        b.scale = (0.12 + u * max) * k; b.color = WHITE.withAlpha(Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.9, b.color);
      }, { front });
    };
    switch (it.kind) {
      case "severeStorms": {

        const dir = it.lat >= 0 ? 1 : -1;
        this.add(dir > 0 ? "stormN" : "stormS", p, id, (b, t) => { b.rotation = dir * (t * 1.9 + ph * 6.283); }, { scale: 0.7 * k, front });
        break;
      }
      case "wildfires": case "cluster": {
        const s = (it.kind === "cluster" ? 0.36 + 0.2 * Math.min(2.2, it.size ?? 1) : 0.44) * k;
        this.add("flame", p, id, (b, t) => {
          const f = 0.5 * Math.sin(t * 9 + ph * 40) + 0.3 * Math.sin(t * 15.7 + ph * 17) + 0.2 * Math.sin(t * 23.3 + ph * 5);
          b.scale = s * (1 + 0.13 * f); b.pixelOffset = new Cartesian2(1.5 * Math.sin(t * 6 + ph * 9), -26 * s);
          b.color = WHITE.withAlpha(0.86 + 0.14 * f, b.color);
        }, { front });
        break;
      }
      case "floods": rings("water", 3, 3.2, 0.9); break;
      case "earthquakes": rings("quake", 3, 1.5, it.strong ? 1 : 0.6); break;
      case "volcanoes": {
        this.add("cone", p, id, () => {}, { scale: 0.6 * k, offset: up(24), front });
        for (let i = 0; i < 3; i++) this.add("puff", p, id, (b, t) => {
          const u = frac(t / 2.6 + ph + i / 3);
          b.pixelOffset = new Cartesian2((5 + 9 * u) * Math.sin(u * 3 + i * 2.1 + ph * 6) * k, (-32 - 36 * u) * k);
          b.scale = (0.16 + 0.46 * u) * k; b.color = WHITE.withAlpha((1 - u) * 0.9, b.color);
        }, { front });
        break;
      }
      case "landslides": {
        this.add("slope", p, id, () => {}, { scale: 0.62 * k, offset: up(26), front });
        for (let i = 0; i < 3; i++) this.add("stone", p, id, (b, t) => {
          const u = frac(t / 1.7 + ph + i / 3), x = -15 + 30 * u;
          b.pixelOffset = new Cartesian2(x * k, (-26 + x * 0.714 - 5 - 5 * Math.abs(Math.sin(u * 9.4))) * k);
          b.rotation = -u * 9; b.scale = 0.2 * k; b.color = WHITE.withAlpha(Math.min(1, 6 * u, 6 * (1 - u)), b.color);
        }, { front });
        break;
      }
      default: rings("other", 2, 4, 0.7);
    }
  }

  pop(position: Cartesian3, cssColor: string) {
    if (!this.enabled || this.reduced || !this.started) return;
    if (this.pops.length >= 80) this.pops.shift();
    this.pops.push({ position, color: Color.fromCssColorString(cssColor), born: performance.now() });
    this.run();
  }

  private run() {
    if (!this.started || this.stats.running || this.reduced || document.hidden) return;
    if (!this.parts.length && !this.pops.length) return;
    this.stats.running = true;
    const loop = (now: number) => {
      if (!this.started || this.viewer.isDestroyed() || document.hidden || (!this.parts.length && !this.pops.length)) { this.stats.running = false; return; }
      if (now - this.last >= 32) { this.last = now; this.frame(now); }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(now: number) {
    if (this.viewer.isDestroyed()) return;
    const t = this.reduced ? 0.35 : now / 1000;
    for (const p of this.parts) p.move(p.b, t);
    this.pops = this.pops.filter((p) => {
      const u = (now - p.born) / 900;
      if (u >= 1) { if (p.b) this.bills.remove(p.b); return false; }
      p.b ??= this.bills.add({ image: this.sprite("pop"), position: p.position });
      p.b.scale = 0.15 + u * 0.85; p.b.color = p.color.withAlpha(1 - u, p.b.color);
      return true;
    });
    this.stats.pops = this.pops.length;
    this.stats.frames++;
    this.viewer.scene.requestRender();
  }
}
