// w1-sec Wave1バッチ TC(R0730-ad0c0b-ORDER-2026-07-31-w1-sec担当ID群のうち、既存機構だけ
// では明示テストが無かった分の型C遵守証拠)。V3-SEC-15/16/17/19 をここに集約する。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { safeNextPath, checkProdAuthEnv } from "../apps/api/src/policy";
import { makeEnv } from "./helpers";

describe("V3-SEC-15 safeNextPath(open-redirectガード)", () => {
  it("内部絶対パスはそのまま許可する", () => {
    expect(safeNextPath("/mypage")).toBe("/mypage");
    expect(safeNextPath("/a/b?c=1")).toBe("/a/b?c=1");
  });

  it("外部URL(http/https)は / へ落とす", () => {
    expect(safeNextPath("http://evil.example/phish")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
  });

  it("プロトコル相対URL(//evil.example)は / へ落とす", () => {
    expect(safeNextPath("//evil.example")).toBe("/");
  });

  it("空値/未指定/非文字列は / へ落とす", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
});

describe("V3-SEC-16 認証ゲートのe2e実弾確認(『置いただけで効いている』を仮定しない)", () => {
  const PROTECTED_PATHS = [
    "/api/v1/me/key-bundle",
    "/api/v1/settings/pii-session",
    "/api/v1/me/ledger",
  ];

  it("未ログイン(Authorizationヘッダ無し)で保護routeは実際に401で弾かれる", async () => {
    for (const path of PROTECTED_PATHS) {
      const res = await app.request(path, {}, makeEnv());
      expect(res.status, path).toBe(401);
    }
  });
});

describe("V3-SEC-17 画像/未知routeも認証免除しない(deny-by-defaultの構造確認)", () => {
  it("PUBLIC_ROUTESに無い画像相当パス(仮称)も未ログインなら401(404で素通りしない)", async () => {
    const res = await app.request("/api/v1/observations/photo-1/image", {}, makeEnv());
    // 認可ゲートは PUBLIC_ROUTES 非該当パスを route 解決の前に 401 で止める
    // (index.ts:152-153)。ルートが実在しない場合の 404 より必ず先に効く。
    expect(res.status).toBe(401);
  });
});

describe("V3-SEC-19 本番認証バイパス変数の構造的不在", () => {
  it("checkProdAuthEnv: 未設定はok", () => {
    expect(checkProdAuthEnv({})).toEqual({ ok: true, problems: [] });
  });

  it("checkProdAuthEnv: IHL_AUTH_REQUIRED!=='1' やBYPASS系が立っていればng", () => {
    expect(checkProdAuthEnv({ IHL_AUTH_REQUIRED: "0" }).ok).toBe(false);
    expect(checkProdAuthEnv({ IHL_AUTH_BYPASS: "1" }).ok).toBe(false);
    expect(checkProdAuthEnv({ IHL_WEB_AUTH_BYPASS: "1" }).ok).toBe(false);
  });

  it("これらの変数をどう設定しても実装が参照しないため未認証は401のまま(回帰確認)", async () => {
    const env = makeEnv() as Record<string, unknown>;
    env.IHL_AUTH_REQUIRED = "0";
    env.IHL_AUTH_BYPASS = "1";
    env.IHL_WEB_AUTH_BYPASS = "1";
    const res = await app.request("/api/v1/me/key-bundle", {}, env);
    expect(res.status).toBe(401);
  });
});
