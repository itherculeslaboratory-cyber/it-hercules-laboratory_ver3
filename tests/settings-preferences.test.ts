// C5 K4 設定/選好 TC(design-k4 §3 / V3-I18-08 / V3-UIX-16)。PATCH で ihl.pref.set.v1
// を append→GET /me/preferences が last-write-wins 投影で反映 / 本人スコープ(他人の選好
// 不可視)/ 未設定の既定値 / GET /settings の locale・theme-pack 一覧 / 負の validation
// (enum 外・余剰キー→400・批評家修正3 の write-time 検証配線が効くこと)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
const authOf = async (actor: string) => bearer(await issueSessionToken(actor, SESSION_SECRET));
const getPrefs = (env: object, h: Record<string, string>) =>
  app.request("/api/v1/me/preferences", { headers: h }, env);
const patchPrefs = (env: object, h: Record<string, string>, body: unknown) =>
  app.request("/api/v1/me/preferences", { method: "PATCH", headers: h, body: JSON.stringify(body) }, env);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("UIX-16 選好 append + LWW 投影", () => {
  it("PATCH で選好を追記し GET が LWW で反映する", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = await authOf("alice");

    expect((await patchPrefs(env, h, { locale: "en" })).status).toBe(200);
    expect((await patchPrefs(env, h, { theme_pack_id: "minimal-dark" })).status).toBe(200);

    const p1 = (await (await getPrefs(env, h)).json()) as Record<string, string>;
    // 別フィールドは併存マージ。
    expect(p1.locale).toBe("en");
    expect(p1.theme_pack_id).toBe("minimal-dark");
    expect(p1.template_id).toBe("default"); // 未設定は既定継続

    // 同一フィールド再設定は後勝ち(created_at 昇順で後方が勝つ)。ULID の乱数下位で
    // 同 ms タイが曖昧化しないよう 2ms 空けて created_at を確実に進める。
    await sleep(2);
    expect((await patchPrefs(env, h, { locale: "fr" })).status).toBe(200);
    const p2 = (await (await getPrefs(env, h)).json()) as Record<string, string>;
    expect(p2.locale).toBe("fr");
  });

  it("本人スコープ: 他人の選好は不可視(既定値のまま)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    await patchPrefs(env, await authOf("alice"), { locale: "en" });
    const bob = (await (await getPrefs(env, await authOf("bob"))).json()) as Record<string, string>;
    expect(bob.locale).toBe("ja"); // alice の en は見えない
  });

  it("未設定なら既定値を返す", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const p = (await (await getPrefs(env, await authOf("newbie"))).json()) as Record<string, string>;
    expect(p).toEqual({
      locale: "ja",
      theme_pack_id: "minimal-light",
      template_id: "default",
      reduced_motion_override: "system",
    });
  });

  it("GET /settings が locale 一覧と built-in theme-pack 一覧を返す", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const r = await app.request("/api/v1/settings", { headers: await authOf("alice") }, env);
    expect(r.status).toBe(200);
    const j = (await r.json()) as {
      locales: string[];
      theme_packs: { pack_id: string }[];
      feature_flags: Record<string, boolean>;
    };
    expect(j.locales).toContain("ja");
    const ids = j.theme_packs.map((p) => p.pack_id);
    expect(ids).toContain("minimal-light");
    expect(ids).toContain("minimal-dark");
    // 不変条項①: LLM/Vision/FAISS 既定 OFF。
    expect(j.feature_flags).toEqual({ llm: false, vision: false, faiss: false });
  });
});

describe("UIX-16/I18-08 負の validation(write-time 検証配線・批評家修正3)", () => {
  it("reduced_motion_override が enum 外なら 400", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const r = await patchPrefs(env, await authOf("alice"), { reduced_motion_override: "bogus" });
    expect(r.status).toBe(400);
  });

  it("スキーマ外の余剰キーは 400(additionalProperties:false)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const r = await patchPrefs(env, await authOf("alice"), { locale: "ja", bogus_key: 1 });
    expect(r.status).toBe(400);
  });
});
