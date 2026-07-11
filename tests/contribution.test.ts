// KRM-10/11/12 3 軸貢献度エンジン TC（非 cron 部分・design-k3 §4）。
// KRM-10: 非負累積・減算拒否・概念別台帳（PT 非公開・軸独立）。
// KRM-11: 子Δ→祖先 10% 配分・累計 100 で issueCoin1+端数繰越・称号 10000。
// KRM-12: 各軸 100→1PT・2 枚目以降 fib(n)*100・累計残高非減衰。
// 月次還元（KRM-11 rebate）/ 月次 Fib 降下（KRM-12）は cron=P6 に分離（本 TC 対象外）。
import { describe, expect, it } from "vitest";
import { TruthStore, deriveActorId, ulid } from "@ihl/truth";
import {
  AXES,
  CONTRIBUTION_TYPE,
  PT_TYPE,
  type Axis,
  applyContributionDelta,
  mintFromScore,
  projectContribution,
  projectPt,
} from "../apps/api/src/contribution";
import { FakeR2Bucket } from "./helpers";

const ISO = "2026-07-11T00:00:00Z";
const ACTOR = await deriveActorId("dev@ihl.local");

function contribEnvelope(actorId: string, axis: Axis, delta: number, nodeId = "node-1") {
  const id = ulid();
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: CONTRIBUTION_TYPE,
    time: ISO,
    dataschema: "schemas/events/economy-contribution-event.schema.json",
    provenance: { generator_kind: "human", actor_id: actorId },
    data: {
      contribution_event_id: id,
      node_id: nodeId,
      actor_id: actorId,
      axis,
      delta,
      source: "manual",
      created_at: ISO,
      schema_version: "1",
    },
  };
}

function ptEnvelope(actorId: string, delta: number, reason = "mint") {
  const id = ulid();
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: PT_TYPE,
    time: ISO,
    dataschema: "schemas/events/economy-pt-event.schema.json",
    provenance: { generator_kind: "human", actor_id: actorId },
    data: {
      pt_event_id: id,
      actor_id: actorId,
      delta,
      reason_code: reason,
      created_at: ISO,
      schema_version: "1",
    },
  };
}

describe("KRM-12 鋳造導出 mintFromScore（増分 Fibonacci 閾値）", () => {
  it("次閾値列は 100,100,200,300,500（PER_PLATINUM*fib(minted+1)）", () => {
    // score をちょうど各鋳造直後に置き、次閾値を観測。
    expect(mintFromScore(0).next_threshold).toBe(100); // minted0 → fib(1)*100
    expect(mintFromScore(100).next_threshold).toBe(100); // minted1 → fib(2)*100
    expect(mintFromScore(200).next_threshold).toBe(200); // minted2 → fib(3)*100
    expect(mintFromScore(400).next_threshold).toBe(300); // minted3 → fib(4)*100
    expect(mintFromScore(700).next_threshold).toBe(500); // minted4 → fib(5)*100
  });

  it("各軸 100→1PT・2 枚目 200・3 枚目 400 累計で鋳造", () => {
    expect(mintFromScore(99).minted).toBe(0);
    expect(mintFromScore(100).minted).toBe(1); // 1 枚目
    expect(mintFromScore(200).minted).toBe(2); // 2 枚目（+100）
    expect(mintFromScore(400).minted).toBe(3); // 3 枚目（+200）
    expect(mintFromScore(700).minted).toBe(4); // 4 枚目（+300）
    expect(mintFromScore(1200).minted).toBe(5); // 5 枚目（+500）
  });

  it("累計 100 で issueCoin1 + 端数繰越（carry = score - 消費累計・非減衰）", () => {
    expect(mintFromScore(150)).toEqual({ minted: 1, next_threshold: 100, carry: 50 });
    expect(mintFromScore(250)).toEqual({ minted: 2, next_threshold: 200, carry: 50 });
  });
});

describe("KRM-11 依存グラフ配分 applyContributionDelta（純関数 reducer）", () => {
  it("子Δ→祖先 10% 配分（祖先 2 で 5/5・子は 90）", () => {
    const scores = applyContributionDelta({}, "child", "research", 100, ["anc1", "anc2"]);
    expect(scores.child.research).toBe(90);
    expect(scores.anc1.research).toBe(5);
    expect(scores.anc2.research).toBe(5);
    // 保存: 総和は元の delta のまま。
    expect(scores.child.research + scores.anc1.research + scores.anc2.research).toBe(100);
  });

  it("祖先無しは子に全額残す（配分ゼロ）", () => {
    const scores = applyContributionDelta({}, "child", "development", 100, []);
    expect(scores.child.development).toBe(100);
  });

  it("減算（delta<0）は非負累積 invariant 違反で throw", () => {
    expect(() => applyContributionDelta({}, "child", "capital", -1)).toThrow();
  });
});

describe("KRM-10 3 軸貢献度投影 projectContribution", () => {
  it("軸別に非負累積し minted/next_threshold/carry/title を導出", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await s.putEvent(contribEnvelope(ACTOR, "research", 120));
    await s.putEvent(contribEnvelope(ACTOR, "research", 30)); // research 累計 150
    await s.putEvent(contribEnvelope(ACTOR, "capital", 100)); // capital 累計 100

    const p = await projectContribution(s, ACTOR);
    expect(p.axes.research).toEqual({ score: 150, minted: 1, next_threshold: 100, carry: 50, title: false });
    expect(p.axes.capital).toEqual({ score: 100, minted: 1, next_threshold: 100, carry: 0, title: false });
    expect(p.axes.development.score).toBe(0); // 軸独立（未加算軸は 0）
  });

  it("称号は score ≥ 10000 で投影導出（イベント不要）", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await s.putEvent(contribEnvelope(ACTOR, "research", 10000));
    const p = await projectContribution(s, ACTOR);
    expect(p.axes.research.title).toBe(true);
    expect(p.axes.capital.title).toBe(false);
  });

  it("減算イベントは append 側（schema minimum:0）で拒否", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const res = await s.putEvent(contribEnvelope(ACTOR, "research", -5));
    expect(res.status).toBe("invalid");
  });

  it("本人スコープ: 他人の貢献は投影に載らない", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const other = await deriveActorId("other@ihl.local");
    await s.putEvent(contribEnvelope(other, "research", 500));
    const p = await projectContribution(s, ACTOR);
    for (const axis of AXES) expect(p.axes[axis].score).toBe(0);
  });
});

describe("KRM-10 概念別台帳の独立（PT 非公開・軸非影響）", () => {
  it("PT 残高は pt_event delta 合計・本人スコープ（他人分は 0）", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await s.putEvent(ptEnvelope(ACTOR, 100));
    await s.putEvent(ptEnvelope(ACTOR, -30, "indulgence_spend"));
    const other = await deriveActorId("other@ihl.local");
    await s.putEvent(ptEnvelope(other, 999));

    expect((await projectPt(s, ACTOR)).balance).toBe(70);
    expect((await projectPt(s, other)).balance).toBe(999);
  });

  it("PT 台帳と貢献台帳は互いに非影響", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await s.putEvent(ptEnvelope(ACTOR, 500));
    // PT を積んでも貢献スコアは 0 のまま（別台帳）。
    const p = await projectContribution(s, ACTOR);
    for (const axis of AXES) expect(p.axes[axis].score).toBe(0);
    // 貢献を積んでも PT 残高は不変。
    await s.putEvent(contribEnvelope(ACTOR, "research", 100));
    expect((await projectPt(s, ACTOR)).balance).toBe(500);
  });
});
