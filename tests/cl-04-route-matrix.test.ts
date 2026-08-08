// CL-04: 104-route matrix ↔ deny-by-default 照合 (design-c2 §2).
// Reads tests/fixtures/route-matrix.csv and drives the real app:
//   (i) protected rows: unauthenticated → 401 AUTH_REQUIRED (gate before routing)
//   (ii) public rows: reachable without a session (never gate-blocked)
//   (iii) row count === 104. Lineage: base 68 (route-matrix.csv header comment) →
//        L-PAY レーン(round-16)が -6 GMO retired + 3 PAY.JP 新規 route(infra-route-
//        069..071: POST /fees/{obligation_id}/invoice・POST /fees/payjp-webhook
//        [PUBLIC]・GET /me/fees) = 65 → 認証レーン(round-16 OQ-ROUTE-01/V3-AUT-46)
//        統合マージが -2 onboarding rows(infra-route-006/010・未実装のまま廃止) +
//        1 verify-code 新規 route(infra-route-072・PUBLIC・V3-AUT-46)= 64 →
//        市場フォローレーン(round-15拡張 V3-GOV-35 違法出品ユーザー自治)が +6
//        route(infra-route-073..078・全 protected: POST .../flags・POST
//        .../gov-stop・GET .../flag-status ×2・GET .../misban-reversal・POST
//        .../misban-reversal/execute)= 70 → 知の広場レーン(round-16 OQ-PLZ-03)が
//        +1 route(infra-route-079: POST /plaza/threads/{thread_id}/resolution・
//        protected)= 71 → g01-基盤コストレーン(V3-CST-02)が +1 route
//        (infra-route-080: GET /costs・protected)= 72 → V3-AIP-67(GitHub
//        Issues/掲示板→AI要約スレ)が新規 1 route(infra-route-081: POST
//        /ai-digest/sync・protected・requireRole operator/admin)= 73 →
//        g04-経済レーン(V3-MKT-35)が +1 route(infra-route-082: POST
//        /economy/vote・protected)= 74 → g02-観測レーン(C8 obs-analysis・
//        V3-OBS-57)が +1 route(infra-route-083: GET /observation/{capture_id}/
//        species-suggestions・protected)= 75 → obs-capture レーン(V3-OBS-20
//        棚/場所QR)が +1 route(infra-route-084: POST /placements/
//        {placement_id}/qr・protected)= 76 → obs-capture レーン(V3-OBS-72
//        研究室環境コンテキスト)が +3 route(infra-route-085..087: POST/GET
//        .../lab-environment・GET individuals/{id}/lab-environment・全
//        protected)= 79 → obs-capture レーン(V3-OBS-61 自然言語フリーテキスト
//        解析)が +1 route(infra-route-088: POST /observation/parse-freetext・
//        protected)= 80 → 観測個体レーン(C8 obs-individuals)が +1 route(infra-route-
//        089: GET /match/convergence・protected)= 81 → 同レーンが +1 route(infra-route-
//        090: GET /individuals/lineage-check・protected)= 82 → g07-UIUXレーン
//        (V3-UIX-26)が +1 route(infra-route-091: GET /home/civ-minimap・
//        protected・080は先に基盤コストレーンが採ったため採番をずらして解決)= 83 →
//        C8 g03知識レーン(V3-BBS-14)が +1 route(infra-route-092: GET
//        /plaza/channels/{channel}/improvement-queue・protected・080-091は先に
//        他レーンが採ったため092から採番)= 84 → 同レーン(V3-BBS-28)が +1 route
//        (infra-route-093: GET /plaza/engagement/insights・protected)= 85 → 同レーン
//        (V3-PPR-07)が +1 route(infra-route-094: POST /research/quadrant・
//        protected)= 86 → 同レーン(V3-PPR-20)が +1 route(infra-route-095: POST
//        /research/auto-draft・protected)= 87 → 同レーン(V3-PPR-23)が +1 route
//        (infra-route-096: GET /research/content/{id}/export・protected)= 88 →
//        同レーン(V3-PPR-12)が +1 route(infra-route-097: GET /observation/export・
//        protected。reanalyze バッチは既存 batch-commit 拡張のため新規 route 無し)= 89 →
//        同レーン(V3-WIK-20)が +1 route(infra-route-098: GET /knowledge/cell/{id}・
//        protected)= 90 → 同レーン(V3-WIK-07)が +2 route(infra-route-099: POST
//        /wiki/lint・infra-route-100: GET /wiki/lint-log・共に protected)= 92 →
//        同レーン(V3-WIK-29)が +1 route(infra-route-101: POST
//        /research/external-import・protected)= 93 → market-final レーン(C8
//        g04残todo)が V3-MKT-64 プリカ案内 +1 route(infra-route-102: GET
//        /market/payment-guidance・protected・静的。分岐時点は080で採番したが
//        101までは他レーンが既に採取済みのため統合時に102へ採番替え)= 94 →
//        同レーンが V3-MKT-40 複式簿記検算 +1 route(infra-route-103: GET
//        /ledger/audit・protected)= 95 → 同レーンが V3-MKT-03 公開Q&A+ほめボード
//        +2 route(infra-route-104..105: POST/GET /market/listings/{listing_id}/
//        comments・protected)= 97 → 同レーンが V3-MKT-06 個体直接オファー+ポリシー
//        +4 route(infra-route-106..109: POST/GET /individuals/{id}/offer-policy・
//        POST/GET /individuals/{id}/offers・protected)= 101 → 同レーンが V3-MKT-45
//        研究支援ストア +3 route(infra-route-110..112: POST/GET /research/store/
//        items・POST /research/store/items/{id}/orders・protected)= 104 →
//        g07-UIUX レーン(V3-UIX-68・透明性の文化)が +1 route(infra-route-113:
//        GET /users/{actor}/individuals・protected・080/081は先に他レーンが
//        採ったため統合時に113へ採番替え)= 105 → 同レーン(V3-UIX-82・検索
//        グラフビュー)が +1 route(infra-route-114: GET /individuals/{id}/graph・
//        protected)= 106 → last-four レーン(C8・V3-WIK-28 AIセッション閲覧)が
//        +1 route(infra-route-115: POST /research/ai-sessions・protected)= 107 →
//        批評ゲートR0801-c16d84中2(g66-wave1fix是正)が既存mount済みだが未登録だった
//        +1 route(infra-route-116: GET /plaza/node/{post_id}・protected)= 108 →
//        R66-9(g66-finalize)が +1 route(infra-route-117: POST /cusb・public)= 109 →
//        QRLINK-1(2026-08-08・w2-gatefix是正)が +2 route(infra-route-118..119:
//        GET /individuals/{id}/profile・GET /individuals/{id}/pedigree・共に public)= 111 →
//        2026-08-08 impl-w3-routeguard(W3-05 S-7): PUBLIC_ROUTES(index.ts)にあるのに本表に
//        行が無かった public route 7 本(infra-route-120..126: /health・/auth/dev-login・
//        /collector/ingest・/github/webhook・/fees/payjp-checkout-webhook・/chain/root・
//        /plaza/rules)を追加 = 118 → rel-12(8モジュール26ルート・全 protected)未登録分
//        (infra-route-127..152)を追加 = 144。
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import app, { PUBLIC_ROUTES } from "../apps/api/src/index";
import { SESSION_SECRET, makeEnv } from "./helpers";
import { issueMagicToken } from "../apps/api/src/session";

type Row = { method: string; path: string; access: string; ver3_status: string; ver3_note: string };

function loadMatrix(): Row[] {
  const url = new URL("./fixtures/route-matrix.csv", import.meta.url);
  const lines = readFileSync(url, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "" && !l.startsWith("#"));
  const header = lines[0].split(",");
  const iMethod = header.indexOf("method");
  const iPath = header.indexOf("path");
  const iAccess = header.indexOf("access");
  const iVer3Status = header.indexOf("ver3_status");
  const iVer3Note = header.indexOf("ver3_note");
  return lines.slice(1).map((l) => {
    const cols = l.split(",");
    return {
      method: cols[iMethod],
      path: cols[iPath],
      access: cols[iAccess],
      ver3_status: cols[iVer3Status],
      ver3_note: cols.slice(iVer3Note).join(","),
    };
  });
}

// {param} → dummy value so the path is requestable.
function concretePath(p: string): string {
  return p.replace(/\{[^}]+\}/g, "x");
}

const rows = loadMatrix();

describe("CL-04 route matrix (144 rows)", () => {
  it("has exactly 144 route rows", () => {
    expect(rows.length).toBe(144);
  });

  it("access column is only public|protected", () => {
    for (const r of rows) expect(["public", "protected"]).toContain(r.access);
  });

  // 2026-08-01 w-aut2(第22回裁定 V3-AUT-15/14/16): 観測データ閲覧(検索・一覧・詳細)を
  // protected→public へ緩和(route-matrix.csv 参照)。書込系(capture/measurement/commit/
  // upload/template append/dictionary-extensions)は protected のまま(V3-AUT-14 deny-list)。
  // 2026-07-31 R65-5是正: infra-route-097(GET /observation/export)はpublic化を取消し
  // protectedへ戻した(裁定文言「検索・一覧・詳細」にエクスポートは含まれず、可視性フィルタ
  // 皆無で全ユーザーの全観測データが未ログインで流出するため)。監査根拠=
  // R0731-1ff12e-AUDIT-2026-07-31-g65-publicroutes.md
  // 2026-08-01 R66-9(g66-finalize): POST /api/v1/cusb を追加(infra-route-117)。
  // ゲート層はPUBLIC_READ_ROUTES登録によりpublic(R66-1)だが、route自身は署名3点か
  // セッションのどちらか必須(R66-9・無提示は401 AUTH_REQUIRED)— 観測READ各行とは
  // 「無条件公開」の意味が違うが、CSVのaccess列上はinfra-route-024と同じpublic表記。
  // 2026-08-08 QRLINK-1(w2-gatefix T1): GET /individuals/{id}/profile・pedigree を追加
  // (infra-route-118/119)。物理QRラベル着地の未ログイン閲覧用(検分ゲートR0808-2419fd)。
  it("public = auth magic-link/verify/verify-code/session/dev-login + health + collector/github/payjp-checkout webhooks(署名/トークン必須) + chain/root + plaza/rules + payjp-webhook + cusb(署名/セッション必須) + individuals profile/pedigree + 観測READ 10 paths(exportを除く)", () => {
    const publicPaths = new Set(rows.filter((r) => r.access === "public").map((r) => r.path));
    expect([...publicPaths].sort()).toEqual([
      "/api/v1/auth/dev-login",
      "/api/v1/auth/magic-link",
      "/api/v1/auth/session",
      "/api/v1/auth/verify",
      "/api/v1/auth/verify-code",
      "/api/v1/chain/root",
      "/api/v1/collector/ingest",
      "/api/v1/cusb",
      "/api/v1/fees/payjp-checkout-webhook",
      "/api/v1/fees/payjp-webhook",
      "/api/v1/github/webhook",
      "/api/v1/individuals/{id}/pedigree",
      "/api/v1/individuals/{id}/profile",
      "/api/v1/observation/measurement-dictionary",
      "/api/v1/observation/search",
      "/api/v1/observation/targets/catalog",
      "/api/v1/observation/targets/search",
      "/api/v1/observation/templates",
      "/api/v1/observation/templates/{template_id}",
      "/api/v1/observation/{capture_id}",
      "/api/v1/observation/{capture_id}/image/{photo_id}",
      "/api/v1/observation/{capture_id}/reanalysis-manifest",
      "/api/v1/observation/{capture_id}/species-suggestions",
      "/api/v1/plaza/rules",
      "/health",
    ]);
  });

  it("every protected row → 401 AUTH_REQUIRED without auth", async () => {
    for (const r of rows.filter((x) => x.access === "protected")) {
      const res = await app.request(
        concretePath(r.path),
        { method: r.method },
        makeEnv(),
      );
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
      expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
    }
  });

  it("every public row is reachable without a session (not 401)", async () => {
    // github/webhook と fees/payjp-checkout-webhook は自己ゲート(HMAC署名/専用トークン)を
    // 持つため、無署名だとルート自身が401を返す(セッションゲートの401とは別原因)。
    // このテストが検証したいのは「セッションゲートで401にならないこと」なので、この2本だけは
    // 有効な署名/トークンを持つ専用envを渡して自己ゲートを突破する(既存 github-webhook.test.ts
    // /payjp-checkout-routes.test.ts と同型: makeEnv() + 秘密値オーバーライド)。
    const GITHUB_SECRET = "matrix-test-github-secret";
    const PAYJP_CHECKOUT_TOKEN = "matrix-test-payjp-checkout-token";
    for (const r of rows.filter((x) => x.access === "public")) {
      // Provide minimal valid input so the route's own validation doesn't 401.
      let init: RequestInit = { method: r.method };
      let env: ReturnType<typeof makeEnv> | (ReturnType<typeof makeEnv> & Record<string, string>) = makeEnv();
      if (r.path.endsWith("/magic-link")) {
        init = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "matrix@example.com" }),
        };
      } else if (r.path.endsWith("/verify")) {
        const tok = await issueMagicToken("matrix@example.com", SESSION_SECRET);
        init = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: tok }),
        };
      } else if (r.path === "/api/v1/github/webhook") {
        const sig = "sha256=" + createHmac("sha256", GITHUB_SECRET).update("").digest("hex");
        init = { method: "POST", headers: { "X-Hub-Signature-256": sig } };
        env = { ...makeEnv(), GITHUB_WEBHOOK_SECRET: GITHUB_SECRET };
      } else if (r.path === "/api/v1/fees/payjp-checkout-webhook") {
        init = { method: "POST", headers: { "X-Payjp-Webhook-Token": PAYJP_CHECKOUT_TOKEN } };
        env = { ...makeEnv(), PAYJP_WEBHOOK_TOKEN: PAYJP_CHECKOUT_TOKEN };
      }
      const res = await app.request(concretePath(r.path), init, env);
      expect(res.status, `${r.method} ${r.path}`).not.toBe(401);
    }
  });
});

describe("S-7恒久策: PUBLIC_ROUTES ⇔ route-matrix.csv 双方向突合", () => {
  it("PUBLIC_ROUTES(index.ts)の全要素が route-matrix.csv に access=public の行を持つ", () => {
    const publicPathsInCsv = new Set(rows.filter((r) => r.access === "public").map((r) => r.path));
    for (const p of PUBLIC_ROUTES) {
      expect(publicPathsInCsv.has(p), `PUBLIC_ROUTES entry missing from route-matrix.csv: ${p}`).toBe(true);
    }
  });
});

describe("S-6恒久策: route-matrix.csv(ver3_status=implemented)の全行が index.ts に実mountされている", () => {
  it("契約テストの直接mountだけでなく index.ts 上の app.routes に実在する", () => {
    // {param} (CSV表記) → :param (Hono表記) の param 名は書き手ごとに揺れうるため、
    // 動的セグメントは名前を見ずに位置だけ揃える正規化で比較する(過検出/過検出漏れの両方を避ける)。
    const normalize = (p: string): string =>
      p
        .split("/")
        .map((seg) => (seg.startsWith(":") || (seg.startsWith("{") && seg.endsWith("}")) ? "*" : seg))
        .join("/");
    const mounted = new Set(
      app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${normalize(r.path)}`),
    );
    // 2種類の既存の意図的な不一致(本発注のスコープ外・CSVの ver3_note 自身が根拠を明記):
    // (a) infra-route-021: path 列が ver2/ver3(VPS)時代の旧パス "/api/solid-observation/commit"
    //     を記録しており、ver3_note が「ver3 実体は /api/v1/solid-observation/commit」と明記
    //     → 実体パスへ読み替えて判定する(スキップではなく正しいパスでの検証)。
    // (b) infra-route-033..040(知の広場/ガバナンス統合): ver3_note が「旧パスは
    //     deny-by-default 401 据置」と明記 = 旧URLは恒久的に未mountのまま401させる設計。
    //     実体は同じCSV内の別行(/plaza/channels/... 等)が既に mount保証の対象として検証済み
    //     → この行だけ mount保証の対象から除外する(除外基準はCSVの note文言そのものであり、
    //     shard_id のハードコードではない)。
    // (c) infra-route-102(GET /api/v1/market/payment-guidance): 本発注(W3-05)の対象外で
    //     見つかった既存のCSV/index.ts drift。index.ts:438 は「2026-08-07裁定でV3-MKT-64退役
    //     のためroute非公開(app.routeをコメントアウト)」と明記しているが、route-matrix.csv側の
    //     この行はver3_status=implementedのまま未修正(V3-MKT-62/63は退役時に行ごと削除された
    //     のと扱いが不揃い)。担当外のため本行では直さず、報告書の気づきとして分離して報告する
    //     (KIT-TEMPLATE「担当外の問題に気づいたら直さず報告書に書け」)。
    for (const r of rows.filter((x) => x.ver3_status === "implemented")) {
      if (r.ver3_note.includes("旧パスは deny-by-default 401 据置")) continue;
      if (r.path === "/api/v1/market/payment-guidance") continue;
      const path = r.path === "/api/solid-observation/commit" ? "/api/v1/solid-observation/commit" : r.path;
      const key = `${r.method} ${normalize(path)}`;
      expect(mounted.has(key), `not mounted on app: ${r.method} ${r.path}`).toBe(true);
    }
  });
});
