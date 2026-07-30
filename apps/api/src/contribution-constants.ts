// V3-KRM-14 直接貢献/間接貢献の重みテーブル(計画§10・係数分離)。ファイル名は住所帳の
// `contribution*` glob に一致(w1-gov書いてよい場所)。テーブルの数値は一次資料
// (beta/keep-b27.json A3ノート contribution_rules.json)から直接採用。
//
// ★正直な部分実装(w2-gov): この重みテーブルと lookup 関数のみを提供する。実際の
// 付与呼び出し箇所(論文投稿=w1-ind の paper-match-routes.ts、生体登録=w1-ind の
// individual-routes.ts)は本艦の書いてよい場所の外のため配線していない。呼び出し側は
// contributionWeightFor(kind) を呼んで appendContribution(..., delta, source) の
// delta に渡せばよい(既存 appendContribution はどの axis/delta も受け付ける汎用実装)。
export type DirectContributionKind = "paper" | "specimen";
export type IndirectContributionKind = "specimen_searched";

export const DIRECT_CONTRIBUTION_WEIGHTS: Record<DirectContributionKind, number> = {
  paper: 50,
  specimen: 20,
};

export const INDIRECT_CONTRIBUTION_WEIGHTS: Record<IndirectContributionKind, number> = {
  specimen_searched: 1,
};

export function contributionWeightFor(
  kind: DirectContributionKind | IndirectContributionKind,
  direct: boolean,
): number {
  if (direct) {
    return DIRECT_CONTRIBUTION_WEIGHTS[kind as DirectContributionKind] ?? 0;
  }
  return INDIRECT_CONTRIBUTION_WEIGHTS[kind as IndirectContributionKind] ?? 0;
}
