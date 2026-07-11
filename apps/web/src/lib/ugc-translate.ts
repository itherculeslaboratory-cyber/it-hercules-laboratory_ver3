// V3-I18-06 — on-device, on-demand UGC translation ONLY.
//
// Standing server-side translation is forbidden: it would run cost every day
// (不変条項① running-cost) and route user content through a third party. So UGC
// is always shown in its ORIGINAL language, tagged with `lang`; a viewer may
// explicitly opt in per item, at which point translation happens on the device
// (the browser's on-device Translator API when present) — never as a network
// call from this app. Until such an API is wired, the original text is returned
// unchanged. This module is the call contract + the on-device hook seam.

export interface TranslateRequest {
  text: string;
  /** BCP-47 tag of the original author's language (from the listing's `lang`). */
  sourceLang?: string;
  /** BCP-47 tag of the current viewer. */
  viewerLocale: string;
}

export interface TranslateResult {
  text: string;
  translated: boolean;
  /** Which engine produced `text`. "none" = original returned unchanged. */
  engine: "device" | "none";
}

/** Compare only the primary subtag (ja-JP vs ja are the same language). */
function primary(tag: string | undefined): string {
  return (tag ?? "").split("-")[0].toLowerCase();
}

/**
 * Whether to show a "翻訳" affordance: only when the source language is known
 * and differs from the viewer's. Same-language content shows no button.
 */
export function shouldOfferTranslation(
  sourceLang: string | undefined,
  viewerLocale: string,
): boolean {
  const src = primary(sourceLang);
  if (!src) return false;
  return src !== primary(viewerLocale);
}

/**
 * Translate on the device, on demand. Returns the ORIGINAL text unchanged unless
 * an on-device translator is available on this platform. Never issues a network
 * request from this app (I18-06). The device path is a seam: it activates when
 * the browser ships a usable on-device Translator API.
 */
export async function translateOnDemand(req: TranslateRequest): Promise<TranslateResult> {
  if (!shouldOfferTranslation(req.sourceLang, req.viewerLocale)) {
    return { text: req.text, translated: false, engine: "none" };
  }
  // ponytail: on-device translator seam — the browser Translator API is still
  // behind flags/limited. When it lands, translate HERE (device-local only).
  // Upgrade path: `const t = await self.translation?.createTranslator({...})`.
  // Until then we honour I18-06 by returning the original, not a server call.
  return { text: req.text, translated: false, engine: "none" };
}
