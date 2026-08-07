// ORDER-2026-08-07-release-fixes T4(docs/planning/c6/webdeploy-design.md §3 案A採用):
// screen-defs/*.json は repo-root SSOT(design-c2 §4.5)だが、screendefs.ts はこれを
// process.cwd()/../../screen-defs から実行時 fs 読みしており、Pages ビルド成果物に
// apps/web の外側は含まれない。copy-duckdb-assets.mjs と同型の prebuild スクリプトで
// apps/web 内(screendefs-data/)へビルド前にコピーし、screendefs.ts の読み込み先を
// そちらへ切り替える(README同型: 生成物なので .gitignore・未コミット)。
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..", "..", "..", "screen-defs");
const DEST_DIR = join(__dirname, "..", "screendefs-data");

export function copyScreendefs() {
  mkdirSync(DEST_DIR, { recursive: true });
  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith(".json"));
  for (const name of files) {
    copyFileSync(join(SRC_DIR, name), join(DEST_DIR, name));
  }
  return files.map((name) => join(DEST_DIR, name));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const written = copyScreendefs();
  for (const path of written) {
    if (!existsSync(path) || statSync(path).size === 0) {
      throw new Error(`copy-screendefs: missing or empty output: ${path}`);
    }
  }
  console.log(`copy-screendefs: wrote ${written.length} files to ${DEST_DIR}`);
}
