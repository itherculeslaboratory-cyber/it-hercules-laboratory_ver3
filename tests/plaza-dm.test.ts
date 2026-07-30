// V3-BBS-19 — DM/メッセージ機能(スレッド一覧+バブル表示・送信時lastMessageAt自動更新)。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { plazaDmRoutes } from "../apps/api/src/plaza-dm-routes";
import { makeEnv } from "./helpers";

function appAs(actorId: string) {
  const app = new Hono<{ Bindings: ReturnType<typeof makeEnv>; Variables: { actorId: string } }>();
  app.use("*", async (c, next) => { c.set("actorId", actorId); await next(); });
  app.route("/api/v1", plazaDmRoutes);
  return app;
}
function post(app: Hono, path: string, body: Record<string, unknown>, env: unknown) {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
}

describe("V3-BBS-19 DM threads", () => {
  it("creates a thread including the creator + given participants", async () => {
    const env = makeEnv();
    const alice = appAs("alice");
    const res = await post(alice, "/api/v1/plaza/dm/threads", { participants: ["bob"], context_type: "trade" }, env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { participants: string[]; context_type: string };
    expect(body.participants.sort()).toEqual(["alice", "bob"]);
    expect(body.context_type).toBe("trade");
  });

  it("rejects a thread with no other participant", async () => {
    const env = makeEnv();
    const alice = appAs("alice");
    const res = await post(alice, "/api/v1/plaza/dm/threads", { participants: [] }, env);
    expect(res.status).toBe(400);
  });

  it("lists threads for a participant sorted by last_message_at desc, and updates it on send", async () => {
    const env = makeEnv();
    const alice = appAs("alice");
    const bob = appAs("bob");
    const t = (await (await post(alice, "/api/v1/plaza/dm/threads", { participants: ["bob"] }, env)).json()) as { thread_id: string };

    const sendRes = await post(alice, `/api/v1/plaza/dm/threads/${t.thread_id}/messages`, { body: "hello" }, env);
    expect(sendRes.status).toBe(201);

    const list = (await (await bob.request("/api/v1/plaza/dm/threads", {}, env)).json()) as {
      threads: { thread_id: string; last_message_at: string; message_count: number }[];
    };
    const found = list.threads.find((x) => x.thread_id === t.thread_id);
    expect(found).toBeTruthy();
    expect(found!.message_count).toBe(1);
  });

  it("forbids non-participants from reading or sending", async () => {
    const env = makeEnv();
    const alice = appAs("alice");
    const outsider = appAs("mallory");
    const t = (await (await post(alice, "/api/v1/plaza/dm/threads", { participants: ["bob"] }, env)).json()) as { thread_id: string };

    const readRes = await outsider.request(`/api/v1/plaza/dm/threads/${t.thread_id}/messages`, {}, env);
    expect(readRes.status).toBe(403);
    const sendRes = await post(outsider, `/api/v1/plaza/dm/threads/${t.thread_id}/messages`, { body: "hi" }, env);
    expect(sendRes.status).toBe(403);
  });

  it("bubble display returns messages in stable order", async () => {
    const env = makeEnv();
    const alice = appAs("alice");
    const t = (await (await post(alice, "/api/v1/plaza/dm/threads", { participants: ["bob"] }, env)).json()) as { thread_id: string };
    await post(alice, `/api/v1/plaza/dm/threads/${t.thread_id}/messages`, { body: "first" }, env);
    await post(alice, `/api/v1/plaza/dm/threads/${t.thread_id}/messages`, { body: "second" }, env);
    const msgs = (await (await alice.request(`/api/v1/plaza/dm/threads/${t.thread_id}/messages`, {}, env)).json()) as {
      messages: { body: string }[];
    };
    expect(msgs.messages.map((m) => m.body)).toEqual(["first", "second"]);
  });
});
