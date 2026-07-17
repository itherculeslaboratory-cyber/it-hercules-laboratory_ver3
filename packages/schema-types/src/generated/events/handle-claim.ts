// GENERATED FILE — do not edit by hand.
// source: schemas/events/handle-claim.schema.json
// title: Handle claim data (ihl.aut.handle.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * @ユーザーID（handle）確定イベント。Truth キー truth/ihl.aut.handle.v1/<handle>.json に put-if-absent（V3-AUT-08: 3〜30文字・限定文字種・一意・不変=HANDLE_IMMUTABLE）。本人が明示タップで確定し、OS は自動生成しない。確定は一意性の権威的担保（CL-01 同型・storage 層 put-if-absent 409）で、常駐 handle→user index は持たない。
 */
export interface HandleClaim {
  /**
   * 確定した @ID 本体（限定文字種・3〜30文字）。この文字列自体が Truth キーの一部＝一意性の実体。
   */
  handle: string;
  /**
   * 確定した本人の actor_id（セッション principal 強制刻印・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 確定時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
