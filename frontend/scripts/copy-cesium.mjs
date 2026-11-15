import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const src = join(root, "node_modules/@cesium/engine/Build");
const dest = join(root, "public/cesium");
if (!existsSync(src)) throw new Error("@cesium/engine package not installed");
mkdirSync(dest, { recursive: true });
for (const d of ["Workers", "Assets", "ThirdParty"]) cpSync(join(src, d), join(dest, d), { recursive: true });
console.log("cesium assets copied to public/cesium");
