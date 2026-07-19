// FORK (創る) ゾーンのクライアント配線。テンプレート市場 = GET/POST /market/templates
// + /fork(MKT-22・market-template-routes.ts 実在)、UI テンプレ保存 = POST /builder/canvas
// (ihl.ui.template.v1・theme-routes.ts 実在)。renderer.tsx の defaultExecute と同じ
// same-origin(/api/v1/...)+ credentials:"include" 規約で叩く(HttpOnly セッション cookie
// を流すため)。誇張ゼロ: 返ってきたフィールドだけを扱い、無ければ空配列。
import { apiUrl } from "@/lib/api";

// GET /market/templates が返す1行(rankTemplates の投影・fork グラフ由来 fork_count/score)。
export interface RankedTemplate {
  template_id: string;
  actor_id: string;
  kind: string;
  title: string;
  forked_from?: string;
  fork_count: number;
  score: number;
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
  return ct.includes("application/json") ? res.json() : undefined;
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

// POST /builder/canvas。ui-template.schema.json は additionalProperties:false のため、
// 送れるのは name / level / social / screen_overrides / parent_template_id / theme_pack_id
// のみ(template_id/actor_id/created_at/schema_version はサーバが刻む)。組んだ画面ツリーは
// screen_overrides[screen_id] = ScreenDef として載せる。
export interface SaveCanvasPayload {
  name: string;
  level: "default" | "recommended" | "custom";
  social?: { author_name?: string };
  screen_overrides?: Record<string, unknown>;
}
export async function saveCanvas(payload: SaveCanvasPayload): Promise<{ template_id: string }> {
  return call("/api/v1/builder/canvas", jsonInit("POST", payload)) as Promise<{ template_id: string }>;
}
