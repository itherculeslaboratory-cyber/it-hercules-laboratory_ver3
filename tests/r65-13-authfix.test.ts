// R65-13/R65-15: 批評ゲート是正(kits\lane-research\R0731-5c93fc-GATE-2026-07-31-g65-authmw.md)
// の条件A/C + 中4を固定する回帰網。
// T1(条件A・R65-13): PUBLIC_READ_ROUTES(export済み)と route-matrix.csv のpublic行 − PUBLIC_ROUTES が
//   双方向に集合等価であること(片側にだけ足すと赤くなること)。
// T2(条件C・R65-15): PUBLIC_ROUTES(webhook/認証系)の POST は書込レート制限(IPクォータ)の
//   対象にならないこと(変更前の挙動=素通り、へ正確に戻したことの確認)。
// T4(中4・R65-15後段): clientIp() が "unknown" を返す経路で全匿名が単一バケットへ集約される
//   意図した fail-closed 挙動を固定する。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import app, { PUBLIC_READ_ROUTES, PUBLIC_ROUTES } from "../apps/api/src/index";
import { memoryKV } from "../apps/api/src/kv";
import { makeEnv } from "./helpers";

type Row = { method: string; path: string; access: string };

function loadMatrix(): Row[] {
  const url = new URL("./fixtures/route-matrix.csv", import.meta.url);
  const lines = readFileSync(url, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "" && !l.startsWith("#"));
  const header = lines[0].split(",");
  const iMethod = header.indexOf("method");
  const iPath = header.indexOf("path");
  const iAccess = header.indexOf("access");
  return lines.slice(1).map((l) => {
    const cols = l.split(",");
    return { method: cols[iMethod], path: cols[iPath], access: cols[iAccess] };
  });
}

// route-matrix.csv の {capture_id} 記法 → PUBLIC_READ_ROUTES の :capture_id 記法へ変換。
function toMatchedRouteKey(r: Row): string {
  return `${r.method} ${r.path.replace(/\{([^}]+)\}/g, ":$1")}`;
}

describe("R65-13 T1: PUBLIC_READ_ROUTES ⇔ route-matrix.csv(public行 − PUBLIC_ROUTES)は双方向に集合等価", () => {
  it("双方向一致(片側漏れ0件)", () => {
    // CSVの access=public は2機構の合算 ── ①PUBLIC_ROUTES(生URL完全一致・ゲートごと素通り)
    // ②PUBLIC_READ_ROUTES(matchedRoutes方式・セッション解決は必ず通す)。①を引いた残りが
    // ②と一致すべき集合。旧実装は「/api/v1/observation/ で始まる」という代理指標で②を
    // 近似していたが、R66-1 で observation 外の "POST /api/v1/cusb" が②に入り恒久赤化した。
    // ①は静的パスのみなので、{...} を含むCSVの動的行が誤って引かれることはない。
    const csvSet = new Set(
      loadMatrix()
        .filter((r) => r.access === "public" && !PUBLIC_ROUTES.includes(r.path))
        .map(toMatchedRouteKey),
    );
    const codeSet = PUBLIC_READ_ROUTES;

    const inCsvNotCode = [...csvSet].filter((k) => !codeSet.has(k));
    const inCodeNotCsv = [...codeSet].filter((k) => !csvSet.has(k));

    expect(inCsvNotCode).toEqual([]);
    expect(inCodeNotCsv).toEqual([]);
    expect(codeSet.size).toBe(csvSet.size);
  });
});

describe("R65-15 T2: PUBLIC_ROUTES(webhook/認証系)のPOSTは書込レート制限の対象にならない", () => {
  it("PAY.JP webhook を上限超えの回数叩いても429にならない(素通り)", async () => {
    const env = { ...makeEnv(), RATE_LIMIT: memoryKV() };
    let lastStatus = 0;
    for (let i = 0; i < 65; i++) {
      // WRITE_RATE_LIMIT_PER_MINUTE(60)を超える回数、同一IPで叩く。
      const res = await app.request(
        "/api/v1/fees/payjp-webhook",
        {
          method: "POST",
          headers: { "content-type": "application/json", "CF-Connecting-IP": "198.51.100.9" },
          body: "{}",
        },
        env,
      );
      lastStatus = res.status;
    }
    // 署名検証等でエラーになってもよいが、429(RATE_LIMITED)にだけはならないこと。
    expect(lastStatus).not.toBe(429);
  });

  it("GitHub webhook を上限超えの回数叩いても429にならない(素通り)", async () => {
    const env = { ...makeEnv(), RATE_LIMIT: memoryKV() };
    let sawRateLimited = false;
    for (let i = 0; i < 65; i++) {
      const res = await app.request(
        "/api/v1/github/webhook",
        {
          method: "POST",
          headers: { "content-type": "application/json", "CF-Connecting-IP": "198.51.100.10" },
          body: "{}",
        },
        env,
      );
      if (res.status === 429) sawRateLimited = true;
    }
    expect(sawRateLimited).toBe(false);
  });
});

describe("R65-15後段 中4: IPが取れない匿名は単一バケット ip:unknown へ集約される(意図したfail-closed)", () => {
  it("CF-Connecting-IP/X-Forwarded-Forどちらも無いと、別リクエストでも同じクォータを共有して429になる", async () => {
    const env = { ...makeEnv(), RATE_LIMIT: memoryKV() };
    const body = { headers: { "content-type": "application/json" }, method: "POST" as const, body: "{}" };

    for (let i = 0; i < 60; i++) {
      await app.request("/api/v1/observation/search", body, env);
    }
    const limited = await app.request("/api/v1/observation/search", body, env);
    expect(limited.status).toBe(429);

    // 同じ"unknown"バケットのため、別の(IPヘッダ無し)匿名リクエストも即座に429になる
    // (=単一バケットに全員が乗っている証拠。別IPなら別バケットになりこうはならない)。
    const anotherAnon = await app.request("/api/v1/observation/search", body, env);
    expect(anotherAnon.status).toBe(429);
  });
});
