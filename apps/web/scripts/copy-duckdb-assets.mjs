// g81-f2wiring T3: apps/web/public/duckdb/ is generated (not committed — see
// .gitignore). This copies the 4 files research mode needs (duckdb-client.ts
// only references the mvp/eh pair, not the coi pthread variant) straight out
// of the @duckdb/duckdb-wasm npm package into public/duckdb/, run via
// predev/prebuild so a clean checkout + `npm install` reproduces them.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..", "..", "..", "node_modules", "@duckdb", "duckdb-wasm", "dist");
const DEST_DIR = join(__dirname, "..", "public", "duckdb");

// duckdb-client.ts's DuckDBBundles only names these 4 (mvp + eh, no coi).
const FILES = ["duckdb-mvp.wasm", "duckdb-eh.wasm", "duckdb-browser-mvp.worker.js", "duckdb-browser-eh.worker.js"];

export function copyDuckdbAssets() {
  mkdirSync(DEST_DIR, { recursive: true });
  for (const name of FILES) {
    copyFileSync(join(SRC_DIR, name), join(DEST_DIR, name));
  }
  return FILES.map((name) => join(DEST_DIR, name));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const written = copyDuckdbAssets();
  for (const path of written) {
    if (!existsSync(path) || statSync(path).size === 0) {
      throw new Error(`copy-duckdb-assets: missing or empty output: ${path}`);
    }
  }
  console.log(`copy-duckdb-assets: wrote ${written.length} files to ${DEST_DIR}`);
}
