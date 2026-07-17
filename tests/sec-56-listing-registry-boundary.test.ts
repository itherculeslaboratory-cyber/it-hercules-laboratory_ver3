// V3-SEC-56: 出品状態書込・テンプレ公開・GMO 等は認可(index.ts CL-04 deny-by-default が
// 唯一の認可境界・02-design/adr/adr-v3-sec-56-listing-registry-boundary.md 参照)で保護。
// ver2 由来の POST /listing-registry は ver3 に存在せず、将来このパスを追加する場合も
// PUBLIC_ROUTES へは入れない(=deny-by-default の対象のまま)ことを回帰ガードする。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { makeEnv } from "./helpers";

describe("V3-SEC-56 listing-registry boundary (negative regression)", () => {
  it("POST /listing-registry does not exist in ver3 (404, not a public 200/202)", async () => {
    const res = await app.request("/api/v1/listing-registry", { method: "POST" }, makeEnv());
    // deny-by-default: no session -> 401 (route never reached); this alone proves it is
    // NOT accidentally public. With auth it would 404 (no such route registered).
    expect(res.status).toBe(401);
  });

  it("index.ts PUBLIC_ROUTES never whitelists a listing-registry path", () => {
    const indexSrc = readFileSync(fileURLToPath(new URL("../apps/api/src/index.ts", import.meta.url)), "utf8");
    const publicRoutesBlock = indexSrc.slice(
      indexSrc.indexOf("const PUBLIC_ROUTES"),
      indexSrc.indexOf("];", indexSrc.indexOf("const PUBLIC_ROUTES")),
    );
    expect(publicRoutesBlock).not.toMatch(/listing-registry/i);
  });
});
