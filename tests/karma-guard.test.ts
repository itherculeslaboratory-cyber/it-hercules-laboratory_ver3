// KRM-06 カルマ value 正増加ガード TC（design-k3 §4・§2 MOD）。カルマ value の正増加は
// 月次救済（reason 'monthly_batch'）だけ許す。貢献付与・その他経路は value を上げられず、
// 貢献は contribution/coin 台帳へ落ちる。count 層・value 減算は素通し。
import { describe, expect, it } from "vitest";
import { TruthStore, deriveActorId, ulid } from "@ihl/truth";
import { appendKarma, projectLedger } from "../apps/api/src/ledger-routes";
import {
  CONTRIBUTION_TYPE,
  applyContributionDelta,
  projectContribution,
} from "../apps/api/src/contribution";
import { FakeR2Bucket } from "./helpers";

const ACTOR = await deriveActorId("dev@ihl.local");

describe("KRM-06 appendKarma value 正増加ガード", () => {
  it("value 正増加は reason 'monthly_batch' 以外で throw", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await expect(appendKarma(s, ACTOR, "value", 5, "manual")).rejects.toThrow();
    await expect(appendKarma(s, ACTOR, "value", 5, "dispute")).rejects.toThrow();
    await expect(appendKarma(s, ACTOR, "value", 1, "other")).rejects.toThrow();
  });

  it("value 正増加は reason 'monthly_batch' なら許可（救済経路）", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await appendKarma(s, ACTOR, "value", 5, "monthly_batch");
    expect((await projectLedger(s, ACTOR)).karma_value).toBe(5);
  });

  it("value 減算・count 層は reason を問わず素通し", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await appendKarma(s, ACTOR, "value", -5, "dispute"); // 減点は許可
    await appendKarma(s, ACTOR, "count", 1, "dispute"); // count は許可
    await appendKarma(s, ACTOR, "count", -1, "other"); // 免罪符相当の count -1
    const p = await projectLedger(s, ACTOR);
    expect(p.karma_value).toBe(-5);
    expect(p.karma_count).toBe(0);
  });
});

describe("KRM-06 貢献付与はカルマ value でなく貢献台帳へ落ちる", () => {
  it("貢献 delta はカルマ value を動かさず貢献スコアに載る", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const id = ulid();
    await s.putEvent({
      specversion: "1.0",
      id,
      source: "apps/api",
      type: CONTRIBUTION_TYPE,
      time: "2026-07-11T00:00:00Z",
      dataschema: "schemas/events/economy-contribution-event.schema.json",
      provenance: { generator_kind: "human", actor_id: ACTOR },
      data: {
        contribution_event_id: id,
        node_id: "node-1",
        actor_id: ACTOR,
        axis: "research",
        delta: 100,
        source: "manual",
        created_at: "2026-07-11T00:00:00Z",
        schema_version: "1",
      },
    });
    // カルマ value は 0 のまま（貢献はカルマ value を押し上げない）。
    expect((await projectLedger(s, ACTOR)).karma_value).toBe(0);
    // 貢献は貢献台帳側に反映。
    expect((await projectContribution(s, ACTOR)).axes.research.score).toBe(100);
  });

  it("純関数 applyContributionDelta もカルマに触れない（貢献スコアのみ更新）", () => {
    const scores = applyContributionDelta({}, "node-1", "development", 50);
    expect(scores["node-1"].development).toBe(50);
  });
});
