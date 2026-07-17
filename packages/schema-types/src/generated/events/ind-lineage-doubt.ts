// GENERATED FILE — do not edit by hand.
// source: schemas/events/ind-lineage-doubt.schema.json
// title: Individual Lineage Doubt data (ihl.ind.lineage_doubt.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * V3-IND-21 の「取引出品文の血統説明に矛盾がないか照合して疑義を購入者が確認・記録できる文化」を持つ append-only の疑義記録。projectAuthenticity(継続性/血統矛盾チェック)には書き込み手段が無かった(読取専用)ため新設。削除・訂正は不可(不変条項③)——撤回は新しい action:'withdrawn' レコードの追記で表現する。Truth キー truth/ihl.ind.lineage_doubt.v1/<individual_id>-<ulid>.json。
 */
export interface IndLineageDoubt {
  /**
   * 疑義の一意キー（ULID）。withdrawn レコードは元の raised と同じ doubt_id を持つ新規追記(LWW投影で最新action採用・元レコードは残る)。
   */
  doubt_id: string;
  /**
   * 疑義の対象個体。
   */
  individual_id: string;
  /**
   * 疑義の元になった出品(任意・取引に紐づかない疑義もありうる)。
   */
  listing_id?: string;
  /**
   * 疑義の内容(自由記述・購入者の言葉)。
   */
  reason?: string;
  /**
   * raised=疑義を記録 / withdrawn=撤回(元レコードは残る・新規追記で表現・不変条項③)。
   */
  action: "raised" | "withdrawn";
  /**
   * 記録者(購入者)の actor_id（V3-AUT-17・セッション principal 強制）。
   */
  actor_id: string;
  /**
   * 記録時刻（RFC3339）。
   */
  created_at: string;
}
