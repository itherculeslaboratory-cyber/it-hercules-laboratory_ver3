// C5 K4 テーマパック TC(design-k4 §3 / V3-UIX-14/16)。GET /theme-packs が built-in 2 +
// user fork / POST /theme-packs fork→parent_pack_id 系譜 / GET /theme-packs/{id} が
// lineage[] を built-in まで返す / 同一 pack_id(ULID)二重 POST は put-if-absent で 409 /
// 負の validation(mode enum 外→400・批評家修正3 の write-time 検証配線が効くこと)。
import { describe, expect, it } from "vitest";
import { ulid } from "@ihl/truth";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
const authOf = async (actor: string) => bearer(await issueSessionToken(actor, SESSION_SECRET));

const TOKENS = {
  bg: "#ffffff",
  surface: "#ffffff",
  "surface-2": "#eeeeee",
  text: "#000000",
  "text-muted": "#555555",
  border: "#dddddd",
  primary: "#0b7a55",
  "primary-text": "#ffffff",
  focus: "#0b7a55",
  danger: "#b3261e",
  "danger-bg": "#fbeae8",
};

const postPack = (env: object, h: Record<string, string>, body: unknown) =>
  app.request("/api/v1/theme-packs", { method: "POST", headers: h, body: JSON.stringify(body) }, env);
const getPack = (env: object, h: Record<string, string>, id: string) =>
  app.request(`/api/v1/theme-packs/${id}`, { headers: h }, env);

describe("UIX-14/16 テーマパック 一覧/fork/系譜", () => {
  it("GET /theme-packs が built-in 2 + user fork を返す", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = await authOf("alice");
    const forkId = ulid();
    await postPack(env, h, {
      pack_id: forkId,
      name: "Alice Fork",
      mode: "light",
      parent_pack_id: "minimal-light",
      tokens: TOKENS,
    });
    const r = await app.request("/api/v1/theme-packs", { headers: h }, env);
    const j = (await r.json()) as { theme_packs: { pack_id: string }[] };
    const ids = j.theme_packs.map((p) => p.pack_id);
    expect(ids).toContain("minimal-light");
    expect(ids).toContain("minimal-dark");
    expect(ids).toContain(forkId);
  });

  it("fork の parent_pack_id が lineage[] で built-in まで連結する", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = await authOf("alice");
    const forkA = ulid();
    const forkB = ulid();
    await postPack(env, h, { pack_id: forkA, name: "A", mode: "dark", parent_pack_id: "minimal-dark", tokens: TOKENS });
    await postPack(env, h, { pack_id: forkB, name: "B", mode: "dark", parent_pack_id: forkA, tokens: TOKENS });

    const r = await getPack(env, h, forkB);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { pack: { pack_id: string }; lineage: string[] };
    expect(j.pack.pack_id).toBe(forkB);
    // 自身→親fork→built-in の順で終端が built-in。
    expect(j.lineage).toEqual([forkB, forkA, "minimal-dark"]);
  });

  it("built-in パック単体は lineage が自身のみ(終端)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const r = await getPack(env, await authOf("alice"), "minimal-light");
    const j = (await r.json()) as { lineage: string[] };
    expect(j.lineage).toEqual(["minimal-light"]);
  });

  it("存在しない pack は 404", async () => {
    const env = makeEnv(new FakeR2Bucket());
    expect((await getPack(env, await authOf("alice"), ulid())).status).toBe(404);
  });

  it("同一 pack_id(ULID)二重 POST は 409(storage put-if-absent)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = await authOf("alice");
    const id = ulid();
    const body = { pack_id: id, name: "Dup", mode: "light", tokens: TOKENS };
    expect((await postPack(env, h, body)).status).toBe(201);
    expect((await postPack(env, h, body)).status).toBe(409);
  });
});

describe("UIX-14/16 負の validation(write-time 検証配線・批評家修正3)", () => {
  it("mode が enum 外なら 400", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const r = await postPack(env, await authOf("alice"), {
      pack_id: ulid(),
      name: "Bad",
      mode: "blue",
      tokens: TOKENS,
    });
    expect(r.status).toBe(400);
  });

  it("tokens が欠落なら 400", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const r = await postPack(env, await authOf("alice"), { pack_id: ulid(), name: "NoTokens", mode: "light" });
    expect(r.status).toBe(400);
  });
});
