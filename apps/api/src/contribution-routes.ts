// KRM-10/12 貢献度 + PT 本人スコープ投影 route（design-k3 §2.2）。全て PROTECTED
// （index.ts §1.5 gate が actorId を set）・非公開＝本人のみ（他人の actor を渡す経路無し）。
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { projectContribution, projectPt } from "./contribution";

export const contributionRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}

// GET /me/contribution — 本人の 3 軸貢献度（score/minted/next_threshold/carry/title）。
contributionRoutes.get("/me/contribution", async (c) => {
  return c.json(await projectContribution(store(c), c.get("actorId")));
});

// GET /me/pt — 本人の PT 影響力残高（非公開＝本人のみ・KRM-10）。
contributionRoutes.get("/me/pt", async (c) => {
  return c.json(await projectPt(store(c), c.get("actorId")));
});
