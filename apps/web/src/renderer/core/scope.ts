import { apiUrl, unwrapEnvelope } from "@/lib/api";
import { ApiError, mapError } from "@/lib/error-messages";
import type { Execute, HeaderScope, ResolveMessage, Scope } from "./context";
import type { ScreenNode } from "../types";

// individual-routes.ts の既存 ?species=(大小無視完全一致)/?lineage_id=(完全
// 一致)クエリへ HeaderScope をそのまま流し込む共通ビルダー(未選択の軸は
// 付けない="" 全体を表す)。空スコープは "" を返す(既存の無引数呼び出しと
// バイト同一になる=デフォルト挙動を壊さない)。
export function headerScopeQuery(scope: HeaderScope): string {
  const params = new URLSearchParams();
  if (scope.species) params.set("species", scope.species);
  if (scope.lineageId) params.set("lineage_id", scope.lineageId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// headerScopeQuery を「既にクエリ文字列を持つ path」にも安全に足すための第2
// スライス用ヘルパー(KnowledgeHubNode の `${path}?q=...` 等と衝突しない)。
// path が "?" を含まなければ headerScopeQuery と同じ "?a=b" を、含んでいれば
// "&a=b" を足す。scope が空なら path をそのまま返す(既存呼び出しとバイト同一)。
export function appendHeaderScope(path: string, scope: HeaderScope): string {
  const q = headerScopeQuery(scope);
  if (!q) return path;
  return path.includes("?") ? `${path}&${q.slice(1)}` : `${path}${q}`;
}

// Resolve a node's display string: prefer the i18n catalog value for `keyVal`,
// else the literal, else `fallback`. Empty catalog hits fall through to literal.
export function displayText(
  resolve: ResolveMessage,
  keyVal: unknown,
  literal: unknown,
  fallback: string,
): string {
  if (keyVal != null) {
    const m = resolve(String(keyVal));
    if (m != null && m !== "") return m;
  }
  return literal != null ? String(literal) : fallback;
}

// V3-UIX-03: turn a thrown error into calm Japanese copy. An ApiError maps by
// status code (never the raw "api <n>" line); anything else uses its message.
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return mapError(e.code);
  return (e as Error)?.message ?? String(e);
}

/** Any node in the tree matching `pred` (recursive, depth-first). */
export function anyField(nodes: ScreenNode[] | undefined, pred: (n: ScreenNode) => boolean): boolean {
  for (const n of nodes ?? []) {
    if (pred(n)) return true;
    if (anyField(n.children, pred)) return true;
  }
  return false;
}
export const isRequiredField = (n: ScreenNode) => n.type === "field" && n.props?.required === true;
export const isRequiredCheckbox = (n: ScreenNode) =>
  isRequiredField(n) && n.props?.variant === "checkbox";

/** Live validity of a mounted form: every required control is filled/checked. */
export function scanFormValidity(form: HTMLFormElement): boolean {
  return Array.from(form.querySelectorAll("[data-required='true']")).every((el) => {
    if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked;
    const v = (el as HTMLInputElement | HTMLSelectElement).value;
    return String(v ?? "").trim() !== "";
  });
}

/** Resolve a dotted path (`measurements.0.value`) against a value. */
export function getPath(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

/** Replace `{{ dotted.path }}` in `tpl` with values from `scope`. */
export function interpolate(tpl: string, scope: unknown): string {
  // ponytail: [\w.-]+ (not just \w.) so hyphenated path segments (e.g.
  // data.lab-env-current) resolve instead of riding through as a raw
  // "{{...}}" literal — confirmed bug on obs-detail/placement-qr (V3-OBS-72).
  return tpl.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, p: string) => {
    const v = getPath(scope, p);
    return v == null ? "" : String(v);
  });
}

/** Assign into a nested object, creating arrays for numeric segments. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] == null) cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

// V3-AIP-101 観測登録スライス1: static injects a body field is-literal today
// (obs-entry's "measurements.0.kind":"number"). resolveStatic additionally lets
// a static VALUE carry a `{{...}}` scope template (e.g. "individual/{{params.id}}")
// or the literal token "{{now}}" (server time isn't known at screen-def-authoring
// time). A templated value that resolves empty (an unset optional query param) is
// OMITTED rather than sent as "" — so an optional measurement slot with no input
// doesn't ride to the API as a malformed empty-value entry.
// Nests via setPath (same dotted-array/object convention FormData submission
// uses) so a caller can spread the result straight into a request body — the
// F6 schedule button's "template.stage_interval_days.unspecified" key needs
// the same {template:{stage_interval_days:{unspecified:N}}} shape a form's own
// dotted field names produce.
export function resolveStatic(stat: Record<string, unknown>, scope: Scope): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stat)) {
    if (typeof v === "string" && v.includes("{{")) {
      const resolved = v.trim() === "{{now}}" ? new Date().toISOString() : interpolate(v, scope);
      if (resolved === "") continue;
      setPath(out, k, resolved);
    } else {
      setPath(out, k, v);
    }
  }
  return out;
}

/** Latest numeric value for `item` across capture-shaped rows (sorted by
 *  capture_id — a ULID, so ascending = chronological). `excludeCaptureId` skips
 *  the just-saved capture on a post-commit screen, so "previous" excludes itself. */
export function latestMeasurement(
  observations: unknown,
  item: string,
  excludeCaptureId?: string,
): number | null {
  const rows = (Array.isArray(observations) ? observations : []) as Record<string, unknown>[];
  const sorted = rows
    .filter((r) => !excludeCaptureId || r.capture_id !== excludeCaptureId)
    .slice()
    .sort((a, b) => String(a.capture_id ?? "").localeCompare(String(b.capture_id ?? "")));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const ms = Array.isArray(sorted[i].measurements) ? (sorted[i].measurements as Record<string, unknown>[]) : [];
    for (const m of ms) {
      if (m.item !== item) continue;
      const n = typeof m.value === "number" ? m.value : Number(m.value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// "前回 X〈unit〉  +Δ〈unit〉↑" comparison line shared by FieldNode (live, as the
// user types — F2) and the text node's compare_* props (static recap — F6).
// `current: null` (nothing typed/known yet) renders the previous value alone.
export function compareLine(
  scope: Scope,
  opts: { source?: unknown; item?: unknown; unit?: unknown; exclude?: unknown; current: number | null },
): string {
  const source = opts.source ? String(opts.source) : "";
  const item = opts.item ? String(opts.item) : "";
  if (!source || !item) return "";
  const unit = opts.unit != null ? String(opts.unit) : "";
  const exclude = opts.exclude ? interpolate(String(opts.exclude), scope) : "";
  const history = getPath(scope, `data.${source}.observations`);
  const prev = latestMeasurement(history, item, exclude || undefined);
  if (prev == null) return "初回の記録です";
  if (opts.current == null || !Number.isFinite(opts.current)) return `前回 ${prev}${unit}`;
  const delta = opts.current - prev;
  const sign = delta > 0 ? "+" : delta < 0 ? "" : "±";
  const arrow = delta > 0 ? "↑" : delta < 0 ? "▼" : "";
  return `前回 ${prev}${unit}　${sign}${delta.toFixed(1)}${unit}${arrow}`;
}

/** Current life-stage: the latest molt/eclosion life-event's detail.to_stage
 *  (individual_id's timeline, at-sorted defensively — projectIndividual already
 *  sorts, but a raw scope path might not). null = no stage recorded yet. */
export function currentStage(timeline: unknown): string | null {
  const rows = (Array.isArray(timeline) ? timeline : []) as Record<string, unknown>[];
  const sorted = rows.slice().sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    if (e.kind === "molt" || e.kind === "eclosion") {
      const d = e.detail as Record<string, unknown> | undefined;
      if (d && typeof d.to_stage === "string") return d.to_stage;
    }
  }
  return null;
}

// V3-AIP-101 磨き直し fix#11: format an ISO/epoch scope value into a plain
// "2026-08-11" date — the ONLY date formatter in the renderer (fix#2/#10 reuse
// it too), so no raw ISO/Z ever reaches the screen. Invalid/empty input → "".
export function formatDateJa(value: unknown): string {
  const d = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today + `days`, as a Date (local time) — F5/F6's client-computed "次の目安". */
export function todayPlusDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// F2ステージ表示(fix#5/#8): shared by BadgeNode (standalone) and DisclosureNode
// (the F2 header chip trigger) so the timeline→stage→label lookup lives ONE
// place, not hand-copied per consumer.
export function stageBadgeText(
  scope: Scope,
  deriveFrom: unknown,
  stageLabels: unknown,
  emptyText: unknown,
): { text: string; hasStage: boolean } {
  const stage = currentStage(getPath(scope, String(deriveFrom)));
  const labels = (stageLabels as Record<string, string> | undefined) ?? {};
  const text = stage ? (labels[stage] ?? stage) : String(emptyText ?? "ステージ未記録");
  return { text, hasStage: !!stage };
}

export function readQuery(): Record<string, string> {
  if (typeof window === "undefined") return {};
  return Object.fromEntries(new URLSearchParams(window.location.search).entries());
}

// screen_id → real route. `home` is served at "/", every other def at "/s/<id>".
export function screenHref(to: string, query?: Record<string, string>): string {
  const base = to === "home" ? "/" : `/s/${to}`;
  const qs = query && Object.keys(query).length ? "?" + new URLSearchParams(query).toString() : "";
  return base + qs;
}

// Scalar form fields for the next screen's {{params.*}} display. Nested values
// (measurements) ride the sessionStorage draft instead — this is display only.
export function queryFromBody(body: Record<string, unknown>): Record<string, string> {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === "string" || typeof v === "number") q[k] = String(v);
  }
  return q;
}

// Common id-ish response fields worth carrying into the next screen as query.
export function queryFromResult(result: unknown): Record<string, string> {
  const r = (result ?? {}) as Record<string, unknown>;
  const q: Record<string, string> = {};
  if (typeof r.token === "string") q.token = r.token;
  if (typeof r.capture_id === "string") q.id = r.capture_id;
  else if (typeof r.individual_id === "string") q.id = r.individual_id;
  // c8 market-trade/dispute: a create action's response id is what the next
  // load of the SAME screen needs on the query string to refetch the right
  // record (self-navigate transitions are how this renderer "refreshes").
  if (typeof r.listing_id === "string") q.listing_id = r.listing_id;
  if (typeof r.dispute_id === "string") q.dispute_id = r.dispute_id;
  return q;
}

// Build the fetch init for an api action + body. A body carrying a Blob (the
// photo File) is sent as multipart/form-data (browser sets the boundary); every
// other body is JSON. GET carries no body.
export function requestInit(method: string, body?: Record<string, unknown>): RequestInit {
  const init: RequestInit = { method, credentials: "include" };
  if (method === "GET" || body === undefined) return init;
  const hasBlob = Object.values(body).some((v) => v instanceof Blob);
  if (hasBlob) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(body)) fd.append(k, v instanceof Blob ? v : String(v));
    init.body = fd;
  } else {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return init;
}

export function defaultExecute(onNavigate?: (to: string, query?: Record<string, string>) => void): Execute {
  return async (action, body) => {
    if (action.kind === "navigate") {
      if (onNavigate) onNavigate(action.to);
      else if (typeof window !== "undefined") window.location.assign(screenHref(action.to));
      return undefined;
    }
    const res = await fetch(apiUrl(action.path), requestInit(action.method, body));
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      // V3-AUT-20: read the server's machine-readable `error` code (when the
      // body is JSON) so mapError() can give distinct copy per code instead of
      // only per HTTP status; falls back to the status when absent/unparsable.
      const errBody = ct.includes("application/json") ? await res.json().catch(() => null) : null;
      const code =
        errBody && typeof errBody === "object" && typeof (errBody as { error?: unknown }).error === "string"
          ? (errBody as { error: string }).error
          : res.status;
      throw new ApiError(code);
    }
    return ct.includes("application/json") ? unwrapEnvelope(await res.json()) : undefined;
  };
}
