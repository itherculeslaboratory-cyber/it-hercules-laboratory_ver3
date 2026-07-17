// I18-01/I18-03 — server-side lookup of the signed-in viewer's saved locale
// preference, so the very first server render of a screen already matches it
// (UI 言語は登録言語設定に従う・I18-01) and a locale change takes effect on the
// very next load without re-login (I18-03: settings.json's pref-form has a
// self-transition, so saving reloads this same screen — see screen-defs/
// settings.json — and this function re-reads the just-saved value).
//
// Anonymous visitors and any fetch failure fall back to DEFAULT_LOCALE, which
// is exactly today's always-ja behavior — this can only add correctness, never
// regress an existing render.
import { cookies } from "next/headers";
import { API_BASE } from "./api";
import { DEFAULT_LOCALE } from "./i18n";

/** Pure: pick a locale string out of a GET /me/preferences-shaped body. */
export function pickLocale(body: unknown): string {
  const locale = (body as { locale?: unknown } | null)?.locale;
  return typeof locale === "string" && locale ? locale : DEFAULT_LOCALE;
}

export async function fetchViewerLocale(): Promise<string> {
  try {
    const jar = await cookies();
    const cookieHeader = jar.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await fetch(`${API_BASE}/api/v1/me/preferences`, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: "no-store",
    });
    if (!res.ok) return DEFAULT_LOCALE;
    return pickLocale(await res.json());
  } catch {
    return DEFAULT_LOCALE;
  }
}
