import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import { TruthStore, deriveActorId } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { sourceRoutes } from "./source-routes";
import { aiRoutes } from "./ai-kernel";
import { verifySessionToken } from "./session";
import { authRoutes } from "./auth-routes";
import { isDenylisted } from "./denylist";
import { obsRoutes } from "./observation-routes";
import { collectorRoutes } from "./collector-routes";
import { envImportRoutes } from "./env-import-routes";
import { ledgerRoutes } from "./ledger-routes";
import { contributionRoutes } from "./contribution-routes";
import { shopRoutes } from "./shop-routes";
import { feeRoutes } from "./fee-routes";
import { marketRoutes } from "./market-routes";
import { marketReservationRoutes } from "./market-reservation-routes";
import { marketBlockRoutes } from "./market-block-routes";
import { marketFlagRoutes } from "./market-flag-routes";
import { plazaRoutes } from "./plaza-routes";
import { govRoutes } from "./gov-routes";
import { settingsRoutes } from "./settings-routes";
import { themeRoutes } from "./theme-routes";
import { marketRatingRoutes } from "./market-rating-routes";
import { marketPaymentGuidanceRoutes } from "./market-payment-guidance-routes";
import { marketTemplateRoutes } from "./market-template-routes";
import { marketPricingRoutes } from "./market-pricing-routes";
import { piiRoutes } from "./pii-routes";
import { individualRoutes } from "./individual-routes";
import { taxonRoutes } from "./taxon-routes";
import { tagRoutes } from "./tag-routes";
import { matchRoutes } from "./match-routes";
import { clutchRoutes } from "./clutch-routes";
import { batchCommitRoutes } from "./batch-commit-routes";
import { deviceRoutes } from "./device-routes";
import { homeRoutes } from "./home-routes";
import { cusbRoutes } from "./cusb-routes";
import { socialRoutes } from "./social-routes";
import { proposalRoutes } from "./proposal-routes";
import { profileRoutes } from "./profile-routes";
import { githubWebhookRoutes } from "./github-webhook-routes";
import { researchContentRoutes } from "./research-content-routes";
import { paperMatchRoutes } from "./paper-match-routes";
import { projectRoutes } from "./project-routes";
import { researchCanonicalRoutes } from "./research-canonical-routes";
import { researchAgentBatchRoutes, handleResearchScheduled } from "./research-agent-batch";
import { NEWSPAPER_CRON_UTC } from "./research-constants";
import { handleScheduled } from "./batch";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// CL-04 deny-by-default: ONLY these paths are public. Everything else —
// including unknown routes — hits the auth gate first (401 before 404).
// Public = /health + the 3 auth entry routes (magic-link/verify/session).
// logout is PROTECTED (§1.3): you must hold a session to end it.
const PUBLIC_ROUTES = [
  "/health",
  "/api/v1/auth/magic-link",
  "/api/v1/auth/verify",
  // V3-AUT-46(round-16 OQ-ONB-03): magic-link と同一OTPの数字コード verify。email+code
  // 自体が資格情報(magic token と同格)なので public — 中身のワンタイム性/試行回数制限は
  // route 内(auth-routes.ts)で担保する。
  "/api/v1/auth/verify-code",
  "/api/v1/auth/session",
  // dev-only 1-click login (§1.4 V3-AUT-05). Self-gates on DEV_TOKEN: 404 in
  // prod where DEV_TOKEN is unset, so exposing the path adds no prod surface.
  "/api/v1/auth/dev-login",
  // collector ingest (design-c3 §3): public at the session layer, self-gated by
  // Ed25519 signature — the signature IS the credential (CL-09). Unsigned/forged
  // → 401 inside the route, so no session surface is exposed.
  "/api/v1/collector/ingest",
  // GitHub webhook (design-k3 §2.5 / V3-KRM-13): public at the session layer,
  // self-gated by X-Hub-Signature-256 HMAC — the signature IS the credential.
  // Forged/missing signature → 401 inside the route, so no session surface leaks.
  "/api/v1/github/webhook",
  // PAY.JP webhook (L-PAY / round-16): public at the session layer. PAY.JP's
  // webhook lacks a reliable HMAC signature (payjp-connector.ts header comment),
  // so the self-gate is a re-query instead: the route trusts only the charge
  // id from the body and re-fetches the charge via GET /v1/charges/:id with our
  // own secret key before recording anything — a forged body alone matches
  // nothing real.
  "/api/v1/fees/payjp-webhook",
];

// CORS (design-k7 FND-11 §1.5). credentials=true → `*` is forbidden; only an origin
// present in the env allowlist is echoed. Registered BEFORE the auth gate so (a) an
// OPTIONS preflight to a protected path returns 204 without a session, and (b) 401
// responses still carry the ACAO header (hono/cors sets it before next(), and Hono
// merges pre-set headers into the replacement response).
const CORS_ALLOW_METHODS = "GET,POST,OPTIONS";
const CORS_ALLOW_HEADERS = "Content-Type,Authorization";
const CORS_MAX_AGE = 86400; // 24h preflight cache

// Echo the request origin only when it is in CORS_ALLOW_ORIGINS (comma list); else
// null → no ACAO. Never returns "*" (credentials mode). Shared by cors() + onError.
function corsAllowOrigin(origin: string, env: Bindings): string | null {
  if (!origin) return null;
  const allow = (env.CORS_ALLOW_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return allow.includes(origin) ? origin : null;
}

app.use(
  "*",
  cors({
    origin: (origin, c) => corsAllowOrigin(origin, c.env),
    allowMethods: CORS_ALLOW_METHODS.split(","),
    allowHeaders: CORS_ALLOW_HEADERS.split(","),
    maxAge: CORS_MAX_AGE,
    credentials: true,
  }),
);

// 500s must ALSO carry CORS headers (FND-11): re-echo the allowed origin onto the
// error response so a cross-origin caller can read the failure instead of it being
// masked as an opaque CORS error. Non-allowed origins get no ACAO (same as success).
app.onError((err, c) => {
  const origin = corsAllowOrigin(c.req.header("origin") ?? "", c.env);
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
  }
  console.error(err);
  return c.json({ error: "INTERNAL" }, 500);
});

// Auth middleware (§1.5). Order: PUBLIC → Cookie → Bearer session → Bearer DEV_TOKEN → 401.
// V3-AUT-03(round-16 Q-REQ-03): cookie/bearer セッションは denylist(KV)も毎リクエスト
// 照会する — iat < 失効時刻なら 401(既発行トークンの唯一の強制失効経路)。DEV_TOKEN
// 経路は対象外(既存契約通り・per-request BAN 判定もしない後波扱い)。
app.use("*", async (c, next) => {
  if (PUBLIC_ROUTES.includes(c.req.path)) return next();

  const secret = c.env?.SESSION_SECRET;

  // roles claim(V3-AUT-22)を安全に取り出す(非配列/非文字列要素は捨てる)。
  const rolesOf = (p: { roles?: unknown }): string[] =>
    Array.isArray(p.roles) ? p.roles.filter((x): x is string => typeof x === "string") : [];

  // ② HttpOnly Cookie ihl_session
  const cookieTok = getCookie(c, "ihl_session");
  if (cookieTok && secret) {
    const p = await verifySessionToken(cookieTok, secret);
    if (p) {
      if (await isDenylisted(c.env.AUTH_DENYLIST, p.sub, p.iat)) {
        return c.json({ error: "SESSION_REVOKED" }, 401);
      }
      c.set("actorId", p.sub);
      c.set("roles", rolesOf(p));
      return next();
    }
  }

  // ③④ Authorization: Bearer <session token | DEV_TOKEN>
  const header = c.req.header("Authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (bearer) {
    if (bearer.startsWith("v1.") && secret) {
      const p = await verifySessionToken(bearer, secret);
      if (p) {
        if (await isDenylisted(c.env.AUTH_DENYLIST, p.sub, p.iat)) {
          return c.json({ error: "SESSION_REVOKED" }, 401);
        }
        c.set("actorId", p.sub);
        c.set("roles", rolesOf(p));
        return next();
      }
    }
    if (c.env?.DEV_TOKEN && bearer === c.env.DEV_TOKEN) {
      c.set("actorId", await deriveActorId("dev@ihl.local"));
      c.set("roles", []); // DEV_TOKEN 経路はロール無し
      return next();
    }
  }

  return c.json({ error: "AUTH_REQUIRED" }, 401);
});

// GET /health → { status: "ok" } — 契約正本: schemas/api/health.schema.json
app.get("/health", (c) => c.json({ status: "ok" }));

// Auth routes (§1.3): magic-link / verify / session / logout.
app.route("/api/v1/auth", authRoutes);

// Home / insight / observation schedule (design-k1 §1.1/§1.4 / V3-OBS-21/43):
// POST /api/v1/observation/schedule · GET /api/v1/home/summary · GET /api/v1/
// observation/insights. Protected (session, NOT signature-public); schedules are
// append-only obs.schedule.v1 and summaries recompute from Truth each call. Cron
// polling (OBS-28) is a human gate — events only here, no resident scheduler.
// Mounted BEFORE obsRoutes so the static /observation/insights wins over obsRoutes'
// param route GET /observation/:capture_id (cross-app first-registered precedence).
app.route("/api/v1", homeRoutes);

// C-USB ingest (design-k1 §1.1 / V3-OBS-44): POST /api/v1/cusb. Session-protected
// (NOT in PUBLIC_ROUTES — unlike collector's signature-public ingest). Flow:
// validate → payload_hash tamper check → lineage/semantic stamp → put-if-absent.
app.route("/api/v1", cusbRoutes);

// Observation core (§3.2): captures / upload / detail / image / templates /
// individuals observations + qr / qr resolve. All protected (not in PUBLIC_ROUTES).
app.route("/api/v1", obsRoutes);

// Collector ingest (§3 design-c3): POST /api/v1/collector/ingest. Ed25519
// signature-authenticated (public at session layer, self-gated by signature).
app.route("/api/v1", collectorRoutes);

// Economy ledger projection (design-c4 §1): GET /api/v1/me/ledger — 本人スコープ
// karma(value/count 二層)+ platinum の都度再計算投影 (V3-KRM-01/02 / CL-12).
app.route("/api/v1", ledgerRoutes);

// Contribution 3-axis + PT projection (design-k3 §2.2 / V3-KRM-10/12): GET
// /api/v1/me/contribution・GET /api/v1/me/pt。本人スコープ・非公開（他人の actor を
// 渡す経路なし）。score→minted/next_threshold は投影で都度導出（常駐 DB 禁止）。
app.route("/api/v1", contributionRoutes);

// Platinum coin shop / indulgence (design-k3 §2.2 / V3-KRM-05): POST /api/v1/shop/
// indulgence・GET /api/v1/shop/indulgence/price。免罪符購入＝カルマカウント -1（value 不変）・
// 価格 fib(stage)・PT 消費。全て保護・本人スコープ。
app.route("/api/v1", shopRoutes);

// L-PAY 5%システム維持費のゆるい請求フロー (round-16 裁定 / V3-MKT-10): POST /fees/
// {obligation_id}/invoice(本人スコープ・保護)・POST /fees/payjp-webhook(PUBLIC・自己ゲート
// = charge id 再照会)・GET /me/fees(本人スコープ・保護・未払い投影)。GMO route は retired
// (gmo-routes.ts 冒頭コメント参照・義務台帳イベント型はそのまま継承)。
app.route("/api/v1", feeRoutes);

// Market skeleton (design-c4 §3 / V3-MKT-01): POST /market/listings(出品)・
// GET /market/listings(一覧投影)・GET /market/listings/{id}(詳細)。全て保護。
// 状態機械5脚+成立2方式+round-16決済裁定(pay_declare/pay_confirm/cancel)は
// market-settlement.ts/market-routes.ts に実装(C8 レーンL1)。
app.route("/api/v1", marketRoutes);

// V3-IND-35 割り出し予約(round-15新規・第1波S tier / round-16 OQ-ROUTE-03 実装先):
// POST /market/reservations(+GET)・POST /market/listings/{id}/match(自動マッチング)・
// GET /market/transfer/{id}(確認画面)・POST /market/reservations/{id}/confirm|decline。
// 全て保護・確認されなかった予約者はカルマ-1(read-time 自己修復・cron 非依存)。
app.route("/api/v1", marketReservationRoutes);

// V3-MKT-61 ブロックユーザーとは取引不可(round-15新規): POST/GET /market/blocks +
// isBlockedPair 投影(market-routes/market-reservation-routes の取引ガードから参照)。
// 掲示板/議論は不干渉(plaza/gov には配線しない)。全て保護。
app.route("/api/v1", marketBlockRoutes);

// V3-GOV-35 違法出品ユーザー自治(round-15拡張): POST /market/listings/{id}/flags
// (同国指摘・5件で非表示)・POST /market/listings/{id}/gov-stop(operator/admin・近似範囲
// まるごと停止)・GET moderation 投影・POST /market/sellers/{id}/misban-reversal/execute
// (カルマ80×5人判定で出品停止解除)。全て保護。
app.route("/api/v1", marketFlagRoutes);

// V3-MKT-64 プリカ案内(静的・照会結果非依存): GET /market/payment-guidance。全て保護。
app.route("/api/v1", marketPaymentGuidanceRoutes);

// Plaza / 知の広場書込 (design-c5.md §K6 §2.1 slot033-036 / V3-BBS-01/03/05/10/20/29/36):
// POST posts/stances/forks/signals/summaries + 決定論投影(thread/consensus/fork-rank/
// ranking/summary)。全て保護・append-only・投影は都度再計算・LLM 呼び出しゼロ。
app.route("/api/v1", plazaRoutes);

// Governance / ガバナンス (design-c5.md §K6 §2.1 slot037-040 / V3-GOV-01/09/12/19/23): POST
// votes/disputes(+messages/close)/flags + 決定論投影(threshold/os-promotion/dispute/
// precedents)。全て保護・append-only・投影は都度再計算・LLM 呼び出しゼロ。自動モデレーション
// endpoint / NG ワード表は不採用(GOV-13・gov-no-automod.test.ts が不在を回帰ガード)。
app.route("/api/v1", govRoutes);

// Settings/preferences (design-k4 §1.1 routes 041-044,050,051 / V3-UIX-16): GET
// /me/preferences・GET /me/settings・GET /settings・PATCH /me/preferences。選好は
// append-only ihl.pref.set.v1、GET は投影で LWW 都度再計算。全て保護・本人スコープ。
app.route("/api/v1", settingsRoutes);

// Theme packs / UI templates (design-k4 §1.1 routes 046-049 / V3-UIX-14/16/45): GET
// /theme-packs・GET /theme-packs/{id}(lineage)・POST /theme-packs(fork)・POST
// /builder/canvas(UI-as-node)。投票は POST /events(ihl.ui.vote.v1)再利用・冪等は投影
// dedup。全て保護・本人スコープ。
app.route("/api/v1", themeRoutes);

// Market rating (design-k3 §2.2 / V3-MKT-27): POST /market/ratings(bad は reason 必須)・
// GET /market/users/{actor}/ratings(公開集計 + 低評価フィルタ)。件数モデルは投影で都度再計算。
app.route("/api/v1", marketRatingRoutes);

// Template market (design-k3 §2.2 / V3-MKT-22): POST/GET /market/templates・
// POST /market/templates/{id}/fork。ranking は RANKING_WEIGHTS・fork は forked_from 連結。
app.route("/api/v1", marketTemplateRoutes);

// Pricing / golden-flow / shipping (design-k3 §2.2 / V3-MKT-23/25/20): POST /market/
// listings/draft・GET price-recommendation(embedding 既定 OFF)・GET shipping-estimate
// (住所非保持・着払い)・POST /me/post-offices。純関数 + 薄い route。
app.route("/api/v1", marketPricingRoutes);

// PII セッション (design-c5 K2 §1.1 / V3-SEC-07 / route 045): POST /api/v1/settings/
// pii-session。保護・非永続(maskPii を返すのみ・Truth へ生 PII を append しない)。
app.route("/api/v1", piiRoutes);

// Individual system (design-k1 §1.1 / V3-IND-01/02/04/12/13/15/21): individuals
// master / parents(血統) / pedigree / cross / name / brand-templates / bio-card /
// qr-batch / authenticity / life-events. All protected (not in PUBLIC_ROUTES).
app.route("/api/v1", individualRoutes);

// Taxon system (design-k1 §1.1 / V3-IND-19): species / morphs / aliases +
// alias-candidates(決定論類似度提案). put-if-absent 409. All protected.
app.route("/api/v1", taxonRoutes);

// Tag two-layer (design-k1 §1.1 / V3-OBS-63/07/52): POST/GET /api/v1/tags. Frozen
// tag-event append; ai/user layers derived at aggregate read. All protected.
app.route("/api/v1", tagRoutes);

// Match preference learning (design-k1 §1.1 / V3-IND-07): POST /api/v1/match/
// preference · GET /api/v1/match/ranking. w←w+α·y·x; score non-exposed. Protected.
app.route("/api/v1", matchRoutes);

// Clutch(匿名プール・count層) system (V3-AIP-101 C7 スライス2 / wireframes-core5
// §F3/F4): POST/GET /clutches(+/{id})・POST /clutches/{id}/events(recount/
// attrition)・POST /clutches/{id}/promote(個体化). Individual IDはpromote時に
// 初めて発生。current_countは常駐カウンタなし都度再計算。All protected.
app.route("/api/v1", clutchRoutes);

// Batch commit (V3-AIP-101 C7 スライス2 / wireframes-core5 §F4/F5「まとめて記録」):
// POST /observation/batch-commit — capture/life-event/clutch-event/move を1保存で
// 逐次append(トランザクション無し・per-item {ok,id}|{ok:false,error}で部分失敗を
// 隠さない・上限200件)。All protected.
app.route("/api/v1", batchCommitRoutes);

// Observation devices (design-k1 §1.1 / V3-OBS-31): POST/GET /api/v1/devices +
// /devices/{id}/test. Placement-bound (individual → 400); api key AES-GCM encrypted.
app.route("/api/v1", deviceRoutes);

// POST /events — append an event envelope to Truth (R2, INSERT ONLY).
// 201 inserted / 400 invalid envelope / 409 duplicate key (first-wins,
// storage-enforced: docs/planning/c1/r2-put-if-absent-evidence.md).
// V3-AUT-17 (本人スコープ): the STORED envelope's provenance.actor_id is
// force-stamped to the session principal — a client-forged provenance.actor_id
// is overwritten before persistence, never trusted. Response echoes the same.
// Social eval + platinum vote (design-k3 §2.2 / V3-KRM-20/25): POST /social/eval・
// GET /components/{node_id}/eval（統計のみ・公式ランキング非生成）・POST /social/
// platinum-votes・GET /proposals/{id}/votes（公開合計 + 内訳・閾値到達で昇格候補化）。
app.route("/api/v1", socialRoutes);

// Research proposals (design-k3 §2.2 / V3-KRM-24): POST /proposals・/proposals/{id}/
// fork（rank=beginner 自動）・/proposals/{id}/transition（rank/hypothesis 状態機械・
// trust=支持/(支持+否定) 収束）。reduceProposal 投影で都度再計算。
app.route("/api/v1", proposalRoutes);

// Profile + integrated status (design-k3 §2.2 / V3-KRM-21/04/16): GET /me/profile・
// /users/{actor}/profile（3 指標個別・研究スコアは Contribution 配下・BAN 公開表示）・
// GET /me/status（統合ステータス + append-only 履歴の読取投影・GUI 編集は後波）。
app.route("/api/v1", profileRoutes);

// GitHub webhook (design-k3 §2.5 / V3-KRM-13): POST /github/webhook。session 層 public
// （PUBLIC_ROUTES）+ HMAC self-gate。行動→pt+axis 換算（config weights・policy 経由）を
// contribution_event に delivery_id キーで put-if-absent（重複 delivery=409 べき等）。
app.route("/api/v1", githubWebhookRoutes);

// Research CMS content (design-k5 §2.1 / V3-WIK-16/13/14/17・PPR-03/30): POST/GET
// /research/content(+/:id)・/:id/tags(+/suggest)・POST /research/search・POST
// /research/shared・GET /research/chat-index。論文/記事/ブログ/chat/新聞を単一
// ihl.research.content.v1 で兼用。「投稿=即検索可能」は prefix scan 投影で満たす（維持型
// 二次インデックス不要・不変条項①）。3 層タグは frozen tag-event(target_type=cross)再利用・
// AI 提案は非永続で確認 POST のみ append。全て protected・書込 actor_id はセッション principal。
app.route("/api/v1", researchContentRoutes);

// Paper Match / Gap / Hypothesis (design-k5 §2.1 / V3-PPR-01/06/30): POST /research/
// paper-match(条件P×観測の照合 + Data Descriptor 自動充填)・POST /research/gap(全種族横断
// ギャップ抽出・embedding 既定 OFF)・POST /research/content/:id/hypothesis(仮説を別 content
// イベントとして append・INSERT ONLY)。判定は paper-match.ts 純関数・LLM OFF 既定は静的ヒント 1 行。
// researchContentRoutes の後に登録(hypothesis は content-routes に無いので fall-through で拾う)。
app.route("/api/v1", paperMatchRoutes);

// Project Hub / Ver 分岐 / bestVersion / citation / 再解析マニフェスト / bundle
// (design-k5 §2.1 / V3-PPR-16/18/09): POST/GET /research/projects(+/:id)・POST /:id/versions
// (parent_project_id を持つ新 project row で Ver 分岐・別スキーマ不要)・GET /:id/best-version
// (Ver 別観測集計から決定論選定・同点 version_label 昇順)・POST /research/citations(引用の
// append-only 記録・status=updated は別イベント・報酬は grantPlatinum(contribution_rebate) 再利用)・
// GET /research/content/:id/reanalysis-manifest(事実キーのみ・画像バイナリ非含)・GET /:id/bundle。
// 全て protected・書込 actor_id はセッション principal。GET /:id/... はセグメント数が多く
// researchContentRoutes の GET /research/content/:id を侵さない(fall-through で本 route が拾う)。
app.route("/api/v1", projectRoutes);

// Canonical mapping / Category (design-k5 §2.1 / V3-PPR-13): POST/GET /research/canonical/
// mapping(+/:qid)・POST/GET /research/categories。Wikidata Q番号↔専門 DB 対応を append-only
// 記録(qid__target_db 合成キー・再 put=409)+ ユーザー追加可能な学術分類階層(domain 必須・親子木)。
// 外部専門 API の実クエリは §6 人間ゲート—route は DOMAIN_API_MAP オフライン対応表を読むだけ。
// 全て protected・書込 actor_id はセッション principal。
app.route("/api/v1", researchCanonicalRoutes);

// Research agent batch (design-k5 §2.1 / V3-PPR-17・WIK-01): POST/GET /research/tasks・POST
// /research/agent/run(日次蒸留+タスク生成+新聞生成の単発手動トリガ)・GET /research/newspaper・
// GET /research/wiki/:node_id。全生成物は決定論キー(sha1)で append(同一入力→同一ノード冪等)・
// board_summary→big_wiki 階層・新聞は content_type=newspaper・LLM 既定 OFF でスキップ。全て
// protected。Cron 定期配線(wrangler.toml [triggers] crons)は §6 人間ゲート—手動 route + scheduled
// 実体までを納品。scheduled は下の dispatcher が NEWSPAPER_CRON_UTC で本日次バッチへ振り分ける。
app.route("/api/v1", researchAgentBatchRoutes);

// Source ingest (design-k7 FND-18 / V3-FND-18 / route-matrix infra-route-058..065):
// POST/GET /placements・POST/POST/GET /device-bindings(+/end)・POST/GET /occupancy・
// POST /telemetry。全て protected(PUBLIC_ROUTES 非登録)・書込 actor_id はセッション
// principal 強制・TruthStore put-if-absent(INSERT ONLY)。telemetry は 1 分行→5 分
// バケット冪等マージ(written/skipped_duplicate/skipped_invalid)。
app.route("/api/v1", sourceRoutes);

// Environment CSV import (V3-OBS-32 / OQ-LB-02): POST /api/v1/obs/env-import
// (汎用列マッピング・SwitchBotプリセット・200,000行/16MB上限・put-if-absent冪等)・
// GET /api/v1/obs/telemetry/latest(read-back投影・同一論理bucketのsource-count最大
// を採用)。All protected(PUBLIC_ROUTES 非登録)。既存 FND-18 telemetry bucket infra
// (source-routes.ts)を bucketキーにsource segmentを足す形で再利用・別実装しない。
app.route("/api/v1", envImportRoutes);

// AI kernel A90 (design-k7 FND-21 / V3-FND-21 / route-matrix infra-route-066): POST
// /ai/:task。protected。既定 AI_DISABLED(501・IHL_AI_PROVIDER 未設定=LLM OFF・不変
// 条項①)。未知 task→404。実プロバイダ鍵投入は人間ゲート(本 route は呼ばない)。
app.route("/api/v1", aiRoutes);

app.post("/events", async (c) => {
  const body = await c.req.json().catch(() => null);
  const actorId = c.get("actorId");
  if (body && typeof body === "object" && typeof (body as { provenance?: unknown }).provenance === "object" && (body as { provenance?: unknown }).provenance) {
    (body as { provenance: Record<string, unknown> }).provenance.actor_id = actorId;
  }
  const result = await new TruthStore(c.env.TRUTH).putEvent(body);
  if (result.status === "invalid") {
    return c.json({ error: "INVALID_ENVELOPE", details: result.errors }, 400);
  }
  if (result.status === "conflict") {
    return c.json({ error: "DUPLICATE_EVENT", key: result.key }, 409);
  }
  return c.json({ key: result.key, actor_id: actorId }, 201);
});

// C5 cron 配線(design-k3 §2.6 + design-k5 §2.1)。Worker ランタイムは default export の
// { fetch, scheduled } を見る。Hono app は既に .fetch を持つので、ここに .scheduled を
// 付けて export default app のまま両立させる(テストが依存する app.request を保持する形)。
// dispatcher は event.cron で振り分ける: NEWSPAPER_CRON_UTC("0 21 * * *" = JST06:00)は K5 の
// 日次蒸留/タスク生成/新聞バッチ(handleResearchScheduled)へ、それ以外は既存 K3 月次バッチ
// (handleScheduled は "0 15 * * *" 日次起動を受け 25 日基準で月次分岐)へ。既存月次を壊さない。
// cron は wrangler.toml [triggers] 宣言 + config/consented-crons.json 承認まで配線済で、
// デプロイ(=実行開始 = 常駐トークン消費)は §6 人間ゲート(本クラスタは crons を触らない)。
async function scheduledDispatch(
  event: { scheduledTime?: number; cron?: string },
  env: Bindings,
  ctx?: unknown,
): Promise<void> {
  if (event?.cron === NEWSPAPER_CRON_UTC) {
    await handleResearchScheduled(event, env);
    return;
  }
  await handleScheduled(event, env, ctx);
}
(app as unknown as { scheduled: typeof scheduledDispatch }).scheduled = scheduledDispatch;

export default app;
