// Truth バックアップ二重化(V3-CST-09・round-16 採番)。Truth 正本(R2)を別プロバイダ
// (Backblaze B2 等)へ複製するアダプタ。gmo-connector.ts/payjp-connector.ts と同じ
// 接続層分離パターン: MODE=dry-run(既定・実接続なし)/live(本番 — 人間ゲート: B2 契約+
// 実鍵投入+実接続まで明示 throw)。本ラン(実装レーン)のスコープは「アダプタ+設定手順書
// (docs/ops/runbook.md §7)+dry-run 検証」まで — 実 B2 API 呼び出しコードは書かない
// (実契約が無い状態でネットワーク呼び出しコードだけ先行させても検証できず、後日の
// 実装時に実 API 形状で書き直すほうが安全なため)。
import type { R2BucketLite } from "@ihl/truth";

export interface TruthBackupEnv {
  // dry-run(既定): 実ネットワーク呼び出しなしで「何をコピーするか」の計画だけを返す。
  // live: B2 契約+実鍵投入(人間ゲート)まで明示 throw。
  TRUTH_BACKUP_MODE?: string;
  TRUTH_BACKUP_B2_BUCKET?: string;
  TRUTH_BACKUP_B2_KEY_ID?: string;
  TRUTH_BACKUP_B2_APP_KEY?: string;
}

export interface BackupPlan {
  mode: string;
  total_keys: number;
  keys: string[];
}

// Thrown when TRUTH_BACKUP_MODE=live is requested. Real B2 sync is a human gate
// (B2 バケット/アプリケーションキーの契約作成+実鍵投入は AGENTS.md 人間ゲート5種)。
export class TruthBackupLiveNotImplementedError extends Error {
  constructor() {
    super(
      "TRUTH_BACKUP_LIVE_NOT_IMPLEMENTED — real B2 sync requires a human gate " +
        "(B2 bucket + application key contract + real key injection). " +
        "See docs/ops/runbook.md §7 for the setup procedure.",
    );
    this.name = "TruthBackupLiveNotImplementedError";
  }
}

/**
 * dry-run: list every Truth key and report the copy plan (no network call).
 * live: throw until the human gate (real B2 contract + keys) is cleared.
 */
export async function planTruthBackup(
  bucket: R2BucketLite,
  env: TruthBackupEnv,
): Promise<BackupPlan> {
  const mode = env.TRUTH_BACKUP_MODE ?? "dry-run";
  if (mode === "live") throw new TruthBackupLiveNotImplementedError();
  const { objects } = await bucket.list({ prefix: "truth/" });
  return { mode, total_keys: objects.length, keys: objects.map((o) => o.key) };
}

// ── V3-FND-08: データ所有権(エクスポート/インポート・復元ポイント) ──────────
// planTruthBackup が「Truth 全体を外部プロバイダへコピーする計画」なのに対し、
// 以下は「ユーザー自身のデータ範囲」と「復元ポイント(世界全体のキー一覧の
// スナップショット)」という別の切り口を同じ Truth 正本に対して提供する。
// ponytail: 対応形式は本ランで JSON のみ実装する(statement は CSV/画像/動画/音声/
// PDF も挙げるが、それらは JSON バンドルの上に乗るフォーマット変換層であり、各
// ドメインのバイナリ資産(photo/thumbnail 等)の扱いを個別に要る=follow-up と正直に
// 明記する。R2バケット全体の日次/週次「スケジュール」自体は cron 宣言=人間ゲートの
// 対象なので本モジュールはトリガーを持たず、作成関数のみを提供する。
import { TruthStore, ulid } from "@ihl/truth";

export const RESTORE_POINT_TYPE = "ihl.fnd.restore_point.v1";

export interface RestorePointRecord {
  restore_point_id: string;
  created_at: string;
  total_keys: number;
  keys: string[];
}

function agentProvenance() {
  return { generator_kind: "agent" as const, agent_name: "claude-code" };
}

/**
 * 現時点の Truth 全キーを1件の復元ポイントとして append する(データ所有権の
 * 「復元ポイントの作成」)。実際の復元(過去キー内容の再適用)は Truth が
 * INSERT ONLY のため別途の実装を要り、本ランのスコープ外(follow-up)。
 */
export async function createRestorePoint(s: TruthStore, now: Date, bucket: R2BucketLite): Promise<RestorePointRecord> {
  const { objects } = await bucket.list({ prefix: "truth/" });
  const id = ulid();
  const record: RestorePointRecord = {
    restore_point_id: id,
    created_at: now.toISOString(),
    total_keys: objects.length,
    keys: objects.map((o) => o.key),
  };
  await s.putEventAt(`truth/${RESTORE_POINT_TYPE}/${id}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: RESTORE_POINT_TYPE,
    time: now.toISOString(),
    provenance: agentProvenance(),
    data: record,
  });
  return record;
}

/** 復元ポイントの一覧(作成日時の昇順)。 */
export async function listRestorePoints(s: TruthStore): Promise<RestorePointRecord[]> {
  const events = await s.listEvents(`truth/${RESTORE_POINT_TYPE}/`);
  return events
    .map((e) => e.data as RestorePointRecord)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

// data.actor_id/owner_id/author_id/rater_id/ratee_id は既存イベント群(ledger-routes.ts
// karmaEnvelope の actor_id・plaza-post の author_id 等)で使われる代表的な所有者フィールド
// 名。ドメインごとの厳密なオーナーシップ定義は各艦の投影ロジックが正だが、この横断
// 抽出は「範囲選択して...エクスポート」の最小実装として実用十分(statement準拠・
// 完全性の保証はしない=誇張ゼロ)。
const OWNER_FIELD_NAMES = ["actor_id", "owner_id", "author_id"] as const;

export interface ActorExportBundle {
  actor_id: string;
  exported_at: string;
  format: "json";
  event_count: number;
  events: Record<string, unknown>[];
}

/**
 * ユーザー自身のデータを範囲選択してエクスポートする(V3-FND-08「自分のデータを
 * 範囲選択して...エクスポートでき...データ所有権を保証する」の JSON 実装)。
 * Truth 全体を prefix="truth/" で走査し、既知のオーナーフィールドが actorId と
 * 一致するイベントだけを JSON バンドルとして返す。画像/動画/音声/PDF 形式は
 * follow-up(バイナリ資産の個別ドメイン知識が要るため。本ランでは実装しない)。
 * CSV は下の exportActorDataAsCsv で第3波にて追加した(w3-fnd)。
 */
export async function exportActorData(s: TruthStore, actorId: string, now: Date): Promise<ActorExportBundle> {
  const all = await s.listEvents("truth/");
  const mine = all.filter((e) => {
    const data = (e.data ?? {}) as Record<string, unknown>;
    return OWNER_FIELD_NAMES.some((f) => data[f] === actorId);
  });
  return { actor_id: actorId, exported_at: now.toISOString(), format: "json", event_count: mine.length, events: mine };
}

// ── V3-FND-08 follow-up(w3-fnd 第3波): CSV 形式 ────────────────────────
// w1/w2 の note が明記した「多形式は follow-up」のうち、バイナリ資産を伴わない
// CSV だけを本ランで実装する(画像/動画/音声/PDF はドメイン別バイナリ変換層が要る
// ため引き続き follow-up・誇張ゼロで正直に持ち越す)。新規依存は追加していない
// (V3-FND-28 凍結遵守。手書きの最小 CSV エスケープのみ)。
function csvEscape(value: unknown): string {
  const s = value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * exportActorData と同じ抽出条件で、type/time/data を1行1イベントの CSV 文字列
 * として返す(ヘッダ行: id,type,time,data)。data は JSON 文字列としてそのまま1列に
 * 格納する(ネストしたイベント形状ごとに列を可変にしないための最小実装)。
 */
export async function exportActorDataAsCsv(s: TruthStore, actorId: string, now: Date): Promise<string> {
  const bundle = await exportActorData(s, actorId, now);
  const header = "id,type,time,data";
  const rows = bundle.events.map((e) => {
    const row = e as Record<string, unknown>;
    return [csvEscape(row.id), csvEscape(row.type), csvEscape(row.time), csvEscape(row.data)].join(",");
  });
  return [header, ...rows].join("\n");
}
