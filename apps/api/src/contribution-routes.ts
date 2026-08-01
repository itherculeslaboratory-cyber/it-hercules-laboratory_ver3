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
// g89-w2econ: axis_list の title は閾値到達フラグ(boolean)であり、ScreenDef の
// {{title}} 単純補間だと画面に生の "true"/"false" 文字列が出てしまう(renderer.tsx の
// interpolate() は String(v) を返すのみ・boolean→日本語変換をしない)。projectContribution
// (contribution.ts)本体・AxisState 型は他テスト(contribution.test.ts の厳格 toEqual)を
// 壊すため変更せず、この route ハンドラでのみ表示用の title_label を追記する(加法的・
// 既存フィールドは一切変更しない)。
contributionRoutes.get("/me/contribution", async (c) => {
  const proj = await projectContribution(store(c), c.get("actorId"));
  const axis_list = proj.axis_list.map((a) => ({
    ...a,
    title_label: a.title ? "称号あり" : "称号なし",
  }));
  return c.json({ ...proj, axis_list });
});

// GET /me/pt — 本人の PT 影響力残高（非公開＝本人のみ・KRM-10）。
contributionRoutes.get("/me/pt", async (c) => {
  return c.json(await projectPt(store(c), c.get("actorId")));
});
