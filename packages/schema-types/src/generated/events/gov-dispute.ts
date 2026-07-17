// GENERATED FILE — do not edit by hand.
// source: schemas/events/gov-dispute.schema.json
// title: Governance dispute data (ihl.gov.dispute.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 二人部屋の紛争イベント ihl.gov.dispute.v1 の data 部（GOV-01）。action=open/message/close の追記列。Truth キー truth/ihl.gov.dispute.v1/<dispute_id>/<event_id>.json に append-only。projectDispute が participants={opener,respondent} を確定し状態遷移を都度投影。close なしで now>opened_at+DISPUTE_TTL_DAYS なら expired。subject_ref は CiteRef 単一正本を相対 $ref で参照。不服申立 route は無い。
 */
export interface GovDispute {
  /**
   * 紛争の一意キー（ULID）。
   */
  dispute_id: string;
  /**
   * この event を起こした actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * アクション種別（開始 / 発言 / 決着 / V3-GOV-07 公開して投票開始 / V3-GOV-07 投票判定確定）。
   */
  action: "open" | "message" | "close" | "publicize" | "vote_resolve";
  /**
   * 紛争カテゴリ（open 時必須・route 側で検証・任意）。
   */
  category?: "market" | "board" | "bugfix";
  /**
   * 相手方 actor_id（open 時必須・route 側で検証・任意）。
   */
  respondent_id?: string;
  subject_ref?: CitationReferenceCiteRefSharedType;
  /**
   * 発言本文（message 時・任意）。
   */
  body?: string;
  /**
   * 決着種別（close 時・resolved=合意 / force_closed=期限切れ強制・任意）。
   */
  resolution?: "resolved" | "force_closed";
  /**
   * 発言者の locale（V3-I18-06: UGC 原文タグ。message 時に actor の pref-set locale から刻印・翻訳しない・任意）。
   */
  lang?: string;
  /**
   * V3-GOV-07: publicize 時に opener(dispute を開いた actor)の市場取引ロールを宣言する（respondent は自動的にもう一方）。プラチナ投票の二択(売り手が正しい/買い手が正しい)の勝敗から敗者(loser)の actor_id を特定するために必須（publicize 時のみ・任意）。
   */
  opener_role?: "seller" | "buyer";
  /**
   * V3-GOV-07: vote_resolve 時の勝者側（seller=売り手が正しい / buyer=買い手が正しい）。同数(引き分け)は本フィールドを省略する（任意）。
   */
  value?: "seller" | "buyer";
  /**
   * event 時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
/**
 * 構造化引用の共用型（CiteRef）。plaza-post の cite_refs[]・gov-dispute の subject_ref から相対 $ref で参照する単一正本（スキーマ複製禁止・V3-BBS-20）。envelope の data ではなく component schema なので created_at/schema_version は持たない。[ihl:cite type=X id=Y] トークンは従属で、cite_refs[] が正本。
 */
export interface CitationReferenceCiteRefSharedType {
  /**
   * 引用先の種別（安定 URL 生成 citeUrl の分岐キー）。
   */
  type:
    | "observation"
    | "individual"
    | "paper"
    | "thread"
    | "post"
    | "user"
    | "tag"
    | "listing"
    | "precedent"
    | "fork"
    | "url"
    | "book";
  /**
   * 引用先の一意キー（type ごとの ID 空間）。
   */
  id: string;
  /**
   * 表示ラベル（任意・UGC 原文まま・翻訳しない）。
   */
  label?: string;
  /**
   * post 種別引用のアンカー post_id（任意・permalink フラグメント用）。
   */
  post_id?: string;
}
