import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(fileURLToPath(new URL(".", import.meta.url)), "..", "dist");
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
let raw = 0, br = 0, n = 0;
for (const f of walk(dist)) {
  if (!/\.(js|mjs|css|html|json|svg|wasm|txt|xml|bin)$/.test(f)) continue;
  const b = readFileSync(f);
  if (b.length < 512) continue;
  const B = brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } });
  writeFileSync(f + ".br", B);
  writeFileSync(f + ".gz", gzipSync(b, { level: 9 }));
  raw += b.length; br += B.length; n++;
}
console.log(`precompressed ${n} files: ${(raw / 1e6).toFixed(1)} MB -> ${(br / 1e6).toFixed(1)} MB brotli`);
