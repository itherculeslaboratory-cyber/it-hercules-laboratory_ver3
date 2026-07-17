// GENERATED FILE — do not edit by hand.
// source: schemas/events/cite-ref.schema.json
// title: Citation reference (CiteRef shared type)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 構造化引用の共用型（CiteRef）。plaza-post の cite_refs[]・gov-dispute の subject_ref から相対 $ref で参照する単一正本（スキーマ複製禁止・V3-BBS-20）。envelope の data ではなく component schema なので created_at/schema_version は持たない。[ihl:cite type=X id=Y] トークンは従属で、cite_refs[] が正本。
 */
export interface CiteRef {
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
