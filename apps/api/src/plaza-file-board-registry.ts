// V3-BBS-16 — 開発掲示板はOS/システムのフォルダ構造・ファイル構成と同じ階層・同粒度で
// 用意する(レイヤー分類ボード B=柔軟設計/P=ファイル連携/V=リリース運用フェーズ)。
// 【R136/S2】F-2具体化(第1波前倒し): 議論単位はページ(screen_id)に加えてコード機能単位
// (APIルートファイル/モジュール等の実在粒度)でもchannelを持てる。機能単位の一覧は
// 機械可読索引(この索引)で管理する。索引整備が第1波の範囲(登録channelへの実スレ投稿の
// 網羅は第2波)。掲示板そのものは既存 plaza-routes.ts の channel 機構をそのまま使い、
// 新規投稿型・新規常駐DBは作らない(reuse-first)。
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { projectChannelThreads } from "./plaza-routes";

export const FILE_BOARD_LAYERS = ["B", "P", "V"] as const; // B=柔軟設計 / P=ファイル連携 / V=リリース運用フェーズ
export type FileBoardLayer = (typeof FILE_BOARD_LAYERS)[number];

// V層(リリース/運用フェーズ)に属すると判断したモジュール(バッチ/検収/外部同期)。
const V_LAYER_MODULES = new Set([
  "batch", "batch-commit-routes", "costs-routes", "truth-backup-connector", "research-agent-batch",
  "github-webhook-routes", "gmo-webhook",
]);

// classifyFileBoardLayer — モジュール名から決定論的にレイヤーを導出(純関数)。
// *-routes/*-connector/*-webhook = P(ファイル連携=外部/HTTP境界)、V層モジュールは明示リスト、
// それ以外(定数/純ロジック)= B(柔軟設計)。
export function classifyFileBoardLayer(moduleName: string): FileBoardLayer {
  if (V_LAYER_MODULES.has(moduleName)) return "V";
  if (moduleName.endsWith("-routes") || moduleName.endsWith("-connector") || moduleName.endsWith("-webhook")) return "P";
  return "B";
}

// fileBoardChannel — plaza channel 名の決定論的導出(post/channel は既存の自由文字列
// フィールドなのでスキーマ変更不要)。
export function fileBoardChannel(moduleName: string): string {
  return `dev:${moduleName}`;
}

export interface FileBoardEntry {
  module: string;
  layer: FileBoardLayer;
  channel: string;
}

// KNOWN_API_MODULES — R0731 w1-plaza 実測(apps/api/src/*.ts の実在モジュール名。
// .d.ts/*.test.ts/index.ts(不可侵)は除外。Glob実測 2026-07-31。捏造禁止=実在ファイル
// のみ列挙。Workers ランタイムは fs 走査不可のため静的スナップショットとして保持し、
// 新規モジュール追加時はここへ追記する(docs/knowledge の index.md と同じ「保存と索引は
// 不可分」原則・WIK-05 と同型の運用規律)。
export const KNOWN_API_MODULES = [
  "account", "ai-digest-routes", "ai-kernel", "auth-routes", "authz",
  "batch", "batch-commit-routes",
  "clutch-routes", "collector-routes", "consent-routes", "contribution", "contribution-routes",
  "costs-routes", "csv-import", "culture", "cusb-routes",
  "denylist", "device-routes",
  "economy-constants", "engagement-routes", "env", "env-import-routes",
  "fee-routes", "freetext-parser",
  "github-issues-connector", "github-webhook-routes", "gmo-connector", "gmo-routes", "gmo-webhook",
  "gov-routes",
  "handle-routes", "hmac", "home-routes",
  "individual-routes", "intent",
  "key-bundle-routes", "knowledge-graph", "knowledge-graph-routes", "knowledge-lint", "knowledge-lint-routes",
  "knowledge-timeline-routes", "kv",
  "ledger-audit-routes", "ledger-routes",
  "mail", "market-block-routes", "market-comment-routes", "market-flag-routes", "market-individual-offer-routes",
  "market-payment-guidance-routes", "market-pricing-routes", "market-rating-routes",
  "market-reservation-routes", "market-routes", "market-settlement", "market-template-routes",
  "market-transactions-view", "match-routes",
  "observation-constants", "observation-routes",
  "paper-match", "paper-match-routes", "payjp-connector", "pii-routes", "plaza-constants",
  "plaza-file-board-registry", "plaza-github-routes", "plaza-routes", "plaza-rules-routes",
  "policy", "profile-routes", "project-routes", "proposal-routes",
  "rate-limit", "reference-counter", "research-agent-batch", "research-canonical-routes",
  "research-constants", "research-content-routes", "research-ec-adapter", "research-store-routes",
  "sandbox-routes", "session", "settings-routes", "shop-routes", "social-routes", "source-routes",
  "tag-routes", "taxon-routes", "telemetry-merge", "theme-routes", "thumbnail", "thumbnail-wasm-workers",
  "truth-backup-connector",
  "ui-constants",
] as const;

// buildFileBoardRegistry — 索引エントリ生成(純関数)。呼び手が独自のモジュール一覧を
// 渡せば拡張可能(既定は KNOWN_API_MODULES)。
export function buildFileBoardRegistry(moduleNames: readonly string[] = KNOWN_API_MODULES): FileBoardEntry[] {
  return moduleNames
    .slice()
    .sort()
    .map((module) => ({ module, layer: classifyFileBoardLayer(module), channel: fileBoardChannel(module) }));
}

export const plazaFileBoardRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /plaza/file-board/registry — 機械可読索引(BBS-16)。
plazaFileBoardRoutes.get("/plaza/file-board/registry", (c) => c.json({ registry: buildFileBoardRegistry() }));

// GET /plaza/file-board/:module/threads — モジュール単位channelのスレ一覧。既存
// projectChannelThreads をそのまま再利用(新規投影を作らない)。
plazaFileBoardRoutes.get("/plaza/file-board/:module/threads", async (c) => {
  const moduleName = c.req.param("module");
  const s = new TruthStore(c.env.TRUTH);
  return c.json(await projectChannelThreads(s, fileBoardChannel(moduleName)));
});
