// GENERATED FILE — do not edit by hand.
// source: schemas/events/task-node.schema.json
// title: Research task node (ihl.research.task_node.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * limitations/next_questions/data_gap/失敗クラスタ/愚痴クラスタ由来の研究課題ノード（PPR-17）。Truth キー truth/ihl.research.task_node.v1/<task_id>.json（task_id=決定論 sha1(source_kind|source_ref|normalized_question)→同一入力で同一ノード・冪等 put-if-absent。envelope.id は別途 ulid()）。program は program_id で束ねる別 task_node。taskTree は都度再計算投影。
 */
export interface TaskNode {
  /**
   * 決定論キー（storage key と一致・route が算出）。
   */
  task_id: string;
  /**
   * 課題（問い）。
   */
  question: string;
  /**
   * 生成源。
   */
  source_kind: "limitation" | "next_question" | "data_gap" | "failure_cluster" | "complaint_cluster";
  /**
   * 生成源イベント／対象の参照。
   */
  source_ref: string;
  /**
   * 難易度。
   */
  difficulty: "beginner" | "intermediate" | "researcher";
  /**
   * 優先度（0–100・ヒューリスティック算出）。
   */
  priority: number;
  /**
   * 束ねる program の task_id（任意）。
   */
  program_id?: string;
  /**
   * 生成時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版（例: '1'）。
   */
  schema_version: string;
}
