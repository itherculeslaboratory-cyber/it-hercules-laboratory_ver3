// C5 K4 UI テンプレ TC(design-k4 §3 / V3-UIX-45/17)。POST /builder/canvas で UI-as-node
// を append / fork→parent_template_id 系譜 / like・platinum 投票(POST /events 再利用)で
// projectTemplateVotes 加算 / 同一(actor,target,kind)二重投票後も likes/platinum が 1
// (投影 dedup 冪等・409 を期待しない＝批評家修正2)/ 閾値到達で adoption_candidate=true。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import app from "../apps/api/src/index";
import { projectTemplateVotes } from "../apps/api/src/theme-routes";
import { ADOPTION_PLATINUM_THRESHOLD } from "../apps/api/src/ui-constants";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
const authOf = async (actor: string) => bearer(await issueSessionToken(actor, SESSION_SECRET));

const postCanvas = (env: object, h: Record<string, string>, body: unknown) =>
  app.request("/api/v1/builder/canvas", { method: "POST", headers: h, body: JSON.stringify(body) }, env);

// 投票は新 route を作らず既存 POST /events(ihl.ui.vote.v1)へ投げる(matrix 57 行凍結)。
function voteEnvelope(actor: string, targetId: string, kind: "like" | "platinum") {
  const id = ulid();
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: "ihl.ui.vote.v1",
    time: new Date().toISOString(),
    dataschema: "schemas/events/ui-vote.schema.json",
    provenance: { generator_kind: "human", actor_id: actor },
    data: {
      vote_id: id,
      actor_id: actor,
      target_kind: "template",
      target_id: targetId,
      vote_kind: kind,
      created_at: new Date().toISOString(),
      schema_version: "1",
    },
  };
}
const postVote = (env: object, h: Record<string, string>, body: unknown) =>
  app.request("/events", { method: "POST", headers: h, body: JSON.stringify(body) }, env);

describe("UIX-45/17 UI テンプレ 保存/fork", () => {
  it("POST /builder/canvas で UI-as-node を append する", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const id = ulid();
    const r = await postCanvas(env, await authOf("author"), {
      template_id: id,
      name: "My Layout",
      level: "custom",
      social: { author_name: "Author" },
    });
    expect(r.status).toBe(201);
    expect(((await r.json()) as { template_id: string }).template_id).toBe(id);
  });

  it("fork は parent_template_id を持って系譜連結する", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const h = await authOf("author");
    const parentId = ulid();
    const childId = ulid();
    await postCanvas(env, h, { template_id: parentId, name: "Parent", level: "recommended", social: {} });
    expect((await postCanvas(env, h, { template_id: childId, name: "Child", level: "custom", parent_template_id: parentId, social: {} })).status).toBe(201);

    // 系譜(parent_template_id)が Truth に永続していること。
    const child = await new TruthStore(bucket).readEvent(`truth/ihl.ui.template.v1/${childId}.json`);
    expect(((child?.data as Record<string, unknown>).parent_template_id)).toBe(parentId);
  });
});

describe("UIX-45 投票集計(投影 dedup 冪等・批評家修正2)", () => {
  it("like/platinum 投票が projectTemplateVotes に加算される", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const target = ulid();
    await postVote(env, await authOf("v1"), voteEnvelope("v1", target, "like"));
    await postVote(env, await authOf("v2"), voteEnvelope("v2", target, "like"));
    await postVote(env, await authOf("v1"), voteEnvelope("v1", target, "platinum"));

    const agg = await projectTemplateVotes(new TruthStore(bucket), target);
    expect(agg.likes).toBe(2);
    expect(agg.platinum).toBe(1);
  });

  it("同一(actor,target,kind)の二重投票後も 1 票(409 を期待しない)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const target = ulid();
    const h = await authOf("v1");
    // 別 ULID の別イベントとして 2 回投票(いずれも 201・storage 409 は構造的に起きない)。
    expect((await postVote(env, h, voteEnvelope("v1", target, "like"))).status).toBe(201);
    expect((await postVote(env, h, voteEnvelope("v1", target, "like"))).status).toBe(201);

    const agg = await projectTemplateVotes(new TruthStore(bucket), target);
    expect(agg.likes).toBe(1); // 投影 dedup で 1 に畳む
    expect(agg.platinum).toBe(0);
  });

  it("platinum 票が閾値到達で adoption_candidate=true", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const target = ulid();
    for (let i = 0; i < ADOPTION_PLATINUM_THRESHOLD; i++) {
      const actor = `p${i}`;
      await postVote(env, await authOf(actor), voteEnvelope(actor, target, "platinum"));
    }
    const agg = await projectTemplateVotes(new TruthStore(bucket), target);
    expect(agg.platinum).toBe(ADOPTION_PLATINUM_THRESHOLD);
    expect(agg.adoption_candidate).toBe(true);
  });
});
