// c8 UI磨き第2弾#5(受領10・actor_id 生ハッシュ露出の解消) — ihl.actor.display_name.v1。
// 追記(改名)は新イベント・最新勝ち(ind-name-event と同型)・自分以外は代理設定不可
// (V3-AUT-17)・未設定は null(呼び出し側 fallback は renderer 側の責務)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { deriveActorId } from "@ihl/truth";
import { projectDisplayName } from "../apps/api/src/profile-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const DEV_ACTOR = await deriveActorId("dev@ihl.local");

function post(env: object, body: unknown) {
  return app.request(
    "/api/v1/me/display-name",
    { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) },
    env,
  );
}

describe("POST /api/v1/me/display-name", () => {
  it("未設定は null（projectDisplayName・profile 両方）", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request("/api/v1/me/profile", { headers: AUTH_HEADERS }, env);
    const body = (await res.json()) as { display_name: string | null };
    expect(body.display_name).toBeNull();
  });

  it("設定→ /me/profile と /users/{actor}/profile 両方に反映", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const set = await post(env, { display_name: "カブトの人" });
    expect(set.status).toBe(201);

    const me = (await (await app.request("/api/v1/me/profile", { headers: AUTH_HEADERS }, env)).json()) as {
      display_name: string | null;
    };
    expect(me.display_name).toBe("カブトの人");

    const pub = (await (
      await app.request(`/api/v1/users/${DEV_ACTOR}/profile`, { headers: AUTH_HEADERS }, env)
    ).json()) as { display_name: string | null };
    expect(pub.display_name).toBe("カブトの人");
  });

  it("改名は追記(UPDATE ではない)。最新の display_name が勝つ", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    await post(env, { display_name: "旧名" });
    await post(env, { display_name: "新名" });
    const s = new (await import("@ihl/truth")).TruthStore(bucket);
    expect(await projectDisplayName(s, DEV_ACTOR)).toBe("新名");
    // append-only: both events remain in Truth (no UPDATE/DELETE — CL-01 に整合)。
    const rows = await s.listEvents(`truth/ihl.actor.display_name.v1/${DEV_ACTOR}-`);
    expect(rows.length).toBe(2);
  });

  it("空文字/40字超は400", async () => {
    const env = makeEnv(new FakeR2Bucket());
    expect((await post(env, { display_name: "" })).status).toBe(400);
    expect((await post(env, { display_name: "あ".repeat(41) })).status).toBe(400);
  });

  it("未認証は401", async () => {
    const res = await app.request("/api/v1/me/display-name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: "x" }),
    }, makeEnv());
    expect(res.status).toBe(401);
  });
});
