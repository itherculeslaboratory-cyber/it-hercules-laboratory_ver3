// V3-I18-08 — i18n message resolver + fallback chain. The catalog lives in
// i18n/{locale}.json (repo-root SSOT, keyed {screen}.{component}.{field}); the
// Renderer holds a MessagesCtx and only calls resolve(key) — this module owns
// the catalog lookup and the fallback chain.
//
// The pure resolver (no node:fs/node:path) lives in ./i18n-resolve so client
// components can import it directly; this file re-exports it for server-side
// callers and adds loadCatalogs(), which DOES touch the filesystem and must
// never be imported from a "use client" module (see i18n-resolve.ts's header).
export {
  DEFAULT_LOCALE,
  fallbackLocales,
  lookupMessage,
  resolveMessage,
  makeResolver,
  type Catalog,
  type Catalogs,
} from "./i18n-resolve";

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Catalogs } from "./i18n-resolve";

// Load i18n/*.json from the repo-root SSOT. Server components and vitest both
// run with cwd = apps/web, so ../../i18n resolves for both (mirrors screendefs).
// ponytail: fs read in a server context — no outside-root bundler import needed.
export function loadCatalogs(): Catalogs {
  const dir = join(process.cwd(), "..", "..", "i18n");
  const out: Catalogs = {};
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".json")) {
      out[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, f), "utf8"));
    }
  }
  return out;
}
