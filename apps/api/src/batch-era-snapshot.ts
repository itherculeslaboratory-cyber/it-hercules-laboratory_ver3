// V3-FND-07: 文明全体の状態を Era Snapshot として R2(Truth)へ保存し、任意時点への
// 巻き戻し(復元)を可能にする。テンプレ・ロジック設定・種族・形態を丸ごと保存し、
// 呼び出し側が渡した config オブジェクトをそのまま append する(何を「文明全体の状態」
// として集める投影ロジックは各ドメイン艦の管轄 — このモジュールは Truth への
// append/一覧/復元という保存基盤のみを持つ)。
//
// ponytail: 「定期(四半期等)」の実行トリガー自体(cron 宣言)は本ランのスコープ外
// — batch.ts の runMonthlyBatch と同じく cron 宣言=常駐トークン消費の enabling で
// あり、デプロイ(人間ゲート)側の判断。ここでは createEraSnapshot を呼べば
// いつでも1件のEra Snapshotを作れる関数を用意し、実際の四半期スケジューリングは
// 後続(handleScheduled への追加 or 別cron)に委ねる。
import { TruthStore, ulid } from "@ihl/truth";

export const ERA_SNAPSHOT_TYPE = "ihl.fnd.era_snapshot.v1";

// 「テンプレ・ロジック・設定・種族・形態を丸ごと保存」— 呼び出し側が集めた任意の
// JSON シリアライズ可能な文明状態。中身の形は本モジュールの関心事ではない
// (unknown で受け取り、そのまま保存・そのまま返す=不可知の投影)。
export interface EraSnapshotConfig {
  [domain: string]: unknown;
}

export interface EraSnapshotRecord {
  era_snapshot_id: string;
  created_at: string;
  config: EraSnapshotConfig;
}

function agentProvenance() {
  return { generator_kind: "agent" as const, agent_name: "claude-code" };
}

/** Era Snapshot を1件 append する(INSERT ONLY — Truth 本体と同じ不可侵の履歴保持)。 */
export async function createEraSnapshot(
  s: TruthStore,
  now: Date,
  config: EraSnapshotConfig,
): Promise<EraSnapshotRecord> {
  const id = ulid();
  const record: EraSnapshotRecord = { era_snapshot_id: id, created_at: now.toISOString(), config };
  await s.putEventAt(`truth/${ERA_SNAPSHOT_TYPE}/${id}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: ERA_SNAPSHOT_TYPE,
    time: now.toISOString(),
    provenance: agentProvenance(),
    data: record,
  });
  return record;
}

/** 全 Era Snapshot を作成日時の昇順で一覧する(タイムラインとしても機能する=statement準拠)。 */
export async function listEraSnapshots(s: TruthStore): Promise<EraSnapshotRecord[]> {
  const events = await s.listEvents(`truth/${ERA_SNAPSHOT_TYPE}/`);
  return events
    .map((e) => e.data as EraSnapshotRecord)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

/**
 * 任意時点(era_snapshot_id)への巻き戻し=その時点の config をそのまま返す。
 * Recompute(config から全体状態を再構築する処理)は各ドメインの投影ロジックの
 * 責務であり、本関数は「巻き戻し先の config を取り出す」until はここまで。
 * 存在しない ID には null を返す(呼び出し側が 404 に変換する)。
 */
export async function restoreEraSnapshot(
  s: TruthStore,
  eraSnapshotId: string,
): Promise<EraSnapshotConfig | null> {
  const record = await s.readEvent(`truth/${ERA_SNAPSHOT_TYPE}/${eraSnapshotId}.json`);
  if (!record) return null;
  return (record.data as EraSnapshotRecord).config;
}
