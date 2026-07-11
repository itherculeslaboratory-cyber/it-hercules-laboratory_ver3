import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ScreenDef } from "@/renderer/types";

// screen-defs/ is the repo-root SSOT (design-c2 §4.5). Server components and
// vitest both run with cwd = apps/web, so ../../screen-defs resolves for both.
// ponytail: fs read in a server context — no bundler outside-root import needed.
const SCREENDEFS_DIR = join(process.cwd(), "..", "..", "screen-defs");

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
