// C4 §2 GMO sunabar 照合 TC (design-c4 §2 / CL-11 / V3-AUT-17).
// 依頼人名→U-XXXX 抽出の照合エッジ(前方一致・全角混在・コード不在)+ 照合ジョブ
// (突合→台帳append)+ 冪等(同一 itemKey 二重=put-if-absent 409)+ 本人スコープ投影 +
// live コネクタ throw + sunabar 生レスポンスの防御的パース。実 sunabar 疎通/擬似入金
// の実測は docs/planning/c4/sunabar-e2e-evidence.md(擬似入金=金銭=人間ゲート)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId, deriveTransferCode } from "@ihl/truth";
import {
  extractTransferCode,
  parseTransactions,
  makeGmoConnector,
  type DepositTransaction,
  type GmoConnector,
} from "../apps/api/src/gmo-connector";
import {
  reconcileOnce,
  projectReconciliation,
  EXPECTED_TYPE,
} from "../apps/api/src/gmo-routes";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}`, "content-type": "application/json" };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");
const CODE = await deriveTransferCode(DEV_ACTOR); // 本人の振込コード U-XXXX

// ASCII → 全角(照合エッジ「全角混在」の入力生成用)。
function toFullwidth(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c === 0x20) out += "　";
    else if (c >= 0x21 && c <= 0x7e) out += String.fromCodePoint(c + 0xfee0);
    else out += ch;
  }
  return out;
}

function fakeConnector(deposits: DepositTransaction[]): GmoConnector {
  return { mode: "fake", async listDepositTransactions() { return deposits; } };
}

function dep(itemKey: string, applicantName: string, amount = 1000): DepositTransaction {
  return { itemKey, applicantName, amount, transactionDate: "2026-07-11" };
}

// 期待入金を DEV_ACTOR で登録し bucket を返す(route も同時に検証)。
async function seedExpected(): Promise<FakeR2Bucket> {
  const bucket = new FakeR2Bucket();
  const res = await app.request(
    "/api/v1/gmo/expected-payment",
    { method: "POST", headers: AUTH, body: JSON.stringify({ amount: 1000 }) },
    makeEnv(bucket),
  );
  expect(res.status).toBe(201);
  expect((await res.json()).transfer_code).toBe(CODE);
  return bucket;
}

describe("依頼人名→振込コード抽出(design-c4 §2 照合エッジ)", () => {
  it("前方一致: コード単独/後続語つき", () => {
    expect(extractTransferCode(CODE)).toBe(CODE);
    expect(extractTransferCode(`${CODE} ﾃｽﾄ ｵｸﾘﾃﾞﾝ`)).toBe(CODE);
  });
  it("全角混在: Ｕ－… + 全角空白 → 半角畳み込みで一致", () => {
    expect(extractTransferCode(`${toFullwidth(CODE)}　ﾃｽﾄ`)).toBe(CODE);
  });
  it("コード不在: 依頼人名にコードなし → null", () => {
    expect(extractTransferCode("ﾔﾏﾀﾞ ﾀﾛｳ")).toBeNull();
    expect(extractTransferCode("")).toBeNull();
  });
  it("小文字は大文字化して許容(送金元の畳み込み耐性)", () => {
    expect(extractTransferCode(CODE.toLowerCase())).toBe(CODE);
  });
});

describe("GET /api/v1/gmo/transfer-code(本人・凍結 deriveTransferCode)", () => {
  it("認証なし → 401", async () => {
    const res = await app.request("/api/v1/gmo/transfer-code", {}, makeEnv());
    expect(res.status).toBe(401);
  });
  it("セッション principal の U-XXXX を返す", async () => {
    const res = await app.request("/api/v1/gmo/transfer-code", { headers: AUTH }, makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ transfer_code: CODE });
  });
});

describe("照合ジョブ reconcileOnce → 台帳 append(冪等)", () => {
  it("前方一致で一致 → 台帳 append・本人投影に残高反映", async () => {
    const bucket = await seedExpected();
    const s = new TruthStore(bucket);
    const r = await reconcileOnce(s, fakeConnector([dep("K1", `${CODE} ﾃｽﾄ`, 1500)]));
    expect(r).toMatchObject({ scanned: 1, matched: 1, duplicates: 0, unmatched: 0 });

    const meta = await projectReconciliation(s, DEV_ACTOR);
    expect(meta.matched_count).toBe(1);
    expect(meta.confirmed_total).toBe(1500); // 残高反映
    expect(meta.last_reconciled_at).not.toBeNull();
    expect(meta.confirmed_deposits[0]).toMatchObject({
      item_key: "K1",
      transfer_code: CODE,
      amount: 1500,
    });
  });

  it("同一 itemKey の二重照合は put-if-absent で拒否(冪等)", async () => {
    const bucket = await seedExpected();
    const s = new TruthStore(bucket);
    const c = fakeConnector([dep("K1", `${CODE} ﾃｽﾄ`, 1000)]);
    const first = await reconcileOnce(s, c);
    const second = await reconcileOnce(s, c); // 再 poll で同じ明細
    expect(first).toMatchObject({ matched: 1, duplicates: 0 });
    expect(second).toMatchObject({ matched: 0, duplicates: 1 });
    expect((await projectReconciliation(s, DEV_ACTOR)).matched_count).toBe(1); // 二重計上なし
  });

  it("全角混在の依頼人名でも一致", async () => {
    const bucket = await seedExpected();
    const s = new TruthStore(bucket);
    const r = await reconcileOnce(s, fakeConnector([dep("K2", `${toFullwidth(CODE)}　ﾃｽﾄ`, 800)]));
    expect(r.matched).toBe(1);
    expect((await projectReconciliation(s, DEV_ACTOR)).confirmed_total).toBe(800);
  });

  it("コード不在/未登録コードは未照合(append なし)", async () => {
    const bucket = await seedExpected();
    const s = new TruthStore(bucket);
    const r = await reconcileOnce(
      s,
      fakeConnector([dep("K3", "ﾔﾏﾀﾞ ﾀﾛｳ"), dep("K4", "U-ZZZZZ 未登録")]),
    );
    expect(r).toMatchObject({ scanned: 2, matched: 0, unmatched: 2 });
    expect((await projectReconciliation(s, DEV_ACTOR)).matched_count).toBe(0);
  });

  it("照合台帳は本人スコープ: 他人の入金は本人 meta に載らない", async () => {
    const bucket = await seedExpected();
    const s = new TruthStore(bucket);
    const other = await deriveActorId("attacker@ihl.local");
    // other の期待入金を直接 append(other のコードで)
    const otherCode = await deriveTransferCode(other);
    await s.putEvent({
      specversion: "1.0",
      id: (await import("@ihl/truth")).ulid(),
      source: "apps/api",
      type: EXPECTED_TYPE,
      time: new Date().toISOString(),
      provenance: { generator_kind: "human", actor_id: other },
      data: { actor_id: other, transfer_code: otherCode, amount: 500, schema_version: 1 },
    });
    await reconcileOnce(s, fakeConnector([dep("K5", `${otherCode} ﾀﾆﾝ`, 500)]));

    const mine = await projectReconciliation(s, DEV_ACTOR);
    expect(mine.matched_count).toBe(0);
    expect(mine.confirmed_total).toBe(0);
  });
});

describe("GET /api/v1/gmo/reconciliation/meta(本人投影)", () => {
  it("照合後、本人 meta に確認入金が反映される", async () => {
    const bucket = await seedExpected();
    await reconcileOnce(new TruthStore(bucket), fakeConnector([dep("K6", `${CODE} ﾃｽﾄ`, 2000)]));
    const res = await app.request("/api/v1/gmo/reconciliation/meta", { headers: AUTH }, makeEnv(bucket));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matched_count: number; confirmed_total: number };
    expect(body.matched_count).toBe(1);
    expect(body.confirmed_total).toBe(2000);
  });
});

describe("接続層分離(GMO_CONNECTOR_MODE)", () => {
  it("live は人間ゲートまで明示 throw", async () => {
    const c = makeGmoConnector({ GMO_CONNECTOR_MODE: "live" });
    expect(c.mode).toBe("live");
    await expect(c.listDepositTransactions()).rejects.toThrow(/live connector not implemented/);
  });
  it("sunabar は既定モード・token/accountId 欠如で throw(実 HTTP は張らない)", async () => {
    const c = makeGmoConnector({ GMO_CONNECTOR_MODE: "sunabar" });
    expect(c.mode).toBe("sunabar");
    await expect(c.listDepositTransactions()).rejects.toThrow(/missing GMO_SUNABAR_TOKEN1/);
  });
  it("未知モードは throw", () => {
    expect(() => makeGmoConnector({ GMO_CONNECTOR_MODE: "bogus" })).toThrow(/unknown GMO_CONNECTOR_MODE/);
  });
});

describe("sunabar 生レスポンスの防御的パース", () => {
  it("入金のみ抽出・出金は除外・itemKey/依頼人名を候補フィールドから拾う", () => {
    const raw = {
      transactions: [
        { itemKey: "100", transactionType: "1", amount: "1000", remitterName: `${CODE} ﾃｽﾄ`, transactionDate: "2026-07-11" },
        { itemKey: "101", transactionType: "2", amount: "500", remarks: "出金" }, // 出金→除外
        { transactionId: "102", amount: "300", remarks: `振込 ${CODE}` }, // itemKey欠→transactionId・依頼人名は remarks
      ],
    };
    const got = parseTransactions(raw);
    expect(got.map((d) => d.itemKey)).toEqual(["100", "102"]);
    expect(got[0]).toMatchObject({ applicantName: `${CODE} ﾃｽﾄ`, amount: 1000 });
    expect(extractTransferCode(got[1].applicantName)).toBe(CODE);
  });
  it("transactions 欠如/空は空配列", () => {
    expect(parseTransactions({})).toEqual([]);
    expect(parseTransactions({ transactions: [] })).toEqual([]);
    expect(parseTransactions(null)).toEqual([]);
  });
});
