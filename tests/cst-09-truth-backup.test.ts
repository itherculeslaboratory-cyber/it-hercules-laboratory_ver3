// V3-CST-09 — Truth バックアップ二重化アダプタの dry-run 検証。実 B2 接続(live)は
// 人間ゲート(B2契約+実鍵投入)まで明示 throw する。dry-run は実ネットワーク呼び出し
// なしで Truth の現在キー一覧を「コピー計画」として返す(この関数自体が実装の全体 —
// 実接続コードは書かない、というスコープの機械的な裏付け)。
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import { FakeR2Bucket, makeEnvelope } from "./helpers";
import {
  planTruthBackup,
  TruthBackupLiveNotImplementedError,
} from "../apps/api/src/truth-backup-connector";

describe("V3-CST-09 planTruthBackup", () => {
  it("dry-run (default, no MODE set) lists Truth keys with zero network calls", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await s.putEvent(makeEnvelope({ type: "ihl.test.sample.v1" }));
    await s.putEvent(makeEnvelope({ type: "ihl.test.sample.v1" }));

    const plan = await planTruthBackup(bucket, {});
    expect(plan.mode).toBe("dry-run");
    expect(plan.total_keys).toBe(2);
    expect(plan.keys.every((k) => k.startsWith("truth/"))).toBe(true);
  });

  it("dry-run on an empty Truth store reports zero keys (not an error)", async () => {
    const bucket = new FakeR2Bucket();
    const plan = await planTruthBackup(bucket, { TRUTH_BACKUP_MODE: "dry-run" });
    expect(plan).toEqual({ mode: "dry-run", total_keys: 0, keys: [] });
  });

  it("live mode throws TruthBackupLiveNotImplementedError (human gate: real B2 contract + keys)", async () => {
    const bucket = new FakeR2Bucket();
    await expect(
      planTruthBackup(bucket, {
        TRUTH_BACKUP_MODE: "live",
        TRUTH_BACKUP_B2_BUCKET: "ihl-truth-backup",
        TRUTH_BACKUP_B2_KEY_ID: "some-key-id",
        TRUTH_BACKUP_B2_APP_KEY: "some-app-key",
      }),
    ).rejects.toBeInstanceOf(TruthBackupLiveNotImplementedError);
  });
});
