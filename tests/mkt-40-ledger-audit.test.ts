// V3-MKT-40: 市場台帳(ledger)の複式簿記検算バッチ。貸方(ihl.economy.coin_event.v1・
// grantPlatinum)と借方(ihl.social.platinum_vote.v1・投票消費)を都度再計算し、残高非負を
// 確認する。route 経由の通常フローでは常に balanced=true(route 自身が残高不足を 409 で
// 拒否する)ことと、Truth へ直接不正な借方を仕込んだ場合に検知できることの両方を確認する。
import { describe, expect, it } from "vitest";
import { TruthStore, deriveActorId, ulid } from "@ihl/truth";
import app from "../apps/api/src/index";
import { grantPlatinum } from "../apps/api/src/ledger-routes";
import { auditLedger } from "../apps/api/src/ledger-audit-routes";
import { VOTE_TYPE } from "../apps/api/src/social-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const DEV_ACTOR = await deriveActorId("dev@ihl.local");

describe("GET /api/v1/ledger/audit", () => {
  it("認証なし → 401", async () => {
    const res = await app.request("/api/v1/ledger/audit", {}, makeEnv());
    expect(res.status).toBe(401);
  });

  it("通常フロー(付与→投票消費)は balanced=true", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await grantPlatinum(s, DEV_ACTOR, 10, "manual");

    const res = await app.request(
      "/api/v1/social/platinum-votes",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ target_id: "proposal-1", coins: 3 }) },
      makeEnv(bucket),
    );
    expect(res.status).toBe(201);

    const report = await auditLedger(s);
    expect(report.balanced).toBe(true);
    expect(report.negative_balance_actors).toEqual([]);
    expect(report.duplicate_event_ids).toEqual([]);
    expect(report.accounts_checked).toBeGreaterThanOrEqual(1);
  });

  it("残高不足の投票は route 側 409 で拒否される(台帳が破綻しない)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await grantPlatinum(s, DEV_ACTOR, 2, "manual");
    const res = await app.request(
      "/api/v1/social/platinum-votes",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ target_id: "proposal-1", coins: 5 }) },
      makeEnv(bucket),
    );
    expect(res.status).toBe(409);
    const report = await auditLedger(s);
    expect(report.balanced).toBe(true);
  });

  it("Truth へ直接残高超過の借方を仕込むと negative_balance_actors で検知する(route を経由しない不正データの発見)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await grantPlatinum(s, DEV_ACTOR, 5, "manual");
    // route の残高ガードを迂回して直接 Truth へ過剰な投票イベントを put(想定外の破損状態を模擬)。
    const voteId = ulid();
    await s.putEvent({
      specversion: "1.0",
      id: voteId,
      source: "test",
      type: VOTE_TYPE,
      time: new Date().toISOString(),
      dataschema: "schemas/events/social-platinum-vote.schema.json",
      provenance: { generator_kind: "human", actor_id: DEV_ACTOR },
      data: {
        vote_id: voteId,
        target_id: "proposal-x",
        voter_id: DEV_ACTOR,
        coins: 999,
        created_at: new Date().toISOString(),
        schema_version: "1",
      },
    });

    const report = await auditLedger(s);
    expect(report.balanced).toBe(false);
    expect(report.negative_balance_actors).toEqual([
      expect.objectContaining({ actor_id: DEV_ACTOR, granted: 5, spent: 999, balance: 5 - 999 }),
    ]);
  });
});
