// V3-BBS-06/08 — 指摘(通報ではない)ボタン。二者間 room(書込=当事者限定・閲覧=公開)。
// 合意なし1ヶ月で強制クローズ、未解決クローズ5の倍数でカルマ-1、指摘30回ごとにPT-1。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import {
  plazaDisputeRoutes,
  reduceDisputeStatus,
  countUnresolvedCloses,
  maybeApplyUnresolvedClosePenalty,
} from "../apps/api/src/plaza-dispute-routes";
import { plazaRoutes } from "../apps/api/src/plaza-routes";
import { projectLedger } from "../apps/api/src/ledger-routes";
import { FakeR2Bucket, makeEnv } from "./helpers";

function appAs(actorId: string) {
  const app = new Hono<{ Bindings: ReturnType<typeof makeEnv>; Variables: { actorId: string } }>();
  app.use("*", async (c, next) => {
    c.set("actorId", c.req.header("x-actor") || actorId);
    await next();
  });
  app.route("/api/v1", plazaRoutes);
  app.route("/api/v1", plazaDisputeRoutes);
  return app;
}

describe("V3-BBS-06 open a dispute (指摘)", () => {
  it("requires tag and reason (通報との差別化)", async () => {
    const env = makeEnv();
    const app = appAs("alice");
    const post = (await (await app.request("/api/v1/plaza/posts", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "c", board_kind: "guide", topic: "t", body: "本文" }),
    }, env)).json()) as { post_id: string };

    const noTag = await app.request("/api/v1/plaza/disputes", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target_id: post.post_id, reason: "違う" }),
    }, env);
    expect(noTag.status).toBe(400);

    const noReason = await app.request("/api/v1/plaza/disputes", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target_id: post.post_id, tag: "factual" }),
    }, env);
    expect(noReason.status).toBe(400);
  });

  it("cannot dispute one's own post, opens a two-party room otherwise", async () => {
    const env = makeEnv();
    const app = appAs("bob");
    const post = (await (await app.request("/api/v1/plaza/posts", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "c", board_kind: "guide", topic: "t", body: "本文" }),
    }, env)).json()) as { post_id: string };

    const own = await app.request("/api/v1/plaza/disputes", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target_id: post.post_id, tag: "factual", reason: "x" }),
    }, env);
    expect(own.status).toBe(400);

    const carol = new Hono<{ Bindings: ReturnType<typeof makeEnv>; Variables: { actorId: string } }>();
    carol.use("*", async (c, next) => { c.set("actorId", "carol"); await next(); });
    carol.route("/api/v1", plazaDisputeRoutes);
    const opened = await carol.request("/api/v1/plaza/disputes", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target_id: post.post_id, tag: "factual", reason: "違うと思う" }),
    }, env);
    expect(opened.status).toBe(201);
    const { dispute_id } = (await opened.json()) as { dispute_id: string };

    const view = await (await carol.request(`/api/v1/plaza/disputes/${dispute_id}`, {}, env)).json() as { initiator_id: string; respondent_id: string; status: string };
    expect(view.initiator_id).toBe("carol");
    expect(view.respondent_id).toBe("bob");
    expect(view.status).toBe("open");
  });

  it("only the two parties may post messages; others get 403", async () => {
    const env = makeEnv();
    const owner = appAs("owner");
    const post = (await (await owner.request("/api/v1/plaza/posts", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "c", board_kind: "guide", topic: "t", body: "本文" }),
    }, env)).json()) as { post_id: string };
    const disputant = appAs("disputant");
    const opened = (await (await disputant.request("/api/v1/plaza/disputes", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target_id: post.post_id, tag: "factual", reason: "違う" }),
    }, env)).json()) as { dispute_id: string };

    const outsider = appAs("outsider");
    const blocked = await outsider.request(`/api/v1/plaza/disputes/${opened.dispute_id}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "message", body: "hi" }),
    }, env);
    expect(blocked.status).toBe(403);

    const allowed = await owner.request(`/api/v1/plaza/disputes/${opened.dispute_id}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "correction_proposal", body: "修正案" }),
    }, env);
    expect(allowed.status).toBe(201);
  });
});

describe("V3-BBS-08 resolution status + karma/PT accounting", () => {
  it("reduceDisputeStatus: open -> force_closed after TTL with no accept message", () => {
    const dispute = { dispute_id: "d1", initiator_id: "a", respondent_id: "b", target_type: "post" as const, target_id: "p1", tag: "x", reason: "y", created_at: "2026-01-01T00:00:00.000Z" };
    const now31d = new Date("2026-02-01T00:00:00.000Z");
    expect(reduceDisputeStatus(dispute, [], now31d)).toBe("force_closed");
    const now10d = new Date("2026-01-11T00:00:00.000Z");
    expect(reduceDisputeStatus(dispute, [], now10d)).toBe("open");
  });

  it("reduceDisputeStatus: resolved_agreed when an accept message exists (even past TTL)", () => {
    const dispute = { dispute_id: "d1", initiator_id: "a", respondent_id: "b", target_type: "post" as const, target_id: "p1", tag: "x", reason: "y", created_at: "2026-01-01T00:00:00.000Z" };
    const messages = [{ message_id: "m1", dispute_id: "d1", actor_id: "a", kind: "accept" as const, created_at: "2026-01-05T00:00:00.000Z" }];
    expect(reduceDisputeStatus(dispute, messages, new Date("2026-03-01T00:00:00.000Z"))).toBe("resolved_agreed");
  });

  it("maybeApplyUnresolvedClosePenalty fires only at multiples of 5 and applies karma -1", async () => {
    const bucket = new FakeR2Bucket();
    const env = { TRUTH: bucket };
    const s = new TruthStore(bucket);
    for (const n of [1, 2, 3, 4]) {
      expect(await maybeApplyUnresolvedClosePenalty(s, "victim", n)).toBe(false);
    }
    expect(await maybeApplyUnresolvedClosePenalty(s, "victim", 5)).toBe(true);
    const ledger = await projectLedger(s, "victim");
    expect(ledger.karma_value).toBe(-1);
    void env;
  });

  it("countUnresolvedCloses counts force_closed disputes where actor is respondent", async () => {
    const env = makeEnv();
    const owner = appAs("respondent1");
    const post = (await (await owner.request("/api/v1/plaza/posts", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "c", board_kind: "guide", topic: "t", body: "本文" }),
    }, env)).json()) as { post_id: string };
    const disputant = appAs("initiator1");
    const opened = (await (await disputant.request("/api/v1/plaza/disputes", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target_id: post.post_id, tag: "factual", reason: "違う" }),
    }, env)).json()) as { dispute_id: string };

    const s = new TruthStore(env.TRUTH);
    const farFuture = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
    const count = await countUnresolvedCloses(s, "respondent1", farFuture);
    expect(count).toBe(1);
    void opened;
  });
});
