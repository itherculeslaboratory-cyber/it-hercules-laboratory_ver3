// KRM-24 改善案/仮説 状態機械 TC（design-k3 §4）。fork で rank=beginner 自動・rank
// 昇格遷移・hypothesis が信頼度 trust=支持/(支持+否定) で supported/rejected へ収束・
// 低支持アーカイブ。全て append-only（reduceProposal 投影で都度再計算）。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore } from "@ihl/truth";
import { reduceProposal } from "../apps/api/src/proposal-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

async function create(bucket: FakeR2Bucket, proposalId: string): Promise<void> {
  const res = await app.request(
    "/api/v1/proposals",
    { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ proposal_id: proposalId }) },
    makeEnv(bucket),
  );
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
}
async function transition(bucket: FakeR2Bucket, id: string, body: Record<string, unknown>): Promise<Response> {
  return app.request(
    `/api/v1/proposals/${id}/transition`,
    { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) },
    makeEnv(bucket),
  );
}

describe("KRM-24 create + fork", () => {
  it("create は rank=minor / state=draft から開始", async () => {
    const bucket = new FakeR2Bucket();
    await create(bucket, "PR-1");
    const p = await reduceProposal(new TruthStore(bucket), "PR-1");
    expect(p).toMatchObject({ rank: "minor", state: "draft" });
  });

  it("fork は rank=beginner 自動・forked_from 連結", async () => {
    const bucket = new FakeR2Bucket();
    await create(bucket, "PR-2");
    const res = await app.request(
      "/api/v1/proposals/PR-2/fork",
      { method: "POST", headers: AUTH_HEADERS, body: "{}" },
      makeEnv(bucket),
    );
    expect(res.status).toBe(201);
    const forked = (await res.json()) as { proposal_id: string; rank: string };
    expect(forked.rank).toBe("beginner");
    // 元イベントに forked_from が記録されている。
    const forkEv = [...bucket.objects.values()]
      .map((o) => JSON.parse(o.body as string))
      .find((e) => e.data.kind === "fork");
    expect(forkEv.data.forked_from).toBe("PR-2");
  });
});

describe("KRM-24 rank 昇格遷移", () => {
  it("rank_change で popular へ昇格", async () => {
    const bucket = new FakeR2Bucket();
    await create(bucket, "PR-3");
    const res = await transition(bucket, "PR-3", { kind: "rank_change", rank: "popular" });
    expect(res.status).toBe(200);
    expect((await reduceProposal(new TruthStore(bucket), "PR-3")).rank).toBe("popular");
  });

  it("kind 不正は 400", async () => {
    const bucket = new FakeR2Bucket();
    await create(bucket, "PR-3b");
    expect((await transition(bucket, "PR-3b", { kind: "bogus" })).status).toBe(400);
  });

  it("official への rank_change クライアント直指定は 403（プラチナ投票閾値経路のみ・KRM-25）", async () => {
    const bucket = new FakeR2Bucket();
    await create(bucket, "PR-4");
    const res = await transition(bucket, "PR-4", { kind: "rank_change", rank: "official" });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "RANK_GATED" });
    // rank は昇格せず minor のまま（イベントが append されていない）。
    expect((await reduceProposal(new TruthStore(bucket), "PR-4")).rank).toBe("minor");
  });

  it("recommended への rank_change クライアント直指定も 403", async () => {
    const bucket = new FakeR2Bucket();
    await create(bucket, "PR-5");
    expect((await transition(bucket, "PR-5", { kind: "rank_change", rank: "recommended" })).status).toBe(403);
  });
});

describe("KRM-24 hypothesis 収束（trust=支持/(支持+否定)）", () => {
  it("hypothesis + 高信頼（3 支持）→ supported", async () => {
    const bucket = new FakeR2Bucket();
    await create(bucket, "H1");
    await transition(bucket, "H1", { kind: "hypothesis_transition", state: "hypothesis" });
    for (let i = 0; i < 3; i++) await transition(bucket, "H1", { kind: "support" });
    const p = await reduceProposal(new TruthStore(bucket), "H1");
    expect(p.trust).toBe(1);
    expect(p.state).toBe("supported");
    expect(p.archived).toBe(false);
  });

  it("hypothesis + 低支持（3 否定）→ rejected（低支持アーカイブ）", async () => {
    const bucket = new FakeR2Bucket();
    await create(bucket, "H2");
    await transition(bucket, "H2", { kind: "hypothesis_transition", state: "hypothesis" });
    for (let i = 0; i < 3; i++) await transition(bucket, "H2", { kind: "reject" });
    const p = await reduceProposal(new TruthStore(bucket), "H2");
    expect(p.trust).toBe(0);
    expect(p.state).toBe("rejected");
    expect(p.archived).toBe(true);
  });

  it("中間信頼（2 支持 2 否定・trust=0.5）は hypothesis 継続", async () => {
    const bucket = new FakeR2Bucket();
    await create(bucket, "H3");
    await transition(bucket, "H3", { kind: "hypothesis_transition", state: "hypothesis" });
    await transition(bucket, "H3", { kind: "support" });
    await transition(bucket, "H3", { kind: "support" });
    await transition(bucket, "H3", { kind: "reject" });
    await transition(bucket, "H3", { kind: "reject" });
    const p = await reduceProposal(new TruthStore(bucket), "H3");
    expect(p.trust).toBe(0.5);
    expect(p.state).toBe("hypothesis"); // 0.4 < 0.5 < 0.6 → 継続
  });

  it("投票が MIN 未満（draft のまま）は収束しない", async () => {
    const bucket = new FakeR2Bucket();
    await create(bucket, "H4");
    await transition(bucket, "H4", { kind: "support" }); // hypothesis 未遷移
    const p = await reduceProposal(new TruthStore(bucket), "H4");
    expect(p.state).toBe("draft"); // hypothesis に入っていないので収束対象外
  });
});
