// V3-GOV-11: ホームは司法インボックスのプレビュー(最大5件)と環境IoT due予定
// (最大3件)を表示し、審理・投票本体は司法FeatureNode(/gov/disputes/*)へ委譲する。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
const authOf = async (actor: string) => bearer(await issueSessionToken(actor, SESSION_SECRET));
function post(env: object, headers: Record<string, string>, path: string, body: unknown = {}) {
  return app.request(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function get(env: object, headers: Record<string, string>, path: string) {
  return app.request(`/api/v1${path}`, { headers }, env);
}

describe("V3-GOV-11 GET /home/summary judicial_inbox preview", () => {
  it("includes open disputes where the actor is opener or respondent, and excludes closed ones", async () => {
    const env = makeEnv();
    const meH = await authOf("gov11-me");
    const otherH = await authOf("gov11-other");

    // dispute 1: I am the opener, still open.
    const d1 = ((await (await post(env, meH, "/gov/disputes", { category: "market", respondent_id: "gov11-r1" })).json()) as { dispute_id: string }).dispute_id;
    // dispute 2: I am the respondent, still open.
    const d2 = ((await (await post(env, otherH, "/gov/disputes", { category: "board", respondent_id: "gov11-me" })).json()) as { dispute_id: string }).dispute_id;
    // dispute 3: I am the opener, but it's closed -> must be excluded.
    const d3 = ((await (await post(env, meH, "/gov/disputes", { category: "bugfix", respondent_id: "gov11-r3" })).json()) as { dispute_id: string }).dispute_id;
    await post(env, meH, `/gov/disputes/${d3}/close`, { title: "t", summary: "s" });
    // dispute 4: I'm not involved at all -> must be excluded.
    await post(env, otherH, "/gov/disputes", { category: "market", respondent_id: "gov11-r4" });

    const summary = (await (await get(env, meH, "/home/summary")).json()) as {
      judicial_inbox: { dispute_id: string; role: string }[];
      iot_due: unknown[];
    };
    const ids = summary.judicial_inbox.map((j) => j.dispute_id);
    expect(ids).toContain(d1);
    expect(ids).toContain(d2);
    expect(ids).not.toContain(d3);
    expect(summary.judicial_inbox.find((j) => j.dispute_id === d1)?.role).toBe("opener");
    expect(summary.judicial_inbox.find((j) => j.dispute_id === d2)?.role).toBe("respondent");
  });

  it("caps judicial_inbox at 5 even with more open disputes", async () => {
    const env = makeEnv();
    const meH = await authOf("gov11-many");
    for (let i = 0; i < 7; i++) {
      await post(env, meH, "/gov/disputes", { category: "market", respondent_id: `gov11-many-r${i}` });
    }
    const summary = (await (await get(env, meH, "/home/summary")).json()) as { judicial_inbox: unknown[] };
    expect(summary.judicial_inbox.length).toBeLessThanOrEqual(5);
  });

  it("a third party with zero disputes gets an empty judicial_inbox", async () => {
    const env = makeEnv();
    const h = await authOf("gov11-nobody");
    const summary = (await (await get(env, h, "/home/summary")).json()) as { judicial_inbox: unknown[] };
    expect(summary.judicial_inbox).toEqual([]);
  });

  it("iot_due is capped at 3 and derived from the existing overdue/near observation schedule", async () => {
    const env = makeEnv();
    const h = await authOf("gov11-iot");
    for (let i = 0; i < 5; i++) {
      // T-71 GAP① A-1: /observation/schedule now requires the caller to own
      // individual_id — create a real one (same actor) instead of a bare literal.
      const indRes = await post(env, h, "/individuals", {});
      const individualId = ((await indRes.json()) as { individual_id: string }).individual_id;
      await post(env, h, "/observation/schedule", { individual_id: individualId, stage: "first_to_second", from: "2000-01-01T00:00:00Z" }); // far past -> overdue
    }
    const summary = (await (await get(env, h, "/home/summary")).json()) as { iot_due: unknown[]; overdue: unknown[] };
    expect(summary.overdue.length).toBe(5); // underlying projection unaffected
    expect(summary.iot_due.length).toBe(3); // preview capped
  });
});
