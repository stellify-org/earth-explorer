import { Material, PerInstanceColorAppearance, Primitive, TextureMagnificationFilter, TextureMinificationFilter, type CesiumWidget } from "@cesium/engine";
import { Cartesian2, Cartesian3, Cartesian4, Color, ColorGeometryInstanceAttribute, GeometryInstance, SimplePolylineGeometry } from "@cesium/core";
import type { Frame } from "./frame";
import { gridParams } from "./gridMath";
import type { GeoSet } from "../geo/store";

const SHADER =  `
float ee_q(sampler2D t, vec2 uv) {
  vec4 c = texture(t, uv);
  if (c.a < 0.5) return -1.0;
  return floor(c.r * 255.0 + 0.5) * 256.0 + floor(c.g * 255.0 + 0.5);
}
float ee_sample(sampler2D t, vec4 g, vec4 d, float lon, float lat) {
  float x = lon;
  if (d.z < 0.5 && x < g.x) x += 360.0;
  float j = floor((x - g.x) / g.z);
  if (d.z > 0.5) j = mod(j, d.x);
  else if (j < 0.0 || j > d.x - 1.0) return -1.0;
  float i = floor((lat - g.y) / g.w);
  if (d.w > 0.5) i = clamp(i, 0.0, d.y - 1.0);
  else if (i < 0.0 || i > d.y - 1.0) return -1.0;
  return ee_q(t, vec2((j + 0.5) / d.x, (i + 0.5) / d.y));
}
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  float lon; float lat;
  if (fromSt > 0.5) {
    lon = -180.0 + 360.0 * materialInput.st.s;
    lat = -90.0 + 180.0 * materialInput.st.t;
  } else {
    vec3 p = (czm_inverseView * vec4(-materialInput.positionToEyeEC, 1.0)).xyz;
    lon = degrees(atan(p.y, p.x));
    lat = degrees(atan(p.z, 0.9933056200098587 * length(p.xy)));
  }
  float q = -1.0;
  vec2 Q = pQ;
  if (hasRegion > 0.5) { q = ee_sample(rTex, rGrid, rDims, lon, lat); Q = rQ; }
  if (q < 0.0) { q = ee_sample(pTex, pGrid, pDims, lon, lat); Q = pQ; }
  if (q < 0.0) { m.alpha = 0.0; return m; }
  float v = Q.x + q * Q.y;
  float tt = clamp((v - range.x) / max(range.y - range.x, 1e-9), 0.0, 1.0);
  m.diffuse = texture(lut, vec2((floor(tt * 255.0) + 0.5) / 256.0, 0.5)).rgb;
  m.alpha = opacity * (alphaByValue > 0.5 ? 0.12 + 0.88 * tt : 1.0);
  return m;
}`;

export function packTexture(f: Frame): HTMLCanvasElement {
  const { nlat, nlon } = f.h;
  const c = document.createElement("canvas");
  c.width = nlon; c.height = nlat;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(nlon, nlat);
  const px = img.data;
  for (let i = 0; i < nlat; i++) {
    const y = nlat - 1 - i;
    for (let j = 0; j < nlon; j++) {
      const q = f.q[i * nlon + j];
      const o = (y * nlon + j) * 4;
      if (q === f.h.nodata) continue;
      px[o] = q >> 8; px[o + 1] = q & 255; px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function lutCanvas(table: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 1;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(256, 1);
  for (let k = 0; k < 256; k++) { img.data[k * 4] = table[k * 3]; img.data[k * 4 + 1] = table[k * 3 + 1]; img.data[k * 4 + 2] = table[k * 3 + 2]; img.data[k * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function gridUniforms(f: Frame) {
  const p = gridParams(f);
  return { grid: new Cartesian4(...p.grid), dims: new Cartesian4(...p.dims), q: new Cartesian2(f.h.offset, f.h.scale) };
}

const EMPTY = (() => { const c = document.createElement("canvas"); c.width = c.height = 1; return c; })();

export function makeMaterial(fromSt: boolean): Material {
  return new Material({
    fabric: {

      uniforms: {
        pTex: EMPTY, rTex: EMPTY, lut: EMPTY,
        pGrid: new Cartesian4(0, 0, 1, 1), pDims: new Cartesian4(1, 1, 0, 0), pQ: new Cartesian2(0, 1),
        rGrid: new Cartesian4(0, 0, 1, 1), rDims: new Cartesian4(1, 1, 0, 0), rQ: new Cartesian2(0, 1),
        hasRegion: 0, range: new Cartesian2(0, 1), opacity: 0.8, alphaByValue: 0, fromSt: fromSt ? 1 : 0,
      },
      source: SHADER,
    },
    translucent: true,
    minificationFilter: TextureMinificationFilter.NEAREST,
    magnificationFilter: TextureMagnificationFilter.NEAREST,
  });
}

export interface GpuStyle { lut: HTMLCanvasElement; range: [number, number]; opacity: number; alphaByValue: boolean }

export function applyFrames(m: Material, planet: Frame | undefined, region: Frame | undefined, s: GpuStyle, last: { planet?: Frame; region?: Frame; lut?: HTMLCanvasElement }) {
  const u = m.uniforms;
  if (last.planet !== planet) {
    if (planet) {
      const g = gridUniforms(planet);
      u.pTex = packTexture(planet); u.pGrid = g.grid; u.pDims = g.dims; u.pQ = g.q;
    } else {

      u.pTex = EMPTY; u.pGrid = new Cartesian4(0, 0, 1, 1); u.pDims = new Cartesian4(1, 1, 0, 0); u.pQ = new Cartesian2(0, 1);
    }
    last.planet = planet;
  }
  if (region !== last.region) {
    if (region) {
      const g = gridUniforms(region);
      u.rTex = packTexture(region); u.rGrid = g.grid; u.rDims = g.dims; u.rQ = g.q;
    }
    last.region = region;
  }
  u.hasRegion = region ? 1 : 0;
  if (last.lut !== s.lut) { u.lut = s.lut; last.lut = s.lut; }
  u.range = new Cartesian2(s.range[0], s.range[1]);
  u.opacity = s.opacity;
  u.alphaByValue = s.alphaByValue ? 1 : 0;
}

export function geographyOverlay(set: GeoSet): Primitive {
  const instances: GeometryInstance[] = [];
  const add = (name: "coast" | "borders" | "lakes", color: Color) => {
    const attr = ColorGeometryInstanceAttribute.fromColor(color);
    for (const f of set[name]?.features ?? []) {
      for (const rings of f.parts) for (const r of rings) {
        if (r.length < 4) continue;
        const pos: Cartesian3[] = [];
        for (let k = 0; k < r.length; k += 2) pos.push(Cartesian3.fromDegrees(r[k], r[k + 1], 1500));
        instances.push(new GeometryInstance({ geometry: new SimplePolylineGeometry({ positions: pos }), attributes: { color: attr } }));
      }
    }
  };
  add("coast", Color.fromCssColorString("rgba(146,196,214,0.85)"));
  add("lakes", Color.fromCssColorString("rgba(146,196,214,0.6)"));
  add("borders", Color.fromCssColorString("rgba(232,236,242,0.75)"));
  return new Primitive({ geometryInstances: instances, appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }), asynchronous: true });
}

export type { CesiumWidget };
