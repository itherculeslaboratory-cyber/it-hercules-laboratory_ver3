// FORK (創る) ゾーンのクライアント配線。テンプレート市場 = GET/POST /market/templates
// + /fork(MKT-22・market-template-routes.ts 実在)、UI テンプレ保存 = POST /builder/canvas
// (ihl.ui.template.v1・theme-routes.ts 実在)。renderer.tsx の defaultExecute と同じ
// same-origin(/api/v1/...)+ credentials:"include" 規約で叩く(HttpOnly セッション cookie
// を流すため)。誇張ゼロ: 返ってきたフィールドだけを扱い、無ければ空配列。
import { apiUrl, unwrapEnvelope } from "@/lib/api";

// GET /market/templates が返す1行(rankTemplates の投影・fork グラフ由来 fork_count/score・
// V3-MKT-47実装でlike_count=ihl.ui.vote.v1投影projectTemplateVotesのlikesを追加)。
export interface RankedTemplate {
  template_id: string;
  actor_id: string;
  kind: string;
  title: string;
  forked_from?: string;
  fork_count: number;
  like_count: number;
  score: number;
}

// ULID: packages/truth/src/ulid.ts と同じアルゴリズム(48bit msタイムスタンプ+80bit乱数,
// Crockford Base32)。apps/web は @ihl/truth(ajv依存のサーバ専用パッケージ)をブラウザ
// バンドルへ引き込みたくないため最小関数だけ複製する(research/truth-query-save.ts の
// 既存複製と同型・新規npm依存の追加はしない)。
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(now: number = Date.now()): string {
  let t = now;
  let ts = "";
  for (let i = 0; i < 10; i++) {
    ts = ULID_ALPHABET[t % 32] + ts;
    t = Math.floor(t / 32);
  }
  let rnd = "";
  for (const b of crypto.getRandomValues(new Uint8Array(16))) {
    rnd += ULID_ALPHABET[b & 31];
  }
  return ts + rnd;
}

// 出品種別 kind(schema enum)→ 画面に出す平易語(語彙辞書遵守・内部 enum は出さない)。
const KIND_LABEL: Record<string, string> = {
  paper: "論文",
  ui_skin: "UIスキン",
  graph: "グラフ",
  weights: "重み",
  ai_pack: "AIパック",
  prompt: "プロンプト",
};
export const PUBLISH_KINDS = Object.keys(KIND_LABEL);
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(apiUrl(path), { credentials: "include", ...init });
  if (!res.ok) throw new Error(`api ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? unwrapEnvelope(await res.json()) : undefined;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export async function listMarketTemplates(): Promise<RankedTemplate[]> {
  const body = (await call("/api/v1/market/templates")) as { templates?: unknown } | undefined;
  return Array.isArray(body?.templates) ? (body.templates as RankedTemplate[]) : [];
}

export async function publishTemplate(kind: string, title: string): Promise<{ template_id: string }> {
  return call("/api/v1/market/templates", jsonInit("POST", { kind, title })) as Promise<{ template_id: string }>;
}

export async function forkTemplate(id: string, title?: string): Promise<{ template_id: string }> {
  const body = title ? { title } : {};
  return call(`/api/v1/market/templates/${encodeURIComponent(id)}/fork`, jsonInit("POST", body)) as Promise<{
    template_id: string;
  }>;
}

// V3-MKT-47(w2-market2実装): いいねは新規typed routeを作らず、UIテンプレのlike/platinum
// 投票と同じ既存の自己サービスPOST /events(ihl.ui.vote.v1・target_kind="template")を
// そのまま叩く(design-k4 route-matrix凍結の踏襲=apps/api/src/index.ts
// SELF_SERVICE_EVENT_TYPES。二重いいねは投影側projectTemplateVotesが(actor,target,kind)
// dedupで1票に畳むため、クライアント側での二重送信ガードは不要)。actor_idはPOST
// /events側でセッションprincipalへ強制上書きされるが、schema上data.actor_idは必須
// (minLength 1)のため取得する(research/zones/search.tsxのhandleSaveToTruthと同型)。
export async function likeTemplate(templateId: string): Promise<void> {
  const me = (await call("/api/v1/me/profile")) as { actor_id?: string } | undefined;
  const actorId = me?.actor_id;
  if (!actorId) throw new Error("actor_id not available (not signed in?)");
  const now = new Date().toISOString();
  const voteId = ulid();
  const envelope = {
    specversion: "1.0",
    id: voteId,
    source: "apps/web",
    type: "ihl.ui.vote.v1",
    time: now,
    dataschema: "schemas/events/ui-vote.schema.json",
    provenance: { generator_kind: "human", actor_id: actorId },
    data: {
      vote_id: voteId,
      actor_id: actorId,
      target_kind: "template",
      target_id: templateId,
      vote_kind: "like",
      created_at: now,
      schema_version: "1",
    },
  };
  // POST /events は apps/api/src/index.ts で /api/v1 プレフィックス無しに直接マウントされて
  // いる(research/truth-query-save.ts の既存クライアントと同じ経路をそのまま踏襲)。
  const res = await fetch("/events", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`like failed: ${res.status} ${JSON.stringify(errBody)}`);
  }
}

// POST /builder/canvas。ui-template.schema.json は additionalProperties:false のため、
// 送れるのは name / level / social / screen_overrides / parent_template_id / theme_pack_id
// のみ(template_id/actor_id/created_at/schema_version はサーバが刻む)。組んだ画面ツリーは
// screen_overrides[screen_id] = ScreenDef として載せる。fork 元があれば parent_template_id
// で系譜連結(ui-template schema 既存フィールド)。
export interface SaveCanvasPayload {
  name: string;
  level: "default" | "recommended" | "custom";
  social?: { author_name?: string };
  screen_overrides?: Record<string, unknown>;
  parent_template_id?: string;
}
export async function saveCanvas(payload: SaveCanvasPayload): Promise<{ template_id: string }> {
  return call("/api/v1/builder/canvas", jsonInit("POST", payload)) as Promise<{ template_id: string }>;
}

// (あ) 既存画面の fork 支援。/fork/screens は同一オリジンの Next Route Handler
// (screen-defs/*.json のファイル読み・認証不要)。誇張ゼロ: 返った物だけ扱う。
export interface ForkableScreen {
  id: string;
  title: string;
}
export async function listForkableScreens(): Promise<ForkableScreen[]> {
  const res = await fetch("/fork/screens", { credentials: "include" });
  if (!res.ok) throw new Error(`api ${res.status}`);
  const body = (await res.json()) as { screens?: unknown };
  return Array.isArray(body.screens) ? (body.screens as ForkableScreen[]) : [];
}
export async function getScreenDef(id: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/fork/screens?id=${encodeURIComponent(id)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`api ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}
