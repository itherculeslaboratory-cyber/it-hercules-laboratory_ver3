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
