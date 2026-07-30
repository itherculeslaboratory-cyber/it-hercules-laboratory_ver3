// V3-I18-05(制約)/ V3-I18-17(思想): 言語設定は国籍・居住地・タイムゾーン・法的管轄・
// KYCから独立させ、国籍を言語の代理変数にしない。UIは国籍で分けず全ユーザー共通の
// デフォルトとし、国旗はデフォルト非表示・任意ONで、国籍は内部データとしてのみ使う。

// ── V3-I18-05: 言語設定は UI/翻訳表示の基準のみ ────────────────────────────
// 意図的に nationality/residence/timezone/jurisdiction/kyc を型に持たない —
// 「言語設定」という概念にこれらのフィールドが**混入できない**ことを型で保証する。
export interface LanguageSetting {
  lang: string; // BCP-47等の言語タグ(表示・翻訳表示の基準のみ)
}

// 言語設定に混入してはならないフィールド名(誤って広いオブジェクトを渡した場合の
// 実行時ガード)。国籍を言語の代理変数にしない、という制約を実行時にも検査可能にする。
export const LANGUAGE_SETTING_FORBIDDEN_FIELDS = [
  "nationality",
  "residence",
  "country_of_residence",
  "timezone",
  "jurisdiction",
  "kyc",
  "kyc_status",
] as const;

/**
 * 任意のオブジェクトが「言語設定」として渡されたとき、禁止フィールドが混入して
 * いないかを検査する。混入していれば違反フィールド名の配列を返す(空配列=適合)。
 */
export function validateLanguageSettingIndependence(candidate: Record<string, unknown>): string[] {
  return LANGUAGE_SETTING_FORBIDDEN_FIELDS.filter((f) => f in candidate);
}

// ── V3-I18-17: 文化タグ + 国籍の内部データ限定使用 ─────────────────────────
// 国籍の代わりに行動傾向を表す「文化タグ」(複数選択可)をプロフィール/検索/文化差
// ガイドに用いる。
export interface CultureTag {
  id: string;
  label: string;
}
export type CultureTagSet = readonly CultureTag[];

// 国籍情報を内部データとして使ってよい用途(statement に列挙されたものだけ=閉じた
// リスト。この配列に無い用途で nationality を読むコードが増えたら、この定数を更新
// してから実装する運用にする=無制限な国籍参照の歯止め)。
export const NATIONALITY_INTERNAL_USE_CASES = [
  "translation", // 翻訳
  "customs", // 通関
  "shipping_fee", // 送料
  "language_detection", // 言語判定
  "gov35_same_country_grouping", // V3-GOV-35 違法出品ユーザー自治の同国内指摘グルーピング
  "regulatory_filtering", // 規制/合法性の国別フィルタリング
  "admin_intervention_scope", // 行政介入権のスコープ判定
] as const;
export type NationalityInternalUseCase = (typeof NATIONALITY_INTERNAL_USE_CASES)[number];

// 内部の完全なプロフィール(国籍を含みうる)。
export interface InternalProfile {
  actor_id: string;
  nationality?: string;
  culture_tags: CultureTagSet;
  show_flag?: boolean; // 任意ON(既定 false = 非表示)
}

// 外部公開ビュー(国籍フィールドを型として持たない — 誤って公開経路に紛れ込む
// ことを型で防ぐ。国旗は show_flag が true のときだけ含める)。
export interface PublicProfileView {
  actor_id: string;
  culture_tags: CultureTagSet;
  flag_visible: boolean;
}

/**
 * 内部プロフィールから外部公開ビューへ変換する。nationality は絶対に含めない
 * (statement「国籍情報は...内部データとしてのみ使用する」)。国旗表示は
 * show_flag(既定 false)でのみ有効になる(statement「国旗はデフォルト非表示・任意ON」)。
 */
export function toPublicProfileView(internal: InternalProfile): PublicProfileView {
  return {
    actor_id: internal.actor_id,
    culture_tags: internal.culture_tags,
    flag_visible: internal.show_flag === true,
  };
}
