// C5 K2 V3-SEC-06: 8% 積立投影 TC (design-c5-k2 §1.2/§1.5/§3).
// projectReconciliation の返り値に accrued_total = round(confirmed_total * 0.08) が
// 都度再計算で載ることを担保(端数丸め含む)。既存 gmo-reconcile.test.ts は台帳 append
// を担保(不変)。ここは投影の派生値だけを検証する。
import { describe, expect, it } from "vitest";
import { TruthStore, deriveActorId, deriveTransferCode, ulid } from "@ihl/truth";
import { reconcileOnce, projectReconciliation, EXPECTED_TYPE } from "../apps/api/src/gmo-routes";
import { SETTLEMENT_ACCRUAL_RATE } from "../apps/api/src/economy-constants";
import type { DepositTransaction, GmoConnector } from "../apps/api/src/gmo-connector";
import { FakeR2Bucket } from "./helpers";

const DEV_ACTOR = await deriveActorId("dev@ihl.local");
const CODE = await deriveTransferCode(DEV_ACTOR);

function fakeConnector(deposits: DepositTransaction[]): GmoConnector {
  return { mode: "fake", async listDepositTransactions() { return deposits; } };
}
function dep(itemKey: string, amount: number): DepositTransaction {
  return { itemKey, applicantName: `${CODE} test`, amount, transactionDate: "2026-07-11" };
}

// DEV_ACTOR の期待入金を直接 append(route を介さず投影だけ検証)。
async function seed(bucket: FakeR2Bucket) {
  const s = new TruthStore(bucket);
  await s.putEvent({
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: EXPECTED_TYPE,
    time: new Date().toISOString(),
    provenance: { generator_kind: "human", actor_id: DEV_ACTOR },
    data: { actor_id: DEV_ACTOR, transfer_code: CODE, amount: null, schema_version: 1 },
  });
  return s;
}

describe("V3-SEC-06 8% accrual projection (projectReconciliation.accrued_total)", () => {
  it("rate constant is 0.08", () => {
    expect(SETTLEMENT_ACCRUAL_RATE).toBe(0.08);
  });

  it("exact multiple: 1500 -> 120", async () => {
    const bucket = new FakeR2Bucket();
    const s = await seed(bucket);
    await reconcileOnce(s, fakeConnector([dep("A1", 1500)]));
    const meta = await projectReconciliation(s, DEV_ACTOR);
    expect(meta.confirmed_total).toBe(1500);
    expect(meta.accrued_total).toBe(120);
    expect(meta.accrued_total).toBe(Math.round(1500 * SETTLEMENT_ACCRUAL_RATE));
  });

  it("rounds fractional accrual: 1234 * 0.08 = 98.72 -> 99", async () => {
    const bucket = new FakeR2Bucket();
    const s = await seed(bucket);
    await reconcileOnce(s, fakeConnector([dep("A2", 1234)]));
    const meta = await projectReconciliation(s, DEV_ACTOR);
    expect(meta.confirmed_total).toBe(1234);
    expect(meta.accrued_total).toBe(99);
  });

  it("sums deposits before accruing: 1234 + 6 = 1240 -> round(99.2) = 99", async () => {
    const bucket = new FakeR2Bucket();
    const s = await seed(bucket);
    await reconcileOnce(s, fakeConnector([dep("A3", 1234), dep("A4", 6)]));
    const meta = await projectReconciliation(s, DEV_ACTOR);
    expect(meta.confirmed_total).toBe(1240);
    expect(meta.accrued_total).toBe(99);
  });

  it("no deposits -> accrued_total 0", async () => {
    const bucket = new FakeR2Bucket();
    const s = await seed(bucket);
    const meta = await projectReconciliation(s, DEV_ACTOR);
    expect(meta.confirmed_total).toBe(0);
    expect(meta.accrued_total).toBe(0);
  });
});
