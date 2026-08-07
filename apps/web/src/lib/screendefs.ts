import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ScreenDef } from "@/renderer/types";

// screen-defs/ is the repo-root SSOT (design-c2 §4.5). ../../screen-defs resolves
// fine for local dev/vitest (cwd = apps/web, repo checkout intact) but a Pages
// build artifact doesn't contain anything outside apps/web (ORDER-2026-08-07-
// release-fixes T4 / docs/planning/c6/webdeploy-design.md §3 案A). `npm run
// predev`/`prebuild` copies screen-defs/*.json into apps/web/screendefs-data/
// (scripts/copy-screendefs.mjs) — prefer that local copy when present, else
// fall back to the repo-root SSOT (keeps a checkout that hasn't run
// predev/prebuild, e.g. a bare `vitest run`, working unchanged).
const LOCAL_SCREENDEFS_DIR = join(process.cwd(), "screendefs-data");
const SCREENDEFS_DIR = existsSync(LOCAL_SCREENDEFS_DIR)
  ? LOCAL_SCREENDEFS_DIR
  : join(process.cwd(), "..", "..", "screen-defs");

export function loadScreenDef(id: string): ScreenDef {
  return JSON.parse(
    readFileSync(join(SCREENDEFS_DIR, `${id}.json`), "utf8"),
  ) as ScreenDef;
}

export function allScreenDefIds(): string[] {
  // navigation.json is a flow map (entry/screens/edges), not a ScreenDef — exclude it.
  return readdirSync(SCREENDEFS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "navigation.json")
    .map((f) => f.replace(/\.json$/, ""));
}

export function allScreenDefs(): ScreenDef[] {
  return allScreenDefIds().map(loadScreenDef);
}
