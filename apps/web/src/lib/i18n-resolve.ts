// V3-I18-08 — pure resolver + fallback chain (no node:fs/node:path). Split out
// of i18n.ts so client components (renderer.tsx, "use client") can import the
// resolver without dragging loadCatalogs()'s node:fs/node:path into the
// browser bundle (Next's production webpack build fails hard on "node:"
// imports reaching client code — i18n.ts re-exports everything here for
// server-side callers, so this file is the client-safe half).
//
// Fallback chain (design-k4 §1.5): [exact ja-JP] -> [lang ja] -> [DEFAULT ja]
// -> key. Authored language is ja, so ja is BOTH the default and the "always
// filled" final layer that the requirement calls "en" — a documented deviation
// (design-k4 §1.5). The chain never yields an empty string: an unresolved key
// returns the key itself, never "".
export const DEFAULT_LOCALE = "ja";

export type Catalog = Record<string, string>;
/** locale -> catalog. e.g. { "ja": {...}, "en": {...} }. */
export type Catalogs = Record<string, Catalog>;

// A locale into its ordered fallback list: exact, then its language subtag,
// then DEFAULT_LOCALE — de-duplicated (ja-JP -> [ja-JP, ja]; en -> [en, ja]).
export function fallbackLocales(locale: string): string[] {
  const chain: string[] = [];
  const push = (l: string) => {
    if (l && !chain.includes(l)) chain.push(l);
  };
  push(locale); // exact (e.g. ja-JP)
  push(locale.split("-")[0]); // language subtag (e.g. ja)
  push(DEFAULT_LOCALE); // always-filled final catalog layer (ja)
  return chain;
}

// Look up a key through the fallback chain. Returns undefined when no catalog
// layer holds a non-empty value — the Renderer treats that as "use the literal".
export function lookupMessage(
  catalogs: Catalogs,
  locale: string,
  key: string,
): string | undefined {
  for (const loc of fallbackLocales(locale)) {
    const v = catalogs[loc]?.[key];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

// I18-08: full chain including the key itself as the last resort — NEVER empty.
// Use for standalone message resolution (not the Renderer literal-fallback path).
export function resolveMessage(catalogs: Catalogs, locale: string, key: string): string {
  return lookupMessage(catalogs, locale, key) ?? key;
}

// A ResolveMessage for the Renderer's MessagesCtx. Returns undefined for a key
// absent from every catalog layer so the Renderer falls back to the screen-def
// literal (byte-identical output before any catalog is authored). Wire at the
// page level: <Renderer resolveMessage={makeResolver(loadCatalogs(), locale)} />.
export function makeResolver(
  catalogs: Catalogs,
  locale: string,
): (key: string) => string | undefined {
  return (key) => lookupMessage(catalogs, locale, key);
}
