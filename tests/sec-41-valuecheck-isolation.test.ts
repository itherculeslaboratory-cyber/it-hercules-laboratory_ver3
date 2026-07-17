// V3-SEC-41: ValueCheck/好みセッション(ihl.match.preference.v1・kind=valuecheck 等)は
// 本人 JWT スコープの検索ブーストのみに使い、他ユーザーへ漏らさない。match-routes.ts は
// 既にこの契約を満たしている(GET /match/ranking は常に c.get("actorId") のみを読み、
// 他 actor の preference/ranking を返す route が無い・score も strip 済み=match.test.ts
// で回帰済み)。本ファイルはクロスアクター分離(actor B が actor A の学習結果を一切
// 観測できないこと)を追加で固定する回帰テスト。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

async function bearer(actorId: string) {
  return { Authorization: `Bearer ${await issueSessionToken(actorId, SESSION_SECRET)}`, "content-type": "application/json" };
}

describe("V3-SEC-41 ValueCheck cross-actor isolation", () => {
  it("actor B's ranking never reflects actor A's preference events (own-JWT scope only)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const aH = await bearer("actor-a");
    const bH = await bearer("actor-b");

    // actor A strongly prefers item "A" (valuecheck kind).
    await app.request(
      "/api/v1/match/preference",
      { method: "POST", headers: aH, body: JSON.stringify({ item_id: "A", kind: "valuecheck", y: 1, features: [1, 0] }) },
      env,
    );

    // actor B has NOT weighed in on anything yet.
    const bRanking = (await (await app.request("/api/v1/match/ranking", { headers: bH }, env)).json()) as {
      actor_id: string;
      ranking: unknown[];
    };
    expect(bRanking.actor_id).toBe("actor-b");
    expect(bRanking.ranking).toEqual([]); // A's candidate pool/weights do not leak into B's ranking

    // actor B votes on a different item; A's ranking must not see B's item.
    await app.request(
      "/api/v1/match/preference",
      { method: "POST", headers: bH, body: JSON.stringify({ item_id: "Z", kind: "swipe", y: 1, features: [1] }) },
      env,
    );
    const aRanking = (await (await app.request("/api/v1/match/ranking", { headers: aH }, env)).json()) as {
      ranking: { item_id: string }[];
    };
    expect(aRanking.ranking.map((r) => r.item_id)).toEqual(["A"]); // no "Z" from actor B
  });

  it("there is no route exposing another actor's preference weights or raw events", () => {
    // Structural guard: match-routes.ts must not register a param route that lets a
    // caller pass someone else's actor_id to read preferences/ranking/weights.
    const src = readFileSync(fileURLToPath(new URL("../apps/api/src/match-routes.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/\.get\(\s*["'`][^"'`]*:(actor|voter|user)[^"'`]*["'`]/i);
  });
});
