import { createHash } from "node:crypto";
import { brotliCompressSync } from "node:zlib";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(fileURLToPath(new URL(".", import.meta.url)), "..", "dist");
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (p) => "/" + relative(dist, p).split("\\").join("/");

const ctry = JSON.parse(readFileSync(join(dist, "geo/countries.json"), "utf8"));
const labels = ctry.layers.countries.f.filter((f) => f.n && f.lx !== undefined).map((f) => [f.n, +f.lx.toFixed(3), +f.ly.toFixed(3), f.lr ?? 6]);
writeFileSync(join(dist, "geo/labels.json"), JSON.stringify(labels));
console.log(`labels.json: ${labels.length} labels`);

const files = walk(dist).map(rel);

const keep = (f) =>
  f === "/index.html" ||
  (/^\/assets\/(index|react|cesium|rolldown-runtime)-[^/]+\.(js|css)$/.test(f)) ||
  ["/geo/manifest.json", "/geo/lod0.json", "/geo/labels.json"].includes(f);
const precache = ["/", ...files.filter(keep)];
const bytes = precache.reduce((s, f) => s + (f === "/" ? 0 : statSync(join(dist, f)).size), 0);

const build = createHash("sha256").update(precache.filter((f) => f.startsWith("/assets/")).join("|")).digest("hex").slice(0, 10);
const geo = createHash("sha256").update(readFileSync(join(dist, "geo/manifest.json"))).digest("hex").slice(0, 10);
const swPath = join(dist, "sw.js");
const sw = readFileSync(swPath, "utf8")
  .replace("__BUILD__", build)
  .replace("__GEO__", geo)
  .replace("self.__PRECACHE__ || []", JSON.stringify(precache));
writeFileSync(swPath, sw);
console.log(`sw.js: ${precache.length} precached files, ${(bytes / 1e6).toFixed(1)} MB, build ${build}, geo ${geo}`);

const sha = (f) => createHash("sha256").update(readFileSync(join(dist, f))).digest("hex");
const brSize = (f) => brotliCompressSync(readFileSync(join(dist, f))).length;
const gm = JSON.parse(readFileSync(join(dist, "geo/manifest.json"), "utf8"));
const chunk = (u) => ({ url: u, bytes: brSize(u.slice(1)), sha256: sha(u.slice(1)) });
const inBox = (id, w, s, e, n) => { const [cx, cy] = id.split("_").map(Number); const x0 = -180 + cx * 15, y0 = -90 + cy * 15; return x0 < e && x0 + 15 > w && y0 < n && y0 + 15 > s; };
const base = { version: gm.source.commit.slice(0, 7), units: "", source_url: gm.source.repository, upstream_doi: "", citation: "Natural Earth (public domain)", required_app_version: "0.2.0", variable: "geography" };
const geoPacks = [
  { ...base, id: "geo-50m", title: "Geography detail 1:50m + country names", description: "Coasts, borders, lakes, rivers, glaciers at 1:50m and country polygons/labels.", temporal_resolution: "static", from: "", to: "", spatial_resolution: "1:50m",
    chunks: ["/geo/lod1.json", "/geo/countries.json"].map(chunk) },
  { ...base, id: "geo-central-asia-10m", title: "Regional geography 1:10m — Central Asia", description: "1:10m chunks for 45–90°E, 30–60°N.", temporal_resolution: "static", from: "", to: "", spatial_resolution: "1:10m",
    chunks: gm.lod2_chunks.filter((id) => inBox(id, 45, 30, 90, 60)).map((id) => chunk(`/geo/lod2/${id}.json`)) },
  { ...base, id: "geo-world-10m", title: "World geography 1:10m (all regions)", description: "All 1:10m chunks; large — only if you need offline regional detail everywhere.", temporal_resolution: "static", from: "", to: "", spatial_resolution: "1:10m",
    chunks: gm.lod2_chunks.map((id) => chunk(`/geo/lod2/${id}.json`)) },
].map((p) => ({ ...p, bytes: p.chunks.reduce((a, c) => a + c.bytes, 0) }));
writeFileSync(join(dist, "geo/packs.json"), JSON.stringify(geoPacks));
console.log("geo packs:", geoPacks.map((p) => `${p.id} ${(p.bytes / 1e3).toFixed(0)} kB`).join(", "));
