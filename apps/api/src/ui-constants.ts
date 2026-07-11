// C5 K4 凍結定数(design-k4 §1.5)。UI/UX+設定+i18n のマジック値を 1 ファイルに集約
// (ハードコード散在禁止)。TEMPLATE/VOTE 種別・採用閾値・built-in パック slug・既定
// locale/template。色トークン 11 キーは schema(theme-pack.schema.json)が構造強制する
// ため validator 側が正本・ここでは重複させない。
export const TEMPLATE_LEVELS = ["default", "recommended", "custom"] as const;
export const VOTE_KINDS = ["like", "platinum"] as const;

// 採用候補(adoption_candidate)判定閾値。platinum 票 or 使用 actor 数のいずれか到達で候補化。
export const ADOPTION_PLATINUM_THRESHOLD = 8;
export const ADOPTION_USAGE_THRESHOLD = 21;

// built-in パック slug(ULID でなく JSON ファイル直配信・envelope 検証外・lineage 終端)。
export const BUILTIN_THEME_PACK_IDS = ["minimal-light", "minimal-dark"] as const;

export const DEFAULT_LOCALE = "ja";
export const DEFAULT_TEMPLATE_ID = "default";
export const DEFAULT_THEME_PACK_ID = "minimal-light";
