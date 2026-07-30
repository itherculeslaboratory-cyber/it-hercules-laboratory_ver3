// V3-WIK-30 — 仕様書のルールをJSONで全公開する透明性。plaza-constants.ts の単一正本を
// そのままJSON化するだけであることを検証する(値の二重定義がないこと)。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { buildPlazaRules, plazaRulesRoutes } from "../apps/api/src/plaza-rules-routes";
import { BOARD_KINDS, FORK_RANKS, CONSENSUS_MIN_VOTES } from "../apps/api/src/plaza-constants";
import { makeEnv } from "./helpers";

const app = new Hono<{ Bindings: ReturnType<typeof makeEnv> }>();
app.route("/api/v1", plazaRulesRoutes);

describe("V3-WIK-30 plaza rules JSON", () => {
  it("buildPlazaRules mirrors plaza-constants.ts (single source of truth, no duplication)", () => {
    const rules = buildPlazaRules();
    expect(rules.board_kinds).toEqual(BOARD_KINDS);
    expect(rules.fork_ranks).toEqual(FORK_RANKS);
    expect(rules.consensus.min_votes).toBe(CONSENSUS_MIN_VOTES);
  });

  it("GET /plaza/rules returns the full rules JSON", async () => {
    const res = await app.request("/api/v1/plaza/rules", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { board_kinds: string[] };
    expect(body.board_kinds).toEqual(BOARD_KINDS);
  });
});
