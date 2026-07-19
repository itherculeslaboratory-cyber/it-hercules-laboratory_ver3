// GET /gov/disputes/mine — 「話し合いの場」私の相談一覧(全status・当事者スコープ)。
// projectMyDisputes は open/resolved 両方を返し、相手(counterparty)を添える。第三者は見えない。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

async function bearer(actorId: string) {
  return { Authorization: `Bearer ${await issueSessionToken(actorId, SESSION_SECRET)}`, "content-type": "application/json" };
}
function mine(env: object, headers: Record<string, string>) {
  return app.request("/api/v1/gov/disputes/mine", { headers }, env);
}
async function openDispute(env: object, openerH: Record<string, string>, respondentId: string, category = "market") {
  const res = await app.request(
    "/api/v1/gov/disputes",
    { method: "POST", headers: openerH, body: JSON.stringify({ category, respondent_id: respondentId }) },
    env,
  );
  return ((await res.json()) as { dispute_id: string }).dispute_id;
}

describe("GET /gov/disputes/mine", () => {
  it("未認証は 401", async () => {
    const env = makeEnv(new FakeR2Bucket());
    expect((await mine(env, { "content-type": "application/json" })).status).toBe(401);
  });

  it("当事者の相談を role/相手付きで返し、第三者には出さない", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const openerH = await bearer("opener1");
    await openDispute(env, openerH, "respondent1");

    const openerView = (await (await mine(env, openerH)).json()) as { disputes: Array<Record<string, unknown>> };
    expect(openerView.disputes).toHaveLength(1);
    expect(openerView.disputes[0].role).toBe("opener");
    expect(openerView.disputes[0].counterparty).toBe("respondent1");
    expect(openerView.disputes[0].status).toBe("open");
    expect(openerView.disputes[0].category).toBe("market");

    const respView = (await (await mine(env, await bearer("respondent1"))).json()) as { disputes: Array<Record<string, unknown>> };
    expect(respView.disputes).toHaveLength(1);
    expect(respView.disputes[0].role).toBe("respondent");
    expect(respView.disputes[0].counterparty).toBe("opener1");

    const strangerView = (await (await mine(env, await bearer("stranger1"))).json()) as { disputes: unknown[] };
    expect(strangerView.disputes).toHaveLength(0);
  });

  it("決着済み(resolved)も全status一覧に残る", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const openerH = await bearer("opener2");
    const id = await openDispute(env, openerH, "respondent2");
    const closeRes = await app.request(
      `/api/v1/gov/disputes/${id}/close`,
      { method: "POST", headers: openerH, body: JSON.stringify({ title: "決着", summary: "話し合いで解決した" }) },
      env,
    );
    expect(closeRes.status).toBe(201);
    const view = (await (await mine(env, openerH)).json()) as { disputes: Array<Record<string, unknown>> };
    expect(view.disputes).toHaveLength(1);
    expect(view.disputes[0].status).toBe("resolved");
  });
});
