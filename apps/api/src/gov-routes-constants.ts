// GOV/KRM 係数分離ファイル(計画§10・値をロジックへ埋め込まない)。gov-routes.ts の新規
// 実装(w2-gov: V3-GOV-06/08, V3-KRM-09)専用の閾値・テーブルを持つ。plaza-constants.ts
// (w1-plaza所有glob)は編集対象外のため、新規係数はこのファイルへ集約する
// (ファイル名は住所帳の `gov-routes*` glob に一致=w1-gov書いてよい場所)。

// V3-GOV-06: 争いは「合意しなければ1ヶ月で強制クローズ」(GOV-01の TTL_DAYS=14 は
// projectDispute の表示用 expired フラグのみが目的の別の値であり、GOV-06 が要求する
// 実際の強制クローズアクションの日数とは独立の定数として持つ)。
export const GOV06_FORCE_CLOSE_DAYS = 30;

// V3-KRM-09: 未解決強制クローズをユーザーごとに累計し、5・10・15…回目到達時のみ
// Δcount+1(倍数以外はΔcountなし)。
export const KRM09_MILESTONE_STEP = 5;
export const KRM09_MILESTONE_KARMA_STEPS = 1;

// V3-KRM-09: ゾンビ攻撃対策。30指摘ごとにプラチナコイン1枚を消費(クールダウンなし)。
export const KRM09_ZOMBIE_DISPUTE_THRESHOLD = 30;
export const KRM09_ZOMBIE_PT_COST = 1;

// V3-GOV-08: 指摘は3段階(公開Q&A→支払前→支払後)で段階変化するΔcount
// (要件原文「公開Q&A→支払前+1→支払後+5」を直接数値化。公開Q&A段階=0)。
export const GOV08_STAGE_KARMA_STEPS: Record<"public_qa" | "pre_payment" | "post_payment", number> = {
  public_qa: 0,
  pre_payment: 1,
  post_payment: 5,
};

// V3-GOV-08: カテゴリ別Δcount。要件原文に明示された対応のみを採用する
// (Y11=法令違反→+10・Y09=支払後→+5は sources 引用の実測値。Y01-Y15全15項目の
// 個別マッピングは一次資料に無く、ここで推測して埋めない=全艦共通規律「穴埋め禁止」。
// 未知カテゴリは default=1(最小の抑止力)に倒す)。
export const GOV08_CATEGORY_KARMA_STEPS: Record<string, number> = {
  Y11: 10, // 法令違反(行政指示時不使用フラグ)
  Y09: 5, // 支払後に発覚
};
export const GOV08_DEFAULT_CATEGORY_KARMA_STEPS = 1;
