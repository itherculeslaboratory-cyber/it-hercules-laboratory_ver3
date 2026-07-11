// GENERATED FILE — do not edit by hand.
// source: schemas/events/project.schema.json
// title: Research project (ihl.research.project.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 研究プロジェクト（PPR-16）。Truth キー truth/ihl.research.project.v1/<project_id>.json。Ver 分岐は parent_project_id を持つ新 project row で表現（別スキーマ不要・fork 文化）。hub/bestVersion は projectId 集約の都度再計算投影（常駐 DB 禁止）。
 */
export interface Project {
  /**
   * プロジェクトの一意キー（storage key の <project_id>）。
   */
  project_id: string;
  /**
   * オーナーの actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * プロジェクト名。
   */
  title: string;
  /**
   * 分岐元 project_id（Ver 分岐・任意）。
   */
  parent_project_id?: string;
  /**
   * 分岐元のバージョンラベル（任意）。
   */
  parent_version_label?: string;
  /**
   * ロット（{lot_id, qr_url}）。
   */
  lots?: {
    lot_id: string;
    qr_url?: string;
  }[];
  /**
   * 関連リンク（任意）。
   */
  links?: string[];
  /**
   * 貢献者 actor_id（任意）。
   */
  contributors?: string[];
  /**
   * 作成時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版（例: '1'）。
   */
  schema_version: string;
}
