// MKT-12 GMO 義務 FIFO 消込。同一 code 同額の複数 pending を due_date 昇順に整列し、
// 入金を義務発生日以降で最古の未払いへ消込(振込日 = transactionDate)。残りは pending。
// itemKey put-if-absent で二重消込を防ぐ(冪等)。
import { describe, expect, it } from "vitest";
import { TruthStore, deriveActorId, deriveTransferCode, ulid } from "@ihl/truth";
import {
  reconcileOnce,
  projectObligations,
  OBLIGATION_TYPE,
} from "../apps/api/src/gmo-routes";
import type { DepositTransaction, GmoConnector } from "../apps/api/src/gmo-connector";
import { FakeR2Bucket } from "./helpers";

const DEV_ACTOR = await deriveActorId("dev@ihl.local");
const CODE = await deriveTransferCode(DEV_ACTOR);

function fakeConnector(deposits: DepositTransaction[]): GmoConnector {
  return { mode: "fake", async listDepositTransactions() { return deposits; } };
}

async function seedObligation(s: TruthStore, amount: number, dueDate: string): Promise<string> {
  const id = ulid();
  const res = await s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: OBLIGATION_TYPE,
    time: new Date().toISOString(),
    dataschema: "schemas/events/gmo-obligation.schema.json",
    provenance: { generator_kind: "agent", agent_name: "test" },
    data: {
      obligation_id: id,
      actor_id: DEV_ACTOR,
      transfer_code: CODE,
      amount,
      obligation_kind: "fee_tax",
      due_date: dueDate,
      created_at: new Date().toISOString(),
      schema_version: "1",
    },
  });
  if (res.status !== "inserted") throw new Error(`seed obligation failed: ${res.status}`);
  return id;
}

describe("MKT-12 義務 FIFO 消込", () => {
  it("3 件 同一 code 同額 due_date 昇順 + 入金 1 件 → 最古未払いへ消込・残 2 件 pending", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const o1 = await seedObligation(s, 800, "2026-07-01T00:00:00Z");
    const o2 = await seedObligation(s, 800, "2026-07-05T00:00:00Z");
    const o3 = await seedObligation(s, 800, "2026-07-10T00:00:00Z");

    const r = await reconcileOnce(
      s,
      fakeConnector([{ itemKey: "K1", applicantName: `${CODE} ﾃｽﾄ`, amount: 800, transactionDate: "2026-07-11" }]),
    );
    expect(r).toMatchObject({ scanned: 1, matched: 1, unmatched: 0 });

    const status = await projectObligations(s, CODE);
    expect(status.map((o) => o.obligation_id)).toEqual([o1, o2, o3]); // due_date 昇順
    expect(status.map((o) => o.paid)).toEqual([true, false, false]); // 最古のみ消込
  });

  it("同一入金の再 poll は二重消込しない(冪等)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await seedObligation(s, 800, "2026-07-01T00:00:00Z");
    await seedObligation(s, 800, "2026-07-05T00:00:00Z");
    const c = fakeConnector([{ itemKey: "K1", applicantName: `${CODE} ﾃｽﾄ`, amount: 800, transactionDate: "2026-07-11" }]);
    const first = await reconcileOnce(s, c);
    const second = await reconcileOnce(s, c);
    expect(first).toMatchObject({ matched: 1, duplicates: 0 });
    expect(second).toMatchObject({ matched: 0, duplicates: 1 });
    expect((await projectObligations(s, CODE)).filter((o) => o.paid).length).toBe(1); // 二重消込なし
  });

  it("2 入金 → FIFO で古い順に 2 件消込", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const o1 = await seedObligation(s, 800, "2026-07-01T00:00:00Z");
    const o2 = await seedObligation(s, 800, "2026-07-05T00:00:00Z");
    const o3 = await seedObligation(s, 800, "2026-07-10T00:00:00Z");
    await reconcileOnce(s, fakeConnector([
      { itemKey: "K1", applicantName: `${CODE} A`, amount: 800, transactionDate: "2026-07-11" },
      { itemKey: "K2", applicantName: `${CODE} B`, amount: 800, transactionDate: "2026-07-12" },
    ]));
    const paid = (await projectObligations(s, CODE)).filter((o) => o.paid).map((o) => o.obligation_id);
    expect(paid).toEqual([o1, o2]); // 古い 2 件、o3 は pending
  });

  it("義務発生日より前の入金は消込対象外(matched だが obligation_ref なし・全件 pending)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await seedObligation(s, 800, "2026-07-05T00:00:00Z");
    const r = await reconcileOnce(
      s,
      fakeConnector([{ itemKey: "K1", applicantName: `${CODE} X`, amount: 800, transactionDate: "2026-06-30" }]),
    );
    expect(r.matched).toBe(1); // 義務 code で actor 解決 → 台帳 append はされる
    expect((await projectObligations(s, CODE)).every((o) => !o.paid)).toBe(true); // まだ未払い
  });
});
