// V3-UIX-45 — apply a ThemePack's colour tokens to the document root inline, so
// switching packs is visible immediately, with no reload. Only the 15 colour
// tokens are pack-overridable (design-c5 §1.5); radius/tap/motion/font/type-scale
// are civilisation-wide and stay defined in tokens.generated.css.
// info/info-bg/caution/caution-bg added by V3-UIX-04 (色は意味のみ: 青=情報/黄=注意)。

export const THEME_TOKEN_KEYS = [
  "bg",
  "surface",
  "surface-2",
  "text",
  "text-muted",
  "border",
  "primary",
  "primary-text",
  "focus",
  "danger",
  "danger-bg",
  "info",
  "info-bg",
  "caution",
  "caution-bg",
] as const;

export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];
export type ThemeTokens = Partial<Record<ThemeTokenKey, string>>;

/**
 * Set `--civ-<key>` inline on the root element for each provided colour token.
 * Inline root vars win over the stylesheet's :root, so the swap is instant.
 * Unknown keys are ignored (only the 15 pack tokens are honoured).
 */
export function applyThemePack(
  tokens: ThemeTokens,
  root: HTMLElement = document.documentElement,
): void {
  for (const key of THEME_TOKEN_KEYS) {
    const v = tokens[key];
    if (typeof v === "string" && v !== "") {
      root.style.setProperty(`--civ-${key}`, v);
    }
  }
}

/** Clear any inline pack overrides, falling back to the stylesheet defaults. */
export function resetThemePack(root: HTMLElement = document.documentElement): void {
  for (const key of THEME_TOKEN_KEYS) root.style.removeProperty(`--civ-${key}`);
}
