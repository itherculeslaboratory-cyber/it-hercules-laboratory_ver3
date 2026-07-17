"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/cn";
import { apiUrl } from "@/lib/api";
import { ApiError, mapError } from "@/lib/error-messages";
import { shouldOfferTranslation, translateOnDemand } from "@/lib/ugc-translate";
import { makeResolver, type Catalogs } from "@/lib/i18n-resolve";
import { clearDraft, loadDraft, saveDraft } from "./draft";
import {
  clearBatch,
  loadBatchDraft,
  loadBatchResults,
  loadPreselect,
  saveBatchDraft,
  saveBatchResults,
  savePreselect,
  type BatchCommitItem,
  type BatchDraft,
  type BatchGroup,
  type BatchResult,
  type BatchResults,
  type DraftRow,
  type ScheduleTarget,
} from "./batch-draft";
import type { Action, ScreenDef, ScreenNode, Transition } from "./types";

/* -------------------------------------------------------------------------- *
 * Runtime scope + action execution.
 *
 * The renderer is data-driven: screens bind to live API data instead of
 * hardcoding it. Three scopes feed `{{...}}` interpolation and list binding:
 *   - params : URL query (?id=…) — the runtime individual/capture id.
 *   - data   : responses of node `source_path` GETs, keyed by node id.
 *   - result : the parsed response of the last successful action.
 * Individual catalog parts read these via context; screens stay declarative
 * and never wire a11y/state/data-fetch by hand.
 * -------------------------------------------------------------------------- */

export type Execute = (
  action: Action,
  body?: Record<string, unknown>,
) => Promise<unknown>;

export type Scope = {
  params: Record<string, string>;
  data: Record<string, unknown>;
  result: Record<string, unknown>;
  // c8 UI磨き第2弾#1(受領10「買い手/売り手だけ表示」): GET /me/profile を
  // Renderer が一度だけ取得し {{viewer.actor_id}} として全ノードへ公開する —
  // `when` プリミティブが役割(買い手/売り手/スレ主)を判定する唯一の材料。
  // 未ログイン/取得失敗時は {}（`when` は単に false 側に倒れる・エラーにしない）。
  viewer: Record<string, unknown>;
};

type DataSink = {
  setNodeData: (id: string, value: unknown) => void;
  setActionResult: (value: unknown) => void;
};

const ExecuteCtx = createContext<Execute>(async () => undefined);
const InvalidCtx = createContext<Set<string>>(new Set());
const ScopeCtx = createContext<Scope>({ params: {}, data: {}, result: {}, viewer: {} });
const TransitionsCtx = createContext<Transition[]>([]);
const NavigateCtx = createContext<(to: string, query?: Record<string, string>) => void>(
  () => {},
);
const DataSinkCtx = createContext<DataSink>({
  setNodeData: () => {},
  setActionResult: () => {},
});
// V3-AUT-06: reactive submit gate. A submit button reads this; outside a gated
// form it defaults to true (no reactive disable), so only consent forms gate.
const FormValidityCtx = createContext<boolean>(true);

// I18-08: text_key -> string resolver. The catalog + fallback chain live in
// lib/i18n (P5); the Renderer only calls resolve(key). Default is a no-op so
// screens using literal text render unchanged and tests can inject a resolver.
export type ResolveMessage = (key: string) => string | undefined;
export const MessagesCtx = createContext<ResolveMessage>(() => undefined);
// I18-06: viewer locale for the on-device UGC translate affordance. authored
// language is ja, so that is the default when i18n has not set one.
export const LocaleCtx = createContext<string>("ja");

// Resolve a node's display string: prefer the i18n catalog value for `keyVal`,
// else the literal, else `fallback`. Empty catalog hits fall through to literal.
function displayText(
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
function errorText(e: unknown): string {
  if (e instanceof ApiError) return mapError(e.code);
  return (e as Error)?.message ?? String(e);
}

/** Any node in the tree matching `pred` (recursive, depth-first). */
function anyField(nodes: ScreenNode[] | undefined, pred: (n: ScreenNode) => boolean): boolean {
  for (const n of nodes ?? []) {
    if (pred(n)) return true;
    if (anyField(n.children, pred)) return true;
  }
  return false;
}
const isRequiredField = (n: ScreenNode) => n.type === "field" && n.props?.required === true;
const isRequiredCheckbox = (n: ScreenNode) =>
  isRequiredField(n) && n.props?.variant === "checkbox";

/** Live validity of a mounted form: every required control is filled/checked. */
function scanFormValidity(form: HTMLFormElement): boolean {
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
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, p: string) => {
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
function resolveStatic(stat: Record<string, unknown>, scope: Scope): Record<string, unknown> {
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
function compareLine(
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
function todayPlusDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// F2ステージ表示(fix#5/#8): shared by BadgeNode (standalone) and DisclosureNode
// (the F2 header chip trigger) so the timeline→stage→label lookup lives ONE
// place, not hand-copied per consumer.
function stageBadgeText(
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

function readQuery(): Record<string, string> {
  if (typeof window === "undefined") return {};
  return Object.fromEntries(new URLSearchParams(window.location.search).entries());
}

// screen_id → real route. `home` is served at "/", every other def at "/s/<id>".
function screenHref(to: string, query?: Record<string, string>): string {
  const base = to === "home" ? "/" : `/s/${to}`;
  const qs = query && Object.keys(query).length ? "?" + new URLSearchParams(query).toString() : "";
  return base + qs;
}

// Scalar form fields for the next screen's {{params.*}} display. Nested values
// (measurements) ride the sessionStorage draft instead — this is display only.
function queryFromBody(body: Record<string, unknown>): Record<string, string> {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === "string" || typeof v === "number") q[k] = String(v);
  }
  return q;
}

// Common id-ish response fields worth carrying into the next screen as query.
function queryFromResult(result: unknown): Record<string, string> {
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
function requestInit(method: string, body?: Record<string, unknown>): RequestInit {
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

function defaultExecute(onNavigate?: (to: string, query?: Record<string, string>) => void): Execute {
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
    return ct.includes("application/json") ? await res.json() : undefined;
  };
}

/* -------------------------------------------------------------------------- *
 * Catalog v0 — 12 types (design-c2 §4.2). Semantic classes only; all color and
 * every one of the 7 states live in globals.css (.civ-interactive layer).
 * -------------------------------------------------------------------------- */

function props(node: ScreenNode): Record<string, unknown> {
  return node.props ?? {};
}

// Normalize a props.options-style list ("g" | {value,label}) into {value,label}.
type Opt = { value: string; label: string };
function toOptions(raw: unknown): Opt[] {
  return ((raw as Array<Record<string, unknown> | string>) ?? []).map((o) =>
    typeof o === "string"
      ? { value: o, label: o }
      : { value: String(o.value ?? ""), label: String(o.label ?? o.value ?? "") },
  );
}

// Fetch node.props.source_path (GET) on mount, store the response at data[id].
function useSource(node: ScreenNode) {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const execute = useContext(ExecuteCtx);
  const { setNodeData } = useContext(DataSinkCtx);
  const path = p.source_path ? interpolate(String(p.source_path), scope) : "";
  useEffect(() => {
    if (!path) return;
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path }))
      .then((r) => {
        if (alive && r !== undefined) setNodeData(node.id, r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
}

// Run a node action: interpolate api paths against scope, capture the result,
// then follow a matching transition (api actions only — navigate self-routes).
function useRunAction(nodeId: string) {
  const execute = useContext(ExecuteCtx);
  const scope = useContext(ScopeCtx);
  const transitions = useContext(TransitionsCtx);
  const navigate = useContext(NavigateCtx);
  const { setActionResult } = useContext(DataSinkCtx);
  return useCallback(
    async (action: Action, body?: Record<string, unknown>, file?: File | null) => {
      // A form whose action is a navigate is the 3-screen-confirm carry (OBS-25):
      // stash the shaped body + photo so the next screen's commit can replay it
      // (survives the full-page reload), and put scalar fields on the query for
      // {{params.*}} display. A plain button navigate (no body) keeps the old
      // single-arg execute path so test/onAction observers see the raw action.
      if (action.kind === "navigate") {
        if (body === undefined) {
          await execute(action);
        } else {
          await saveDraft(body, file ?? null);
          navigate(action.to, queryFromBody(body));
        }
        return;
      }
      // An api action can replay the pending confirm draft (body_from:"draft"):
      // the confirm screen's commit button carries no inline body, so pull the
      // shaped body + photo the entry form stashed on navigate.
      let effBody = body;
      let effFile = file ?? null;
      const fromDraft = action.body_from === "draft";
      if (fromDraft) {
        const d = await loadDraft();
        if (d) {
          // A caller that already shaped its own body (a form with its own
          // fields/static — e.g. F5's opt-out checkbox, V3-AIP-101) wins per-key
          // over the replayed draft; the draft only backfills what the caller
          // didn't provide. obs-confirm's plain-button case (body undefined) is
          // unchanged: effBody just becomes d.body as before.
          effBody = { ...d.body, ...(effBody ?? {}) };
          effFile = effFile ?? d.file;
        }
      }
      const act: Action = { ...action, path: interpolate(action.path, scope) };
      // Keep the single-arg call shape when there is no body (buttons), so
      // action executors observed in tests see exactly the action.
      const result = effBody === undefined ? await execute(act) : await execute(act, effBody);
      if (result && typeof result === "object") setActionResult(result);
      // Two-stage photo upload (design-c2 §3.2): the create action returns an
      // id first, then — if the form carried a photo — the file is POSTed as
      // multipart against that id, BEFORE the transition unmounts us.
      // capture_id (observation) and listing_id (c8磨き第2弾#2 market-trade
      // listing photo) are the two ids this rides today — not a generic
      // upload-config engine; add another id key here if a third screen needs
      // it (no screen-def has needed more than these two so far).
      const captureId = (result as Record<string, unknown> | undefined)?.capture_id;
      const uploadListingId = (result as Record<string, unknown> | undefined)?.listing_id;
      if (effFile && typeof captureId === "string") {
        await execute(
          { kind: "api", method: "POST", path: "/api/v1/observation/upload" },
          { capture_id: captureId, file: effFile },
        );
      } else if (effFile && typeof uploadListingId === "string") {
        await execute(
          { kind: "api", method: "POST", path: `/api/v1/market/listings/${uploadListingId}/photo` },
          { file: effFile },
        );
      }
      if (fromDraft) clearDraft();
      const t = transitions.find((x) => x.from === nodeId);
      // Scalar request-body fields ride forward too (not just the response) —
      // the next screen's confirm/done recap reads them via {{params.*}} (V3-AIP-101,
      // same trick queryFromBody already does for the navigate-kind branch above).
      // queryFromResult is spread last so an id/token in the response always wins
      // a key collision with a same-named request field.
      if (t) navigate(t.to_screen_id, { ...queryFromBody(effBody ?? {}), ...queryFromResult(result) });
    },
    [execute, scope, transitions, navigate, setActionResult, nodeId],
  );
}

function Children({ nodes }: { nodes?: ScreenNode[] }) {
  return (
    <>
      {(nodes ?? []).map((c) => (
        <NodeView key={c.id} node={c} />
      ))}
    </>
  );
}

function ButtonNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const run = useRunAction(node.id);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(p.error ? String(p.error) : null);
  // V3-AIP-101 zero-tap registration (F6 "次の目安"): props.auto fires this
  // button's action once on mount instead of waiting for a click; `done` swaps
  // the button for a status line once it succeeds.
  const [done, setDone] = useState(false);
  const formValid = useContext(FormValidityCtx);
  const loading = pending || p.loading === true;
  const isSubmit = (p.type ?? "button") === "submit";
  // V3-AUT-06: a submit inside a gated (consent) form is disabled from first
  // paint until the form is valid — before any input event fires.
  const disabled = p.disabled === true || loading || (isSubmit && !formValid);

  const fire = useCallback(async () => {
    const action = node.action;
    if (!action) return;
    setError(null);
    setPending(true);
    try {
      const stat = p.static as Record<string, unknown> | undefined;
      // V3-AIP-101 磨き直し fix#12: a navigate action's `to` may carry a
      // "{{...}}" scope template (same convention "link" nodes' href already
      // uses), e.g. "obs-register-entry?id={{params.individual_id}}" — the
      // interpolated string rides straight through screenHref's literal
      // concat, so a bare id-carrying navigate button needs no new plumbing.
      const act: Action = action.kind === "navigate" ? { ...action, to: interpolate(action.to, scope) } : action;
      await run(act, stat ? resolveStatic(stat, scope) : undefined);
      setDone(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }, [node.action, run, p.static, scope]);

  const onClick = useCallback(() => {
    if (disabled) return;
    void fire();
  }, [disabled, fire]);

  const firedRef = useRef(false);
  useEffect(() => {
    if (!p.auto || firedRef.current || !node.action) return;
    // auto_when gates the fire: a scope template that resolves empty/"false"/
    // "off" skips it — the F5 opt-out checkbox rides here as a query param
    // (present="on" when checked, absent when unchecked → resolves "").
    if (p.auto_when !== undefined) {
      const v = interpolate(String(p.auto_when), scope);
      if (!v || v === "false" || v === "off") return;
    }
    firedRef.current = true;
    void fire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (p.auto && done) {
    // V3-AIP-101 磨き直し fix#11: success_label_date_from points at a scope
    // path (e.g. "result.next_observation_at") whose value is a server ISO
    // timestamp — never interpolated raw. It's formatted (formatDateJa) and
    // exposed to the SAME interpolate() call as a synthetic `date` field, so
    // success_label just writes "{{date}} 頃" — no new template syntax.
    const dateFrom = p.success_label_date_from;
    const successScope = dateFrom
      ? { ...scope, date: formatDateJa(getPath(scope, String(dateFrom))) }
      : scope;
    const successText = interpolate(
      displayText(resolve, p.success_label_key, p.success_label, "登録しました"),
      successScope,
    );
    return (
      <p className="civ-text" role="status">
        {successText}
      </p>
    );
  }

  return (
    <>
      <button
        type={(p.type as "button" | "submit") ?? "button"}
        className={cn("civ-interactive", "civ-button")}
        data-variant={String(p.variant ?? "primary")}
        data-compact={p.compact === true || undefined}
        data-loading={loading || undefined}
        aria-busy={loading || undefined}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        data-invalid={error ? true : undefined}
        aria-invalid={error ? true : undefined}
        onClick={node.action ? onClick : undefined}
      >
        {displayText(resolve, p.label_key, p.label, node.id)}
      </button>
      {error && (
        <span role="alert" className="civ-field-error">
          {error}
        </span>
      )}
    </>
  );
}

// V3-OBS-19 WorkflowContext(観測コンテキスト)— client-only 縮退版。種族
// (species_candidate)+発育段階(life_stage_candidate)を1度決めたら次の観測
// 画面の既定値だけをプリフィルする(taxonomy確定は常にユーザー・購読/検索/
// テンプレ横断スコープの本体設計は要件全文どおり後波)。visit-tracker/
// recent-chips と同じ localStorage 縮退パターン(新 Truth 型なし)。
const WORKFLOW_CONTEXT_KEY = "ihl:obs-workflow-context";
function readWorkflowContext(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(WORKFLOW_CONTEXT_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? (obj as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function writeWorkflowContext(patch: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKFLOW_CONTEXT_KEY, JSON.stringify({ ...readWorkflowContext(), ...patch }));
  } catch {
    /* ignore — best-effort prefill only */
  }
}

function FieldNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const invalidCtx = useContext(InvalidCtx);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const variant = String(p.variant ?? "text");
  const name = String(p.name ?? node.id);
  const required = p.required === true;
  const invalid = p.invalid === true || invalidCtx.has(name);
  const id = `field-${node.id}`;
  // V3-OBS-19 WorkflowContext(観測コンテキスト・client-only 縮退): workflow_key
  // を持つフィールドは空欄のまま初回描画し(SSR/ハイドレーション安全)、マウント
  // 後に一度だけ localStorage の前回値を imperative に流し込む(未入力の時の
  // み・既定値プリフィルのみでオートサブミットはしない・ユーザーはいつでも
  // 上書きできる・taxonomy確定は常にユーザーのまま変わらない)。
  const workflowKey = p.workflow_key != null ? String(p.workflow_key) : "";
  const wfRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  useEffect(() => {
    if (!workflowKey) return;
    const el = wfRef.current;
    if (!el || el.value) return;
    const ctx = readWorkflowContext();
    if (ctx[workflowKey]) el.value = ctx[workflowKey];
  }, [workflowKey]);
  // V3-AIP-101 "前回値とΔ" (F2 live, obs-register-entry): a number field with
  // compare_source (another node's fetched `{source}.observations`) + compare_item
  // renders the previous value below the input and, as the user types, the delta.
  // liveValue is display-only state — the input stays uncontrolled for submit.
  const [liveValue, setLiveValue] = useState("");
  const compareSource = p.compare_source;
  const liveNum = Number(liveValue);
  const hasLive = liveValue !== "" && Number.isFinite(liveNum);
  const compareText = compareSource
    ? compareLine(scope, {
        source: compareSource,
        item: p.compare_item,
        unit: p.compare_unit,
        exclude: p.compare_exclude,
        current: hasLive ? liveNum : null,
      })
    : "";
  // V3-AIP-101 磨き直し fix#10: label_date_offset_days lets a field's label
  // carry a client-computed "today+N days" via the SAME {{date}} convention
  // ButtonNode's success_label_date_from uses (fix#11) — one date formatter,
  // two call sites. No API round-trip for a value that's pure arithmetic.
  const dateOffsetDays = p.label_date_offset_days;
  const labelScope =
    dateOffsetDays != null ? { ...scope, date: formatDateJa(todayPlusDays(Number(dateOffsetDays))) } : scope;
  const labelText = interpolate(displayText(resolve, p.label_key, p.label, name), labelScope);

  const shared = {
    id,
    name,
    className: "civ-input",
    "data-required": required || undefined,
    "aria-required": required || undefined,
    "aria-invalid": invalid || undefined,
    "data-invalid": invalid || undefined,
  } as const;

  let control: React.ReactNode;
  if (variant === "segmented") {
    // V3-OBS-18: a horizontal toggle group. Native radios (FormData picks the
    // checked one, no JS state needed) styled as buttons. One option is checked
    // from first paint (props.default or the first), so a `required` segmented
    // is always satisfied and its value always rides the submit body.
    const options = toOptions(p.options);
    const def = p.default != null ? String(p.default) : options[0]?.value ?? "";
    control = (
      <div className="civ-segmented" role="radiogroup" aria-label={displayText(resolve, p.label_key, p.label, name)}>
        {options.map((o) => (
          <label key={o.value} className="civ-segment">
            <input
              type="radio"
              name={name}
              value={o.value}
              defaultChecked={o.value === def}
              data-required={required || undefined}
              aria-required={required || undefined}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    );
  } else if (variant === "select") {
    const options = (p.options as Array<Record<string, unknown> | string>) ?? [];
    control = (
      <select {...shared} ref={workflowKey ? (wfRef as React.RefObject<HTMLSelectElement>) : undefined} defaultValue="">
        <option value="" disabled>
          {String(p.placeholder ?? "選択してください")}
        </option>
        {options.map((o) => {
          const value = typeof o === "string" ? o : String(o.value ?? "");
          const label = typeof o === "string" ? o : String(o.label ?? value);
          return (
            <option key={value} value={value}>
              {label}
            </option>
          );
        })}
      </select>
    );
  } else if (variant === "photo") {
    // V3-AIP-101 磨き直し fix#7: a labeled/styled field instead of a bare
    // <input type=file> — icon + input row, same .civ-input border/height as
    // every other control (no drastic redesign, just not naked).
    return (
      <div className="civ-field">
        <label className="civ-label" htmlFor={id}>
          {labelText}
          {required ? " *" : ""}
        </label>
        <div className="civ-field-photo">
          <span className="civ-field-photo-icon" aria-hidden="true">
            📷
          </span>
          <input {...shared} type="file" accept="image/*" />
        </div>
      </div>
    );
  } else if (variant === "checkbox") {
    // V3-AIP-101 磨き直し fix#10: a styled labeled row (custom check mark via
    // CSS — no raw hex, tokens only) replacing the browser-default checkbox.
    // data-required='true' means "must be checked"; scanFormValidity + the
    // submit-time missing scan (unchecked => fd.get null) both cover it.
    // props.default:true = checked from first paint (F5's opt-out-by-default
    // "次の目安を登録" checkbox, V3-AIP-101). labelText may carry a
    // client-computed {{date}} (label_date_offset_days, see above).
    return (
      <div className="civ-field">
        <label className="civ-checkbox-row" htmlFor={id}>
          <input {...shared} type="checkbox" defaultChecked={p.default === true} />
          <span className="civ-label">{labelText}</span>
        </label>
        {invalid && (
          <span role="alert" className="civ-field-error">
            {String(p.error ?? "この項目を確認してください")}
          </span>
        )}
      </div>
    );
  } else if (variant === "hidden") {
    // Carries a scope value forward through a navigate/draft hop (e.g. the
    // individual id from F2 to F5) so a later screen's `static` can reference
    // {{params.*}} without the user re-entering it. No visible label/wrapper.
    return <input {...shared} type="hidden" value={interpolate(String(p.default ?? ""), scope)} readOnly />;
  } else if (variant === "textarea") {
    // c8 knowledge-thread: multi-line reply/description bodies. Same
    // .civ-input treatment as every other control (no bespoke styling) —
    // only the element differs.
    control = (
      <textarea
        {...shared}
        rows={Number(p.rows ?? 4)}
        placeholder={p.placeholder ? String(p.placeholder) : undefined}
        defaultValue={p.default != null ? interpolate(String(p.default), scope) : undefined}
      />
    );
  } else {
    control = (
      <input
        {...shared}
        ref={workflowKey ? (wfRef as React.RefObject<HTMLInputElement>) : undefined}
        type={variant === "number" ? "number" : variant === "date" ? "date" : "text"}
        placeholder={p.placeholder ? String(p.placeholder) : undefined}
        defaultValue={p.default != null ? interpolate(String(p.default), scope) : undefined}
        onChange={compareSource ? (e) => setLiveValue(e.target.value) : undefined}
      />
    );
  }

  return (
    <div className="civ-field">
      <label className="civ-label" htmlFor={id}>
        {labelText}
        {required ? " *" : ""}
      </label>
      {control}
      {compareText && (
        <p className="civ-text" data-muted="true">
          {compareText}
        </p>
      )}
      {invalid && (
        <span role="alert" className="civ-field-error">
          {String(p.error ?? "この項目を確認してください")}
        </span>
      )}
    </div>
  );
}

function FormNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const run = useRunAction(node.id);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(p.error ? String(p.error) : null);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  // V3-AUT-06: a form carrying a required consent checkbox gates its submit
  // reactively (disabled from first paint until valid). Text-only forms are not
  // gated, so their submit-time field-error path (below) is unchanged.
  // ponytail: gate trigger is "has a required checkbox"; extend if more consent
  // shapes appear. Initial validity is false while any required field is unset
  // (no field carries a default value/checked today).
  const gated = useMemo(() => anyField(node.children, isRequiredCheckbox), [node]);
  const [reactiveValid, setReactiveValid] = useState(
    () => !anyField(node.children, isRequiredField),
  );
  const formValid = gated ? reactiveValid : true;
  const onFormChange = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => setReactiveValid(scanFormValidity(e.currentTarget)),
    [],
  );

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      const missing = new Set<string>();
      form.querySelectorAll("[data-required='true']").forEach((el) => {
        const n = el.getAttribute("name");
        if (n && !String(fd.get(n) ?? "").trim()) missing.add(n);
      });
      setInvalidFields(missing);
      if (missing.size) {
        setFormError("必須項目を入力してください");
        return;
      }
      setFormError(null);
      if (!node.action) return;
      // Shape the request body to the API contract: static injects first
      // (e.g. measurement.kind, species_confirmed_by), then dotted field names
      // (`measurements.0.item`) nest into the arrays the schema requires.
      const body: Record<string, unknown> = {};
      const stat = p.static as Record<string, unknown> | undefined;
      if (stat) Object.assign(body, resolveStatic(stat, scope));
      // Split the form: text fields nest into the JSON body; a non-empty file
      // field (the photo) rides separately so run() can do the 2-stage upload.
      // ponytail: one photo per capture (design-c2 §3.1) — first file wins.
      let file: File | null = null;
      fd.forEach((v, k) => {
        if (typeof v === "string") {
          if (v.trim() === "") return;
          // A `variant:"number"` field renders <input type="number">, but
          // FormData always yields strings — coerce back to a JS number so
          // downstream numeric checks (typeof value === "number", e.g.
          // TimelineRow/measureValue) see a real number, not "65".
          const el = form.elements.namedItem(k);
          const isNumber = el instanceof HTMLInputElement && el.type === "number";
          setPath(body, k, isNumber ? Number(v) : v);
        } else if (v instanceof File && v.size > 0 && !file) {
          file = v;
        }
      });
      // V3-OBS-19 WorkflowContext 書き込み側: carry_to_workflow に挙げた
      // フィールド名の値だけを localStorage へ退避し、次の観測画面の
      // workflow_key プリフィルに使う(送信内容そのものは変えない)。
      const carry = p.carry_to_workflow as string[] | undefined;
      if (carry?.length) {
        const patch: Record<string, string> = {};
        for (const k of carry) {
          const v = getPath(body, k);
          if (typeof v === "string" && v) patch[k] = v;
          else if (typeof v === "number" && Number.isFinite(v)) patch[k] = String(v);
        }
        if (Object.keys(patch).length) writeWorkflowContext(patch);
      }
      setPending(true);
      try {
        await run(node.action, body, file);
      } catch (err) {
        setFormError(errorText(err));
      } finally {
        setPending(false);
      }
    },
    [node.action, run, p.static, scope],
  );

  return (
    <form
      className="civ-form"
      aria-busy={pending || undefined}
      data-loading={pending || undefined}
      onSubmit={onSubmit}
      onChange={gated ? onFormChange : undefined}
      noValidate
    >
      <FormValidityCtx.Provider value={formValid}>
        <InvalidCtx.Provider value={invalidFields}>
          <Children nodes={node.children} />
        </InvalidCtx.Provider>
      </FormValidityCtx.Provider>
      {formError && (
        <p role="alert" className="civ-form-error">
          {formError}
        </p>
      )}
    </form>
  );
}

function ListNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  useSource(node);
  const scope = useContext(ScopeCtx);

  // Data-bound list: repeat the item template over a bound array. Each element
  // is the interpolation scope for `item_text` (e.g. "{{measurements.0.item}}").
  if (p.bind_items) {
    const items = (getPath(scope, String(p.bind_items)) as unknown[]) ?? [];
    // V3-UIX-03: an honest empty state instead of a blank list.
    if (items.length === 0 && p.empty_text) {
      return <p className="civ-empty">{String(p.empty_text)}</p>;
    }
    const textTpl = p.item_text ? String(p.item_text) : "";
    const imgTpl = p.item_image ? String(p.item_image) : "";
    const altTpl = p.item_alt ? String(p.item_alt) : "";
    // c8磨き第2弾#5: item_actor_field names a ROW key holding an actor_id (e.g.
    // dispute's messages "actor_id", market-trade board's "from") — rendered
    // via the actor 表示プリミティブ ahead of item_text instead of the raw id
    // string (author display name, fallback short hash).
    const actorField = p.item_actor_field ? String(p.item_actor_field) : "";
    return (
      <ul className="civ-list">
        {items.map((it, i) => (
          <li key={i}>
            <article className="civ-card">
              {actorField && <ActorLabel actorId={String(getPath(it, actorField) ?? "")} />}
              {textTpl && <p className="civ-text">{interpolate(textTpl, it)}</p>}
              {imgTpl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="civ-image" src={interpolate(imgTpl, it)} alt={interpolate(altTpl, it)} />
              )}
            </article>
          </li>
        ))}
      </ul>
    );
  }

  const children = node.children ?? [];
  if (children.length === 0 && p.empty_text) {
    return <p className="civ-empty">{String(p.empty_text)}</p>;
  }
  return (
    <ul className="civ-list">
      {children.map((c) => (
        <li key={c.id}>
          <NodeView node={c} />
        </li>
      ))}
    </ul>
  );
}

// A card may carry props.source_path: it GETs on mount and stores the response
// at data[node.id], so children can read scalar fields via {{data.<id>.…}}.
// (Lists bind arrays; cards surface the same fetch for single-object screens
// like obs-detail's summary and qr-resume's token→individual resolve.)
//
// A層(c7 ui-parity-map §2-2 リッチカード): additive rich props on the SAME
// "card" node type (upper-compat — a plain card with none of these props
// renders exactly as before). icon is a literal glyph (no icon lib dependency
// — see renderer.test.tsx/design notes), title/meta interpolate against the
// full scope like heading/text do, badges[] reuses <Badge>, and a chevron nav
// affordance renders only when the node itself carries an `action` (unused by
// CardNode until now — action is a generic ScreenNode field per the schema).
function CardNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  useSource(node);
  const scope = useContext(ScopeCtx);
  const resolve = useContext(MessagesCtx);
  const run = useRunAction(node.id);
  const children = node.children ?? [];
  const bindText = p.bind_text ? String(p.bind_text) : "";
  const icon = p.icon != null ? String(p.icon) : "";
  const title = interpolate(displayText(resolve, p.title_key, p.title, ""), scope);
  const meta = p.meta != null ? interpolate(displayText(resolve, p.meta_key, p.meta, ""), scope) : "";
  const badges = (p.badges as Array<Record<string, unknown>> | undefined) ?? [];
  // V3-AIP-101 磨き直し fix#5/#8: a `disclosure` child marked props.badge_row
  // rides INSIDE the same badges flex row as the decorative species badge —
  // the stage chip must be tappable while card's own badges[] stay inert, so
  // the interactive trigger is a normal child rendered in-row instead of a
  // fork of the badges[] shape. Every other child renders below as usual.
  const badgeRowChildren = children.filter((c) => c.type === "disclosure" && c.props?.badge_row === true);
  const restChildren = children.filter((c) => !(c.type === "disclosure" && c.props?.badge_row === true));
  if (children.length === 0 && !bindText && !title && p.empty_text) {
    return <p className="civ-empty">{String(p.empty_text)}</p>;
  }
  // props.bind_text renders the card's OWN fetched object (data[node.id]), so
  // bare fields ({{karma_value}}, {{listing.title}}) resolve against the
  // source_path response — the single-object twin of a list's bind_items.
  return (
    <article className="civ-card">
      {p.draft ? <span className="civ-draft-badge">草案</span> : null}
      {(icon || title) && (
        <div className="civ-card-head">
          {icon && (
            <span className="civ-card-icon" aria-hidden="true">
              {icon}
            </span>
          )}
          {title && <h3 className="civ-card-title">{title}</h3>}
        </div>
      )}
      {meta && (
        <p className="civ-text" data-muted="true">
          {meta}
        </p>
      )}
      {(badges.length > 0 || badgeRowChildren.length > 0) && (
        <div className="civ-card-badges">
          {badges.map((b, i) => (
            <Badge
              key={i}
              // fix#8: badge text now interpolates against the full scope
              // (species: "{{data.individual.master.species}}") — a literal
              // badge with no "{{" is unaffected (interpolate is a no-op).
              text={interpolate(displayText(resolve, b.text_key ?? b.label_key, b.text ?? b.label, ""), scope)}
              tone={b.tone != null ? String(b.tone) : undefined}
            />
          ))}
          {badgeRowChildren.map((c) => (
            <NodeView key={c.id} node={c} />
          ))}
        </div>
      )}
      {bindText ? (
        <p className="civ-text">
          {interpolate(bindText, getPath(scope, `data.${node.id}`) ?? {})}
        </p>
      ) : null}
      <Children nodes={restChildren} />
      {node.action && (
        <button
          type="button"
          className={cn("civ-interactive", "civ-button", "civ-card-nav-btn")}
          data-variant="ghost"
          aria-label={displayText(resolve, p.nav_label_key, p.nav_label, "開く")}
          onClick={() => run(node.action!)}
        >
          ›
        </button>
      )}
    </article>
  );
}

// Status badge / chip tone (§2-3): success/warning/caution/neutral, mapped
// onto the existing --civ-primary/--civ-danger/--civ-danger-bg/--civ-text-muted
// tokens (no new hex — check-ui-tokens forbids it). warning is filled danger,
// caution is outlined danger (same hue, lower urgency); success is outlined
// primary; neutral (default/unknown tone) is the muted outline.
// V3-UIX-04: 色は意味のみ(緑=成功/赤=失敗/青=情報/黄=注意)。caution/info はそれぞれ
// 専用トークン(--civ-caution*/--civ-info*)を持ち、caution が danger(失敗)と混同され
// ないようにする(旧実装は同色だった)。
type Tone = "success" | "warning" | "caution" | "info" | "neutral";
const TONES: readonly Tone[] = ["success", "warning", "caution", "info", "neutral"];
function Badge({ text, tone }: { text: string; tone?: string }) {
  const t: Tone = TONES.includes(tone as Tone) ? (tone as Tone) : "neutral";
  return (
    <span className="civ-badge" data-tone={t}>
      {text}
    </span>
  );
}

function BadgeNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  // V3-AIP-101 F2 ステージ表示: derive_from points at a timeline array (life
  // events); the badge shows the current stage (latest molt/eclosion) via a
  // JSON-authored label map, so the vocabulary/labels stay in the screen-def,
  // not hardcoded in the renderer. No timeline yet ⇒ empty_text.
  if (p.derive_from) {
    const { text, hasStage } = stageBadgeText(scope, p.derive_from, p.stage_labels, p.empty_text);
    return <Badge text={text} tone={hasStage ? String(p.tone ?? "neutral") : "neutral"} />;
  }
  const text = interpolate(displayText(resolve, p.text_key, p.text ?? p.label, ""), scope);
  return <Badge text={text} tone={p.tone != null ? String(p.tone) : undefined} />;
}

// Progress bar / gauge (§2-4). value/max accept a literal number or a
// "{{...}}" template resolved against scope (so a screen can bind a fetched
// count without a dedicated bind_* prop, same trick heading/text use).
function numFromProp(raw: unknown, scope: Scope): number {
  if (typeof raw === "number") return raw;
  const n = Number(interpolate(String(raw ?? "0"), scope));
  return Number.isFinite(n) ? n : 0;
}
function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className="civ-progress"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label || undefined}
    >
      <div className="civ-progress-track">
        <div className="civ-progress-fill" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
    </div>
  );
}
function ProgressNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const value = numFromProp(p.value, scope);
  const max = p.max != null ? numFromProp(p.max, scope) : 100;
  const label = displayText(resolve, p.label_key, p.label, "");
  const showValue = p.show_value !== false;
  return (
    <div className="civ-progress-field">
      {label && <span className="civ-label">{label}</span>}
      <ProgressBar value={value} max={max} label={label || undefined} />
      {showValue && (
        <span className="civ-progress-value">{Math.round((value / (max || 1)) * 100)}%</span>
      )}
    </div>
  );
}

// Multi-column data table (§2-1, the biggest single fix — the main cause of
// the "table collapses to a 1-line list" density loss per ui-parity-map §0).
// Rows bind the same way a list does (source_path fetch + bind_items dotted
// path); columns are declarative ({key,label,cell}) so a column can render its
// cell as plain text, a Badge, or a ProgressBar without any per-screen code.
function useBoundItems(node: ScreenNode): unknown[] {
  useSource(node);
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const path = p.bind_items ? String(p.bind_items) : "";
  if (!path) return [];
  return (getPath(scope, path) as unknown[]) ?? [];
}
function renderCell(col: Record<string, unknown>, row: unknown): React.ReactNode {
  const key = String(col.key ?? "");
  const value = getPath(row, key);
  const cell = String(col.cell ?? "text");
  if (cell === "badge") {
    const tone =
      col.tone != null
        ? String(col.tone)
        : col.tone_key != null
          ? String(getPath(row, String(col.tone_key)) ?? "neutral")
          : "neutral";
    // c8 knowledge-thread consensus/divisive columns are booleans (Polis
    // decision, not free text) — true_label/false_label give them Japanese
    // copy instead of showing the raw "true"/"false" string.
    const text =
      typeof value === "boolean"
        ? String(value ? (col.true_label ?? "true") : (col.false_label ?? "false"))
        : String(value ?? "");
    return <Badge text={text} tone={tone} />;
  }
  if (cell === "progress") {
    const n = Number(value ?? 0);
    return <ProgressBar value={Number.isFinite(n) ? n : 0} max={Number(col.max ?? 100)} />;
  }
  if (cell === "date") {
    return formatDateJa(value) || "—";
  }
  if (cell === "actor") {
    // c8#5: an actor_id column (e.g. market-trade's bids-table "bidder") shows
    // the display name (fallback short hash) instead of the raw id string.
    return value ? <ActorLabel actorId={String(value)} /> : "—";
  }
  if (cell === "observed") {
    // V3-AIP-101 磨き直し fix#2: date + a representative measurement in one
    // column ("2026-07-11・82.5g") — col.key is the date field, col.measurement_key
    // the summary string field (both come straight off GET /individuals).
    const dateStr = formatDateJa(value);
    if (!dateStr) return "—";
    const measure = col.measurement_key ? getPath(row, String(col.measurement_key)) : undefined;
    return measure != null && measure !== "" ? `${dateStr}・${measure}` : dateStr;
  }
  if (cell === "link") {
    // V3-AIP-101: a row-level navigate affordance (bind_items has no per-item
    // action hook otherwise). href_tpl interpolates against the ROW (list/
    // image-grid item templates use the same row-as-scope convention).
    const href = interpolate(String(col.href_tpl ?? ""), row);
    return (
      <a className="civ-link" href={href}>
        {String(col.link_label ?? "開く")}
      </a>
    );
  }
  return value == null ? "" : String(value);
}
function TableNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const items = useBoundItems(node);
  const columns = (p.columns as Array<Record<string, unknown>>) ?? [];
  if (items.length === 0 && p.empty_text) {
    return <p className="civ-empty">{String(p.empty_text)}</p>;
  }
  return (
    // c8: a mobile-width (390px) viewport clips trailing columns without a
    // scroll wrapper — this affects every table-node screen, not just c8's,
    // so the fix lives at the shared node rather than per-screen.
    <div className="civ-table-scroll">
      <table className="civ-table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{displayText(resolve, c.label_key, c.label, String(c.key ?? ""))}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((row, ri) => (
            <tr key={ri}>
              {columns.map((c, ci) => (
                // c8磨き第2弾#7: data-label feeds the <=560px responsive
                // card-mode CSS (globals.css) — each cell shows its own
                // column label via ::before, so a table reflows into a
                // stacked card list instead of a squeezed horizontal scroll
                // (受領10 モバイル「詳細を開く」ボタン潰れの根本対処)。
                <td key={ci} data-label={displayText(resolve, c.label_key, c.label, String(c.key ?? ""))}>
                  {renderCell(c, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Tabs / section switcher (§2-5). props.tabs[] drives the tab strip; each
// child node opts into a tab via props.tab_id — only the active tab's
// children render (unassigned children never show, keeping the contract
// explicit rather than "everything without tab_id always shows").
function TabsNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const tabs = (p.tabs as Array<Record<string, unknown>>) ?? [];
  const rawDefault = p.default_tab != null ? String(p.default_tab) : String(tabs[0]?.id ?? "");
  // c8 market-trade: default_tab may carry a "{{...}}" scope template (e.g.
  // "{{data.state.stage}}") so a screen can auto-select the tab matching
  // server-fetched state (public listing vs. private post-match board). The
  // fetch that fills scope.data is async (useSource resolves after mount), so
  // a plain useState initializer would only ever see the pre-fetch empty
  // value — the effect below re-applies the resolved default once the data
  // arrives, but only until the visitor taps a tab themselves.
  const resolvedDefault = rawDefault.includes("{{") ? interpolate(rawDefault, scope) : rawDefault;
  const [active, setActive] = useState<string>(resolvedDefault || String(tabs[0]?.id ?? ""));
  const touchedRef = useRef(false);
  useEffect(() => {
    if (touchedRef.current) return;
    if (resolvedDefault && tabs.some((t) => String(t.id ?? "") === resolvedDefault) && resolvedDefault !== active) {
      setActive(resolvedDefault);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedDefault]);
  const children = node.children ?? [];
  return (
    <div className="civ-tabs">
      <div className="civ-tab-list" role="tablist">
        {tabs.map((t) => {
          const id = String(t.id ?? "");
          const selected = id === active;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={cn("civ-interactive", "civ-tab")}
              data-active={selected || undefined}
              onClick={() => {
                touchedRef.current = true;
                setActive(id);
              }}
            >
              {displayText(resolve, t.label_key, t.label, id)}
            </button>
          );
        })}
      </div>
      <div className="civ-tab-panel" role="tabpanel">
        {children
          .filter((c) => String(c.props?.tab_id ?? "") === active)
          .map((c) => (
            <NodeView key={c.id} node={c} />
          ))}
      </div>
    </div>
  );
}

// True if ANY "{{path}}" reference in `tpl` resolves to null/"" against
// `scope` — used by ImageGridNode to tell "no photo uploaded yet" (e.g.
// item_image references a row's optional cover_photo_id) apart from "photo
// exists", so a missing photo renders an honest placeholder instead of a
// broken <img src="…/photo/">.
function templateHasMissingRef(tpl: string, scope: unknown): boolean {
  for (const m of tpl.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    const v = getPath(scope, m[1]);
    if (v == null || v === "") return true;
  }
  return false;
}

// V3-OBS-24 類似個体サイドバー: image-grid の bind_items(GET+source_path)は
// POST の類似検索(OBS-11 rerank)を表現できないため、同じ「宣言的語彙で表現し
// きれない専用フェッチ」縮退(individual-profile/growth-chart と同じ扱い)で
// search_path+search_body を足す。bind_items と排他 — 両方指定は search_path
// が勝つ。search_response_path はレスポンス中の配列の位置(例: "individuals"・
// aggregate モードの POST /observation/search 応答)。
function useSearchItems(node: ScreenNode): unknown[] {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const execute = useContext(ExecuteCtx);
  const { setNodeData } = useContext(DataSinkCtx);
  const path = p.search_path ? String(p.search_path) : "";
  const bodyTpl = (p.search_body as Record<string, unknown> | undefined) ?? {};
  const bodyKey = JSON.stringify(bodyTpl);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const body = resolveStatic(bodyTpl, scope);
    Promise.resolve(execute({ kind: "api", method: "POST", path }, body))
      .then((r) => {
        if (alive && r !== undefined) setNodeData(node.id, r);
      })
      .catch(() => {
        /* honest empty state — no match / no embedding yet is not an error to show */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, bodyKey]);
  const stored = getPath(scope, `data.${node.id}`);
  const respPath = p.search_response_path ? String(p.search_response_path) : "";
  const arr = respPath ? getPath(stored, respPath) : stored;
  return Array.isArray(arr) ? arr : [];
}

// Image grid / thumbnail cards (§2-6) — the bind_items twin of ListNode's
// image branch, laid out as a grid instead of a stacked list, each cell
// carrying a meta line + optional Badge. c8磨き第2弾#2(受領10「画像を押せば
// 詳細が出る」): item_href makes the whole card a click-through link — no
// separate "詳細を開く" button to squeeze on mobile. (+ V3-OBS-24 an optional
// per-item navigate button — item_action_screen/item_action_query/
// item_action_label — e.g. a similar-individual card's "引用として見る"
// citation button — item_href and the action button are independent, both
// may be present).
function ImageGridNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const navigate = useContext(NavigateCtx);
  const boundItems = useBoundItems(node);
  const searchItems = useSearchItems(node);
  const items = p.search_path ? searchItems : boundItems;
  if (items.length === 0 && p.empty_text) {
    return <p className="civ-empty">{String(p.empty_text)}</p>;
  }
  const imgTpl = p.item_image ? String(p.item_image) : "";
  const altTpl = p.item_alt ? String(p.item_alt) : "";
  const labelTpl = p.item_label ? String(p.item_label) : "";
  const metaTpl = p.item_meta ? String(p.item_meta) : "";
  const badgeTpl = p.item_badge ? String(p.item_badge) : "";
  const badgeToneTpl = p.item_badge_tone ? String(p.item_badge_tone) : "";
  const hrefTpl = p.item_href ? String(p.item_href) : "";
  // Dynamic tag: <a> when the card navigates, <figure> otherwise — same
  // .civ-thumb-card box either way (see globals.css, tag-agnostic selector).
  const Wrapper = hrefTpl ? "a" : "figure";
  const actionScreen = p.item_action_screen ? String(p.item_action_screen) : "";
  const actionQueryTpl = (p.item_action_query as Record<string, string> | undefined) ?? {};
  const actionLabel = p.item_action_label ? String(p.item_action_label) : "";
  return (
    <div className="civ-image-grid">
      {items.map((rawIt, i) => {
        // V3-OBS-24 スコア%: OBS-11 rerank score is a 0..1 float — a bare
        // {{score}} template can't round/×100, so a rounded score_pct rides
        // the per-item scope alongside the raw fields (additive, no interpolate change).
        const s = (rawIt as Record<string, unknown>)?.score;
        const it = typeof s === "number" && Number.isFinite(s) ? { ...(rawIt as object), score_pct: Math.round(s * 100) } : rawIt;
        return (
        <Wrapper className="civ-thumb-card" key={i} {...(hrefTpl ? { href: interpolate(hrefTpl, it) } : {})}>
          {imgTpl && !templateHasMissingRef(imgTpl, it) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="civ-image" src={interpolate(imgTpl, it)} alt={interpolate(altTpl, it)} />
          ) : (
            imgTpl && (
              <div className="civ-thumb-placeholder" aria-hidden="true">
                📷
              </div>
            )
          )}
          <figcaption>
            {labelTpl && <p className="civ-text">{interpolate(labelTpl, it)}</p>}
            {metaTpl && (
              <p className="civ-text" data-muted="true">
                {interpolate(metaTpl, it)}
              </p>
            )}
            {badgeTpl && (
              <Badge
                text={interpolate(badgeTpl, it)}
                tone={badgeToneTpl ? interpolate(badgeToneTpl, it) : undefined}
              />
            )}
            {actionScreen && actionLabel && (
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant="ghost"
                onClick={() =>
                  navigate(
                    actionScreen,
                    Object.fromEntries(
                      Object.entries(actionQueryTpl).map(([k, v]) => [k, interpolate(String(v), it)]),
                    ),
                  )
                }
              >
                {actionLabel}
              </button>
            )}
          </figcaption>
        </Wrapper>
        );
      })}
    </div>
  );
}

// Stepper — multi-stage progress with the current step highlighted (§2-7).
// props.current is either a 0-based index or a step id (matched against
// steps[].id); steps before it are "done", the match is "current", the rest
// "upcoming".
function StepperNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const steps = (p.steps as Array<Record<string, unknown>>) ?? [];
  // c8 market-trade: `current` may be a "{{...}}" scope template (a literal
  // step id/index straight off fetched data). `current_from` + `current_map`
  // additionally remap a raw fetched value (e.g. the transaction state string
  // "shipped") onto a step index — the same derive_from+labels convention
  // BadgeNode already uses for life-stage, so a many-states→N-steps screen
  // doesn't need N literal step ids matching the backend's state machine 1:1.
  let cur: unknown = p.current;
  if (typeof cur === "string" && cur.includes("{{")) cur = interpolate(cur, scope);
  if (p.current_from) {
    const raw = interpolate(String(p.current_from), scope);
    const map = (p.current_map as Record<string, unknown> | undefined) ?? {};
    cur = raw in map ? map[raw] : raw;
  }
  const currentIndex =
    typeof cur === "number" ? cur : Math.max(0, steps.findIndex((s) => String(s.id ?? "") === String(cur ?? "")));
  return (
    <ol className="civ-stepper">
      {steps.map((s, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
        return (
          <li key={String(s.id ?? i)} className="civ-step" data-state={state}>
            <span className="civ-step-index" aria-hidden="true">
              {i + 1}
            </span>
            <span className="civ-step-label">{displayText(resolve, s.label_key, s.label, String(i + 1))}</span>
          </li>
        );
      })}
    </ol>
  );
}

// KPI / stat tile (§2-8) — a big number + label + optional trend Badge.
// props.value/trend are templates interpolated against scope (like text
// nodes); an optional own source_path feeds {{data.<id>.field}} the same way
// CardNode's source_path does, so a tile can be the only fetcher on screen.
// props.fallback (V3-UIX-26 文明ミニマップ「API失敗時は近似フォールバック
// 表示」): while the bound value is still empty (either loading, or the fetch
// truly failed and useSource's catch() silently gave up), show this instead
// of a blank tile — both states honestly mean "no real number yet".
function KpiTileNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  useSource(node);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const resolved = interpolate(String(p.value ?? ""), scope);
  const value = resolved !== "" ? resolved : p.fallback != null ? String(p.fallback) : "";
  const label = displayText(resolve, p.label_key, p.label, "");
  const trend = p.trend != null ? interpolate(String(p.trend), scope) : "";
  return (
    <div className="civ-kpi-tile">
      <span className="civ-kpi-value">{value}</span>
      {label && <span className="civ-kpi-label">{label}</span>}
      {trend && <Badge text={trend} tone={p.trend_tone != null ? String(p.trend_tone) : undefined} />}
    </div>
  );
}

function QrNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const value = interpolate(String(p.value ?? p.token ?? ""), scope);
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toString(value || " ", { type: "svg", margin: 0 })
      .then((s) => {
        if (alive) setSvg(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [value]);
  return (
    <div
      className="civ-qr"
      role="img"
      aria-label={`QRコード: ${value}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// V3-I18-06: user-generated text shown in its ORIGINAL language, with an
// on-device "翻訳" affordance offered only when the viewer's locale differs from
// the content's `lang`. Translation runs on-device on demand — never a server
// call (see lib/ugc-translate). Original text is shown until the viewer opts in.
function UgcText({ node, text }: { node: ScreenNode; text: string }) {
  const p = props(node);
  const viewerLocale = useContext(LocaleCtx);
  const lang = p.lang ? String(p.lang) : undefined;
  const [shown, setShown] = useState(text);
  const [busy, setBusy] = useState(false);
  const offer = shouldOfferTranslation(lang, viewerLocale);
  const onTranslate = useCallback(async () => {
    setBusy(true);
    try {
      const r = await translateOnDemand({ text, sourceLang: lang, viewerLocale });
      setShown(r.text);
    } finally {
      setBusy(false);
    }
  }, [text, lang, viewerLocale]);
  return (
    <p className="civ-text" data-muted={p.muted === true || undefined} lang={lang}>
      {shown}
      {offer && (
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="ghost"
          aria-busy={busy || undefined}
          onClick={onTranslate}
        >
          翻訳
        </button>
      )}
    </p>
  );
}

// V3-OBS-18: the observation measurement table — a header row (項目/数値/単位/
// 計測方法) over N rows, each row an item select + number input + unit select +
// method select. props.rows seeds the initial template rows; "行を追加" appends
// blank rows (client state). Each row also emits a hidden measurements.i.kind so
// the shaped body is [{item,value,unit,method,kind:"number"}] — the same dotted
// FormData nesting obs-entry uses, so it rides the existing form contract.
// ponytail: uncontrolled rows. An untouched template row still submits its
// item/unit/method/kind with an empty value; the confirm/API step should drop
// measurements missing a value. Add per-row value-gating only if that leak bites.
//
// V3-OBS-27 StructuredRow統一: 測定行/撮影条件行/環境スナップショット行を同じ
// コンポーネントで表現する。種別差は専用ノードを増やさず tpl.group (既定
// "measurement") のみで表現(複数 group が混在する時だけ小見出しを挟む)。
// tpl.value_origin が "direct_observed" 以外(自動取得)なら、その行は
// 読取専用(ロック) — 入力欄の代わりに出所バッジ(◎/○/△+日本語ラベル)を表示し、
// 手入力行は従来どおり編集可(source は内部メタでユーザー選択式にしない)。
// props.readonly:true は表全体を閲覧専用にする(obs-detail 等・行追加/項目追加
// ボタンも隠す)。props.bind_items は table/list と同じ規約でスコープの配列
// (例: 祖先 card の source_path が fetch した data.detail.capture.measurements)
// を rows として束ねる — obs-entry のような静的 props.rows と排他。
const ORIGIN_GRADE: Record<string, "◎" | "○" | "△"> = {
  direct_observed: "◎",
  image_derived: "○",
  environment_derived: "○",
  lineage_derived: "○",
  estimated: "△",
  imputed: "△",
  aggregate: "△",
  model_inference: "△",
  unknown: "△",
};
const ORIGIN_LABEL: Record<string, string> = {
  direct_observed: "手入力",
  image_derived: "画像由来",
  environment_derived: "環境由来",
  lineage_derived: "血統由来",
  estimated: "推定",
  imputed: "補完",
  aggregate: "集計",
  model_inference: "モデル推論",
  unknown: "不明",
};
const GROUP_LABEL: Record<string, string> = {
  measurement: "計測",
  photo_condition: "撮影条件",
  environment_snapshot: "環境スナップショット",
};
const originTone = (grade: "◎" | "○" | "△" | ""): string =>
  grade === "◎" ? "success" : grade === "○" ? "neutral" : grade === "△" ? "caution" : "neutral";

function MeasurementTableNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const boundRows = useBoundItems(node);
  const baseItems = toOptions(p.item_options);
  const baseUnits = toOptions(p.unit_options);
  const methodOpts = toOptions(p.method_options);
  const templates = p.bind_items
    ? (boundRows as Array<Record<string, unknown>>)
    : ((p.rows as Array<Record<string, unknown>>) ?? []);
  const readonly = p.readonly === true;
  const [extra, setExtra] = useState(0);
  // V3-OBS-18 自由項目: user-defined item/unit choices extend every row's select.
  const [extraItems, setExtraItems] = useState<Opt[]>([]);
  const [extraUnits, setExtraUnits] = useState<Opt[]>([]);
  const [adding, setAdding] = useState<null | "item" | "unit">(null);
  const [pendingName, setPendingName] = useState("");
  const itemOpts = [...baseItems, ...extraItems];
  const unitOpts = [...baseUnits, ...extraUnits];
  const rowCount = readonly ? templates.length : templates.length + extra;
  const th = (k: unknown, l: unknown, fb: string) => displayText(resolve, k, l, fb);
  const itemLabel = th(p.item_label_key, p.item_label, "項目");
  const valueLabel = th(p.value_label_key, p.value_label, "数値");
  const unitLabel = th(p.unit_label_key, p.unit_label, "単位");
  const methodLabel = th(p.method_label_key, p.method_label, readonly ? "出所" : "計測方法");
  const canAddItem = p.add_item_label != null && !readonly;
  const canAddUnit = p.add_unit_label != null && !readonly;
  const groupOf = (t: Record<string, unknown>) => (t.group != null ? String(t.group) : "measurement");
  const hasMultipleGroups = new Set(templates.map(groupOf)).size > 1;

  const confirmAdd = () => {
    const v = pendingName.trim();
    if (v) {
      const opt = { value: v, label: v };
      const setter = adding === "item" ? setExtraItems : setExtraUnits;
      setter((xs) => (xs.some((o) => o.value === v) ? xs : [...xs, opt]));
    }
    setPendingName("");
    setAdding(null);
  };

  if (readonly && templates.length === 0) {
    return p.empty_text ? <p className="civ-empty">{String(p.empty_text)}</p> : null;
  }

  return (
    <div className="civ-measure-table" role="group" aria-label={th(p.label_key, p.label, "計測")}>
      <div className="civ-measure-head" aria-hidden="true">
        <span>{itemLabel}</span>
        <span>{valueLabel}</span>
        <span>{unitLabel}</span>
        <span>{methodLabel}</span>
      </div>
      {Array.from({ length: rowCount }).map((_, i) => {
        const tpl = templates[i] ?? {};
        const dItem = tpl.item != null ? String(tpl.item) : "";
        const dUnit = tpl.unit != null ? String(tpl.unit) : "";
        const dMethod =
          tpl.method != null ? String(tpl.method) : String(methodOpts[0]?.value ?? "");
        const rowN = i + 1;
        const group = groupOf(tpl);
        const prevGroup = i > 0 ? groupOf(templates[i - 1] ?? {}) : null;
        const showGroupHeader = hasMultipleGroups && group !== prevGroup;
        const origin = tpl.value_origin != null ? String(tpl.value_origin) : "";
        const locked = readonly || (origin !== "" && origin !== "direct_observed");
        const rowNode = locked ? (
          <div className="civ-measure-row" data-locked="true" key={i}>
            <span className="civ-text" aria-label={`${itemLabel} ${rowN}`}>
              {dItem || "—"}
            </span>
            <span className="civ-text" aria-label={`${valueLabel} ${rowN}`}>
              {tpl.value != null ? String(tpl.value) : "—"}
            </span>
            <span className="civ-text" aria-label={`${unitLabel} ${rowN}`}>
              {dUnit}
            </span>
            <span className="civ-measure-origin" aria-label={`${methodLabel} ${rowN}`}>
              <Badge
                text={`${origin ? ORIGIN_GRADE[origin] ?? "" : ""} ${origin ? (ORIGIN_LABEL[origin] ?? origin) : "手入力"}`.trim()}
                tone={originTone(origin ? (ORIGIN_GRADE[origin] ?? "") : "")}
              />
              {readonly ? null : (
                <span aria-hidden="true" title="自動取得・読取専用">
                  🔒
                </span>
              )}
            </span>
          </div>
        ) : (
          <div className="civ-measure-row" key={i}>
            <select
              className="civ-input"
              name={`measurements.${i}.item`}
              defaultValue={dItem}
              aria-label={`${itemLabel} ${rowN}`}
            >
              {dItem === "" && <option value="">—</option>}
              {itemOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="civ-input"
              type="number"
              inputMode="decimal"
              name={`measurements.${i}.value`}
              defaultValue={tpl.value != null ? String(tpl.value) : undefined}
              aria-label={`${valueLabel} ${rowN}`}
            />
            <select
              className="civ-input"
              name={`measurements.${i}.unit`}
              defaultValue={dUnit}
              aria-label={`${unitLabel} ${rowN}`}
            >
              {dUnit === "" && <option value="">—</option>}
              {unitOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              className="civ-input"
              name={`measurements.${i}.method`}
              defaultValue={dMethod}
              aria-label={`${methodLabel} ${rowN}`}
            >
              {methodOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input type="hidden" name={`measurements.${i}.kind`} value="number" readOnly />
          </div>
        );
        return (
          <React.Fragment key={i}>
            {showGroupHeader && <div className="civ-measure-group">{GROUP_LABEL[group] ?? group}</div>}
            {rowNode}
          </React.Fragment>
        );
      })}
      {!readonly && (
        <div className="civ-measure-actions">
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="secondary"
            onClick={() => setExtra((n) => n + 1)}
          >
            {th(p.add_label_key, p.add_label, "行を追加")}
          </button>
          {canAddItem && (
            <button
              type="button"
              className={cn("civ-interactive", "civ-button")}
              data-variant="ghost"
              onClick={() => {
                setAdding("item");
                setPendingName("");
              }}
            >
              {th(p.add_item_label_key, p.add_item_label, "＋ 項目を追加")}
            </button>
          )}
          {canAddUnit && (
            <button
              type="button"
              className={cn("civ-interactive", "civ-button")}
              data-variant="ghost"
              onClick={() => {
                setAdding("unit");
                setPendingName("");
              }}
            >
              {th(p.add_unit_label_key, p.add_unit_label, "＋ 単位を追加")}
            </button>
          )}
        </div>
      )}
      {adding && (
        <div className="civ-measure-add">
          {/* no `name` — this is a choice-builder, not a submitted measurement field */}
          <input
            className="civ-input"
            value={pendingName}
            onChange={(e) => setPendingName(e.target.value)}
            placeholder={String(
              (adding === "item" ? p.item_placeholder : p.unit_placeholder) ??
                (adding === "item" ? "例: 頭角幅" : "例: mg"),
            )}
            aria-label={adding === "item" ? itemLabel : unitLabel}
          />
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="secondary"
            onClick={confirmAdd}
          >
            {adding === "item" ? "項目を追加" : "単位を追加"}
          </button>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="ghost"
            onClick={() => setAdding(null)}
          >
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}

// V3-AIP-101 「この子への追観測?」候補チップ: a client-only recently-viewed
// cache (no new Truth type — a convenience index, same footing as the draft
// sessionStorage carry). visit-tracker stamps the current individual on F2
// mount; recent-chips reads the last 3 on F1. Capped at 10, newest first,
// deduped by id.
// 磨き直し fix#1: the entry carries label/name/species/stage too (never the
// raw id) so F1 can render a rich chip instead of a bare-ULID pill. Old
// bare {id,at} rows already in localStorage still parse fine — the extra
// fields are just undefined until the next visit re-stamps them.
const RECENT_KEY = "ihl:obs-recent-individuals";
type RecentEntry = { id: string; at: number; label?: string; name?: string; species?: string; stage?: string };

function readRecent(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const rows = raw ? (JSON.parse(raw) as RecentEntry[]) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
function pushRecent(entry: Omit<RecentEntry, "at">): void {
  if (typeof window === "undefined" || !entry.id) return;
  const next = [{ ...entry, at: Date.now() }, ...readRecent().filter((e) => e.id !== entry.id)].slice(0, 10);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage full/unavailable — best effort, no crash */
  }
}
function relativeLabel(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (mins < 1) return "たった今";
  if (mins < 60) return `${mins}分前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.round(hours / 24)}日前`;
}

function VisitTrackerNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const id = p.id_from ? String(getPath(scope, String(p.id_from)) ?? "") : "";
  // 磨き直し fix#1: props.from points at the paired card's fetched individual
  // (e.g. "data.individual") so the stamped entry carries label/species/stage,
  // not just the id. The effect deliberately depends on the RESOLVED source
  // object, not just `id` — `useSource`'s fetch resolves asynchronously via
  // setNodeData (a re-render), so gating on `source` (not just `id`) means the
  // pre-fetch empty enrichment is never the one that gets persisted. Without a
  // `from` prop (no other consumer today) it falls back to the old id-only stamp.
  const fromPath = p.from ? String(p.from) : "";
  const source = fromPath ? (getPath(scope, fromPath) as Record<string, unknown> | undefined) : undefined;
  const stageLabels = (p.stage_labels as Record<string, string> | undefined) ?? {};
  useEffect(() => {
    if (!id) return;
    if (!fromPath) {
      pushRecent({ id });
      return;
    }
    if (!source) return; // still waiting on the paired fetch
    const master = (source.master as Record<string, unknown> | undefined) ?? {};
    const label = typeof master.local_label_text === "string" ? master.local_label_text : undefined;
    const name = typeof source.name === "string" ? source.name : undefined;
    const species = typeof master.species === "string" ? master.species : undefined;
    const stageCode = currentStage(source.timeline);
    const stage = stageCode ? (stageLabels[stageCode] ?? stageCode) : undefined;
    pushRecent({ id, label, name, species, stage });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fromPath, source]);
  return null;
}

// 磨き直し fix#1: a rich CardNode-style chip — label/name lead over the raw
// id (never shown), species+stage as badges, relative time as the caption.
// Reuses the same .civ-card/.civ-badge/.civ-interactive vocabulary CardNode
// uses (a bare button pill would have re-invented that shell).
function RecentChipsNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const navigate = useContext(NavigateCtx);
  const [entries, setEntries] = useState<RecentEntry[]>([]);
  useEffect(() => setEntries(readRecent().slice(0, 3)), []);
  // 履歴ゼロならチップ行ごと非表示(空行を出さない・仕様どおり).
  if (entries.length === 0) return null;
  const to = p.to ? String(p.to) : "";
  const label = displayText(resolve, p.label_key, p.label, "この子への追観測?");
  return (
    <section aria-label={label}>
      <p className="civ-text" data-muted="true">
        {label}
      </p>
      <div className="civ-chip-row">
        {entries.map((e) => {
          const title = e.label || e.name || e.species || "個体";
          return (
            <button
              key={e.id}
              type="button"
              className={cn("civ-interactive", "civ-card", "civ-recent-chip")}
              onClick={() => navigate(to, { id: e.id })}
            >
              <span className="civ-card-title">{title}</span>
              {(e.species || e.stage) && (
                <span className="civ-card-badges">
                  {e.species && <Badge text={e.species} tone="neutral" />}
                  {e.stage && <Badge text={e.stage} tone="neutral" />}
                </span>
              )}
              <span className="civ-text" data-muted="true">
                {relativeLabel(e.at)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// 磨き直し fix#5/#6: one shared collapsed-by-default trigger + revealed-body
// mechanism (no forked half-implementation per fix). trigger_style:"badge"
// renders a tappable Badge chip (F2 stage — text can be derive_from-computed,
// same lookup BadgeNode uses); anything else renders a normal .civ-button
// (F2 death). Children show only once tapped; collapsing back is out of scope
// (both consumers navigate/reload on submit, which resets `open` for free).
function DisclosureNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const [open, setOpen] = useState(false);
  const isBadge = p.trigger_style === "badge";
  let label: string;
  let tone: string | undefined;
  if (p.derive_from) {
    const derived = stageBadgeText(scope, p.derive_from, p.stage_labels, p.empty_text);
    label = derived.text;
    tone = derived.hasStage ? String(p.tone ?? "neutral") : "neutral";
  } else {
    label = interpolate(displayText(resolve, p.trigger_label_key, p.trigger_label, "詳細"), scope);
    tone = p.tone != null ? String(p.tone) : undefined;
  }
  if (isBadge) label = `${label} ${open ? "▾" : "▸"}`;
  return (
    <div className="civ-disclosure" data-open={open || undefined}>
      {isBadge ? (
        <button
          type="button"
          className={cn("civ-interactive", "civ-badge", "civ-disclosure-trigger")}
          data-tone={tone ?? "neutral"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {label}
        </button>
      ) : (
        <button
          type="button"
          className={cn("civ-interactive", "civ-button", "civ-disclosure-trigger")}
          data-variant={String(p.trigger_style ?? "secondary")}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {label}
        </button>
      )}
      {open && (
        <div className="civ-disclosure-body">
          <Children nodes={node.children} />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// V3-AIP-101 観測登録スライス2 (c7-wireframes-core5 §F3/F4/F5/F6) — クラッチ
// 割り出し(F3)・お世話/移動/クラッチ照合・昇格の一括選択(F4)・バッチ確認(F5b)
// ・バッチ完了(F6b)。いずれも複数 API 呼び出し+行単位のローカル状態を1画面内
// に持つため専用ノードにした(measurement-table と同じ縮退・ponytail: 汎用の
// list/table 語彙をここまで汎化するとかえって読みにくいので、この4画面だけの
// 専用コンポーネントに留める)。
// =============================================================================

const STAGE_LABELS_JA: Record<string, string> = {
  first: "初令",
  second: "二令",
  third_early: "三令初期",
  third_mid: "三令中期",
  third_late: "三令後期",
  prepupa: "前蛹",
  pupa: "蛹",
  adult: "成虫",
};

// 「そろそろ」判定の閾値(日数)。追い立てない温度感(2026-07-12 ユーザー裁定
// 「予定は目安・赤禁止」)のニュートラルな既定値 — ユーザー単位のテンプレ化は
// 今後の波。ponytail: 固定30日、per-stage/per-userの間隔テンプレは今後の拡張。
const OVERDUE_DAYS = 30;

// GET /individuals falls back to the raw ULID as `label` when an individual
// has neither local_label_text nor name (backend individual-routes.ts:
// `label: label || name || id`). F4 lists EVERY individual (not a scoped
// search like F1), so unlabeled rows from other flows/tests surface that
// fallback here — a raw ID on screen violates the no-raw-ID quality bar. This
// sanitizes it client-side without touching the completed backend contract.
const ULID_RE = /^[0-9A-Za-z]{26}$/;
function safeLabel(label: string, species: string | null): string {
  return ULID_RE.test(label) ? species || "無名個体" : label;
}

function daysSince(iso: string | null): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 86_400_000;
}

// F3 の親3択で使う検索→選択ピッカー。選択済みはラベル+種のみ表示し、生ID は
// 画面に一切出さない(品質バー: ID全文非表示)。
type ParentSel = { id: string; label: string; species?: string } | null;
function ParentPicker({
  label,
  selected,
  onSelect,
  onClear,
}: {
  label: string;
  selected: ParentSel;
  onSelect: (v: ParentSel) => void;
  onClear: () => void;
}) {
  const execute = useContext(ExecuteCtx);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ individual_id: string; label: string; species?: string }>>([]);
  const [searching, setSearching] = useState(false);
  const search = useCallback(async () => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const r = (await execute({
        kind: "api",
        method: "GET",
        path: `/api/v1/individuals?q=${encodeURIComponent(q)}`,
      })) as { individuals?: Array<{ individual_id: string; label: string; species?: string }> } | undefined;
      setResults((r?.individuals ?? []).slice(0, 5));
    } finally {
      setSearching(false);
    }
  }, [q, execute]);

  if (selected) {
    return (
      <div className="civ-field">
        <span className="civ-label">{label}</span>
        <div className="civ-card-badges">
          <Badge text={selected.label} tone="neutral" />
          {selected.species && <Badge text={selected.species} tone="neutral" />}
          <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="ghost" data-compact onClick={onClear}>
            ✕ 変更
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="civ-field">
      <span className="civ-label">{label}</span>
      <div className="civ-picker-row">
        <input
          className="civ-input"
          placeholder="個体・種で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={`${label} を検索`}
        />
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          data-compact
          aria-busy={searching || undefined}
          onClick={search}
        >
          🔍 検索
        </button>
      </div>
      {results.length > 0 && (
        <div className="civ-chip-row">
          {results.map((r) => (
            <button
              key={r.individual_id}
              type="button"
              className={cn("civ-interactive", "civ-card", "civ-recent-chip")}
              onClick={() => {
                onSelect({ id: r.individual_id, label: r.label, species: r.species });
                setResults([]);
                setQ("");
              }}
            >
              <span className="civ-card-title">{r.label}</span>
              {r.species && <Badge text={r.species} tone="neutral" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// F3: 割り出し・クラッチ一括(匿名プール)。保存 = POST /clutches のあと(抜き
// 取り計測があれば)POST /observation/captures を subject_ref="clutch/<id>" で
// 連鎖させる1画面完結フォーム(F4/F5のバッチドラフトは経由しない — F6相当の
// 完了表示までこの画面が担う・wireframes-core5 §F3の保存規定どおり)。
function ClutchIntakeNode() {
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);
  const [parentMode, setParentMode] = useState<"pair" | "dam_only" | "later">("pair");
  const [sire, setSire] = useState<ParentSel>(null);
  const [dam, setDam] = useState<ParentSel>(null);
  const [species, setSpecies] = useState("");
  const [subspecies, setSubspecies] = useState("");
  const [subspeciesConfirmed, setSubspeciesConfirmed] = useState(false);
  const [harvestedAt, setHarvestedAt] = useState(() => formatDateJa(new Date()));
  const [count, setCount] = useState("");
  const [sampleOpen, setSampleOpen] = useState(false);
  const [sampleCount, setSampleCount] = useState("");
  const [sampleWeight, setSampleWeight] = useState("");
  const [containerMode, setContainerMode] = useState<"group" | "individual">("group");
  const [containerLabel, setContainerLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | {
    count: number;
    avg: number | null;
    sampleCount: number | null;
  }>(null);

  const sampleN = Number(sampleCount);
  const sampleW = Number(sampleWeight);
  const avg =
    sampleCount !== "" && sampleWeight !== "" && sampleN > 0 && Number.isFinite(sampleW) ? sampleW / sampleN : null;

  useEffect(() => {
    if (parentMode !== "pair") return;
    setSpecies((s) => (s ? s : String(sire?.species ?? dam?.species ?? "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sire, dam]);

  const submit = useCallback(async () => {
    setError(null);
    const n = Number(count);
    if (!Number.isInteger(n) || n < 0) {
      setError("匹数を正しく入力してください");
      return;
    }
    if (subspecies.trim() && !subspeciesConfirmed) {
      setError("亜種候補を確定してください([これで確定する])");
      return;
    }
    setPending(true);
    try {
      const body: Record<string, unknown> = { harvested_at: harvestedAt, initial_count: n };
      if (parentMode === "pair") {
        if (sire) body.sire_id = sire.id;
        if (dam) body.dam_id = dam.id;
      } else if (parentMode === "dam_only" && dam) {
        body.dam_id = dam.id;
      }
      if (species.trim()) body.species = species.trim();
      if (subspecies.trim()) {
        body.subspecies_candidate = subspecies.trim();
        body.subspecies_confirmed_by = "user";
      }
      if (containerMode === "group" && containerLabel.trim()) body.container_label = containerLabel.trim();
      const res = (await execute({ kind: "api", method: "POST", path: "/api/v1/clutches" }, body)) as
        | { clutch_id: string; current_count: number }
        | undefined;
      if (!res?.clutch_id) throw new Error("保存に失敗しました");
      let sampleAvg: number | null = null;
      if (avg != null) {
        await execute(
          { kind: "api", method: "POST", path: "/api/v1/observation/captures" },
          {
            domain: "biology",
            subject_ref: `clutch/${res.clutch_id}`,
            measurements: [
              { item: "weight_avg", kind: "number", value: Number(avg.toFixed(2)), unit: "g", value_origin: "aggregate" },
              { item: "weight_total", kind: "number", value: sampleW, unit: "g", value_origin: "aggregate" },
              { item: "sample_count", kind: "number", value: sampleN, unit: "匹" },
            ],
          },
        );
        sampleAvg = avg;
      }
      setDone({
        count: res.current_count ?? n,
        avg: sampleAvg,
        sampleCount: sampleAvg != null ? sampleN : null,
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }, [
    count,
    harvestedAt,
    parentMode,
    sire,
    dam,
    species,
    subspecies,
    subspeciesConfirmed,
    containerMode,
    containerLabel,
    avg,
    sampleN,
    sampleW,
    execute,
  ]);

  if (done) {
    return (
      <div className="civ-card">
        <h2 className="civ-heading" data-level="2">
          保存しました
        </h2>
        <p className="civ-text">現在 {done.count}匹</p>
        {done.avg != null && (
          <p className="civ-text" data-muted="true">
            抜き取り{done.sampleCount}匹の平均 {done.avg.toFixed(1)}g
          </p>
        )}
        <div className="civ-roster-row">
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="primary"
            onClick={() => navigate("obs-register-batch")}
          >
            まとめて記録へ
          </button>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="secondary"
            onClick={() => navigate("obs-register")}
          >
            記録するへ戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="civ-form">
      <div className="civ-field">
        <span className="civ-label">親</span>
        <div className="civ-segmented" role="radiogroup" aria-label="親の指定方法">
          {(
            [
              ["pair", "♂♀を検索して指定"],
              ["dam_only", "♀のみ・父不明"],
              ["later", "親は後からリンク"],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className="civ-segment">
              <input type="radio" name="parent-mode" checked={parentMode === v} onChange={() => setParentMode(v)} />
              <span>{l}</span>
            </label>
          ))}
        </div>
      </div>
      {parentMode === "pair" && (
        <>
          <ParentPicker label="父(♂)" selected={sire} onSelect={setSire} onClear={() => setSire(null)} />
          <ParentPicker label="母(♀)" selected={dam} onSelect={setDam} onClear={() => setDam(null)} />
        </>
      )}
      {parentMode === "dam_only" && (
        <ParentPicker label="母(♀)" selected={dam} onSelect={setDam} onClear={() => setDam(null)} />
      )}
      {parentMode === "later" && (
        <p className="civ-text" data-muted="true">
          親はあとから個体詳細でリンクできます。
        </p>
      )}
      <div className="civ-field">
        <label className="civ-label" htmlFor="clutch-species">
          種(任意){parentMode === "pair" && (sire || dam) ? " — 親から継承(編集可)" : ""}
        </label>
        <input
          id="clutch-species"
          className="civ-input"
          value={species}
          onChange={(e) => setSpecies(e.target.value)}
          placeholder="例: Dynastes hercules"
        />
      </div>
      <div className="civ-field">
        <label className="civ-label" htmlFor="clutch-subspecies">
          亜種候補(任意)
        </label>
        <div className="civ-picker-row">
          <input
            id="clutch-subspecies"
            className="civ-input"
            value={subspecies}
            onChange={(e) => {
              setSubspecies(e.target.value);
              setSubspeciesConfirmed(false);
            }}
            placeholder="例: hercules"
          />
          {subspecies.trim() && (
            <button
              type="button"
              className={cn("civ-interactive", "civ-button")}
              data-variant={subspeciesConfirmed ? "secondary" : "primary"}
              data-compact
              onClick={() => setSubspeciesConfirmed(true)}
            >
              {subspeciesConfirmed ? "確定済み ✓" : "これで確定する"}
            </button>
          )}
        </div>
        <p className="civ-text" data-muted="true">
          候補です — ユーザー確定のみ(自動確定はしません)。
        </p>
      </div>
      <div className="civ-field">
        <label className="civ-label" htmlFor="clutch-harvested">
          割り出し日
        </label>
        <input
          id="clutch-harvested"
          className="civ-input"
          type="date"
          value={harvestedAt}
          onChange={(e) => setHarvestedAt(e.target.value)}
        />
        <p className="civ-text" data-muted="true">
          クラッチIDは保存時に自動採番されます。
        </p>
      </div>
      <div className="civ-field">
        <label className="civ-label" htmlFor="clutch-count">
          匹数 — 今日打つ数字はこれだけ
        </label>
        <input
          id="clutch-count"
          className="civ-input"
          type="number"
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(e.target.value)}
        />
      </div>
      <div className="civ-disclosure">
        <button
          type="button"
          className={cn("civ-interactive", "civ-button", "civ-disclosure-trigger")}
          data-variant="secondary"
          aria-expanded={sampleOpen}
          onClick={() => setSampleOpen((o) => !o)}
        >
          抜き取り計測(任意) {sampleOpen ? "▾" : "▸"}
        </button>
        {sampleOpen && (
          <div className="civ-disclosure-body">
            <div className="civ-field">
              <label className="civ-label" htmlFor="sample-count">
                匹まとめて載せる
              </label>
              <input
                id="sample-count"
                className="civ-input"
                type="number"
                inputMode="numeric"
                value={sampleCount}
                onChange={(e) => setSampleCount(e.target.value)}
              />
            </div>
            <div className="civ-field">
              <label className="civ-label" htmlFor="sample-weight">
                総重量(g)
              </label>
              <input
                id="sample-weight"
                className="civ-input"
                type="number"
                inputMode="decimal"
                value={sampleWeight}
                onChange={(e) => setSampleWeight(e.target.value)}
              />
            </div>
            {avg != null && <p className="civ-text">平均 {avg.toFixed(1)}g(自動計算)</p>}
            <p className="civ-text" data-muted="true">
              クラッチの集計値として記録します(個体には割りません)。
            </p>
          </div>
        )}
      </div>
      <div className="civ-field">
        <span className="civ-label">容器</span>
        <div className="civ-segmented" role="radiogroup" aria-label="容器">
          <label className="civ-segment">
            <input
              type="radio"
              name="container-mode"
              checked={containerMode === "group"}
              onChange={() => setContainerMode("group")}
            />
            <span>まとめ置き</span>
          </label>
          <label className="civ-segment">
            <input
              type="radio"
              name="container-mode"
              checked={containerMode === "individual"}
              onChange={() => setContainerMode("individual")}
            />
            <span>個別カップに分ける</span>
          </label>
        </div>
        {containerMode === "group" && (
          <input
            className="civ-input"
            placeholder="例: 衣装ケースC-1(任意)"
            value={containerLabel}
            onChange={(e) => setContainerLabel(e.target.value)}
          />
        )}
        {containerMode === "individual" && (
          <p className="civ-text" data-muted="true">
            個別容器に分けると、その時点で個体IDが発生します。このスライスでは割り出しと同時分割はできません
            — 割り出し後に「まとめて記録」の昇格から行ってください。
          </p>
        )}
      </div>
      <p className="civ-text" data-muted="true">
        ※ 個体IDはまだ発行しません。個別容器へ分割した時に初めて発生します。
      </p>
      <button
        type="button"
        className={cn("civ-interactive", "civ-button")}
        data-variant="primary"
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={submit}
      >
        確認へ →
      </button>
      {error && (
        <p role="alert" className="civ-form-error">
          {error}
        </p>
      )}
    </div>
  );
}

type IndividualRow = {
  individual_id: string;
  label: string;
  species: string | null;
  stage: string | null;
  placement_id: string | null;
  last_care_at: string | null;
  last_measurement_summary: string | null;
};
type ClutchRow = {
  clutch_id: string;
  species?: string;
  harvested_at?: string;
  current_count: number | null;
  placement_id?: string;
  container_label?: string;
};
type PlacementRow = { placement_id: string; label: string };

// F4: まとめて記録(お世話/移動一括+クラッチ照合・昇格)。GET /individuals・
// GET /clutches・GET /placements を1回ずつ取得し、クライアント側フィルタ+
// チェック選択+計測グリッドで束ね、[確認へ]でバッチドラフトを sessionStorage
// に積んで F5b(obs-register-batch-confirm)へ渡す。昇格(promote)だけは個体ID
// をその場で発行するため即時 API 呼び出し(batch-commit は promote 未対応 —
// バックエンド commit 2329559 の仕様どおり)。
function BatchRosterNode() {
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);
  const [individuals, setIndividuals] = useState<IndividualRow[]>([]);
  const [clutches, setClutches] = useState<ClutchRow[]>([]);
  const [placements, setPlacements] = useState<PlacementRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [ind, cl, pl] = await Promise.all([
        execute({ kind: "api", method: "GET", path: "/api/v1/individuals" }) as Promise<
          { individuals?: IndividualRow[] } | undefined
        >,
        execute({ kind: "api", method: "GET", path: "/api/v1/clutches" }) as Promise<
          { clutches?: ClutchRow[] } | undefined
        >,
        execute({ kind: "api", method: "GET", path: "/api/v1/placements" }) as Promise<
          { placements?: PlacementRow[] } | undefined
        >,
      ]);
      if (!alive) return;
      setIndividuals((ind?.individuals ?? []).map((i) => ({ ...i, label: safeLabel(i.label, i.species) })));
      setClutches(cl?.clutches ?? []);
      setPlacements(pl?.placements ?? []);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placementLabel = useCallback(
    (id: string | null | undefined) => placements.find((p) => p.placement_id === id)?.label ?? "",
    [placements],
  );

  const [mode, setMode] = useState<"care" | "move">("care");
  const [shelfFilter, setShelfFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [careFilter, setCareFilter] = useState<"all" | "30" | "45">("all");
  const [moveTarget, setMoveTarget] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const seededRef = useRef(false);
  useEffect(() => {
    if (!loaded || seededRef.current) return;
    seededRef.current = true;
    // 検索スライスA(obs-search) ハンドオフ: sessionStorage にプリセレクトが
    // あればそれを優先(→計測グリッドへ の実体)。無ければ従来の「そろそろ」
    // 自動選択のまま(既存挙動は不変)。
    const preselect = loadPreselect();
    if (preselect) {
      setSelected(new Set(preselect));
      return;
    }
    setSelected(new Set(individuals.filter((i) => daysSince(i.last_care_at) >= OVERDUE_DAYS).map((i) => i.individual_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const overdueCount = individuals.filter((i) => daysSince(i.last_care_at) >= OVERDUE_DAYS).length;

  const [grid, setGrid] = useState<Record<string, { weight: string; length: string }>>({});
  const setGridValue = (id: string, key: "weight" | "length", v: string) =>
    setGrid((g) => ({ ...g, [id]: { ...(g[id] ?? { weight: "", length: "" }), [key]: v } }));

  type Extra = { kind: "death" } | { kind: "stage"; toStage: string };
  const [extras, setExtras] = useState<Record<string, Extra>>({});
  const [rowMenuOpen, setRowMenuOpen] = useState<string | null>(null);
  const [stagePick, setStagePick] = useState<Record<string, string>>({});

  const [reconcileOpen, setReconcileOpen] = useState<Record<string, boolean>>({});
  const [reconcileCounted, setReconcileCounted] = useState<Record<string, string>>({});
  const [reconcileQueued, setReconcileQueued] = useState<
    Record<string, { from: number; to: number; deathCount: number }>
  >({});
  const [promoteOpen, setPromoteOpen] = useState<Record<string, boolean>>({});
  const [promoteCount, setPromoteCount] = useState<Record<string, string>>({});
  const [promoted, setPromoted] = useState<Record<string, { count: number; deathCount: number }>>({});
  const [promotePending, setPromotePending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredIndividuals = individuals.filter((i) => {
    if (shelfFilter && i.placement_id !== shelfFilter) return false;
    if (stageFilter && i.stage !== stageFilter) return false;
    if (careFilter !== "all" && daysSince(i.last_care_at) < Number(careFilter)) return false;
    return true;
  });

  const toggleRow = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirmReconcile = (clutchId: string, current: number) => {
    const counted = Number(reconcileCounted[clutchId] ?? current);
    if (!Number.isInteger(counted) || counted < 0) return;
    const deathCount = Math.max(0, current - counted);
    setReconcileQueued((q) => ({ ...q, [clutchId]: { from: current, to: counted, deathCount } }));
    setReconcileOpen((o) => ({ ...o, [clutchId]: false }));
  };

  const confirmPromote = async (clutchId: string, current: number) => {
    const k = Number(promoteCount[clutchId]);
    if (!Number.isInteger(k) || k <= 0 || k > current) {
      setError("昇格する数を確認してください");
      return;
    }
    setPromotePending(clutchId);
    setError(null);
    try {
      await execute(
        { kind: "api", method: "POST", path: `/api/v1/clutches/${clutchId}/promote` },
        { count: k, death_count: 0, at: new Date().toISOString() },
      );
      setPromoted((p) => ({ ...p, [clutchId]: { count: k, deathCount: 0 } }));
      setPromoteOpen((o) => ({ ...o, [clutchId]: false }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPromotePending(null);
    }
  };

  const confirm = () => {
    const items: BatchCommitItem[] = [];
    const rows: DraftRow[] = [];
    const scheduleTargets: ScheduleTarget[] = [];
    const now = new Date().toISOString();

    if (mode === "care") {
      for (const id of selected) {
        const ind = individuals.find((i) => i.individual_id === id);
        if (!ind) continue;
        const g = grid[id] ?? { weight: "", length: "" };
        const measurements: Record<string, unknown>[] = [];
        const w = Number(g.weight);
        const l = Number(g.length);
        if (g.weight !== "" && Number.isFinite(w))
          measurements.push({ item: "weight", kind: "number", value: w, unit: "g", value_origin: "direct_observed" });
        if (g.length !== "" && Number.isFinite(l))
          measurements.push({ item: "length", kind: "number", value: l, unit: "mm", value_origin: "direct_observed" });
        const prev = ind.last_measurement_summary ? parseFloat(ind.last_measurement_summary) : null;
        const delta = prev != null && g.weight !== "" && Number.isFinite(w) ? w - prev : null;
        const idx = items.length;
        items.push({ kind: "capture", individual_id: id, body: { domain: "biology", subject_ref: `individual/${id}`, measurements } });
        rows.push({
          key: `measure-${id}`,
          group: "measure",
          label: ind.label,
          valueText: measurements.length
            ? measurements.map((m) => `${m.item === "weight" ? "体重" : "体長"} ${m.value}${m.unit}`).join(" / ")
            : "お世話のみ",
          deltaText: delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}g` : undefined,
          attention: delta != null && delta < 0,
          itemIndex: idx,
        });
        scheduleTargets.push({ individual_id: id, label: ind.label });
      }
    } else {
      if (!moveTarget) {
        setError("移動先の棚を選んでください");
        return;
      }
      for (const id of selected) {
        const ind = individuals.find((i) => i.individual_id === id);
        if (!ind) continue;
        const idx = items.length;
        items.push({ kind: "move", subject_ref: `individual/${id}`, to_placement_id: moveTarget, at: now });
        rows.push({
          key: `move-${id}`,
          group: "move",
          label: ind.label,
          valueText: `→ ${placementLabel(moveTarget) || "移動先"} へ移動`,
          itemIndex: idx,
        });
      }
    }

    for (const [id, extra] of Object.entries(extras)) {
      const ind = individuals.find((i) => i.individual_id === id);
      if (!ind) continue;
      const idx = items.length;
      if (extra.kind === "death") {
        items.push({ kind: "life-event", individual_id: id, body: { kind: "death", at: now } });
        rows.push({ key: `death-${id}`, group: "death", label: ind.label, valueText: "死亡として記録", itemIndex: idx });
      } else {
        items.push({ kind: "life-event", individual_id: id, body: { kind: "molt", at: now, detail: { to_stage: extra.toStage } } });
        rows.push({
          key: `stage-${id}`,
          group: "stage",
          label: ind.label,
          valueText: `→ ${STAGE_LABELS_JA[extra.toStage] ?? extra.toStage} に変化`,
          itemIndex: idx,
        });
      }
    }

    for (const [clutchId, q] of Object.entries(reconcileQueued)) {
      const cl = clutches.find((c) => c.clutch_id === clutchId);
      const idx = items.length;
      items.push({ kind: "clutch-event", clutch_id: clutchId, body: { kind: "attrition", death_count: q.deathCount, at: now, note: "匹数を照合" } });
      rows.push({
        key: `reconcile-${clutchId}`,
        group: "clutch-reconcile",
        label: cl ? `クラッチ ${cl.harvested_at ?? ""}` : "クラッチ",
        valueText: `${q.from}→${q.to}匹(死亡${q.deathCount})`,
        itemIndex: idx,
      });
    }

    for (const [clutchId, pr] of Object.entries(promoted)) {
      const cl = clutches.find((c) => c.clutch_id === clutchId);
      rows.push({
        key: `promote-${clutchId}`,
        group: "clutch-promote",
        label: cl ? `クラッチ ${cl.harvested_at ?? ""}` : "クラッチ",
        valueText: `${pr.count}体を昇格`,
        alreadyCommitted: true,
      });
    }

    if (items.length === 0 && rows.length === 0) {
      setError("対象を選択してください");
      return;
    }
    setError(null);
    saveBatchDraft({ items, rows, scheduleTargets });
    navigate("obs-register-batch-confirm");
  };

  if (!loaded) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }

  return (
    <div className="civ-form">
      <div className="civ-segmented" role="radiogroup" aria-label="記録の種類">
        <label className="civ-segment">
          <input type="radio" checked={mode === "care"} onChange={() => setMode("care")} />
          <span>お世話</span>
        </label>
        <label className="civ-segment">
          <input type="radio" checked={mode === "move"} onChange={() => setMode("move")} />
          <span>移動</span>
        </label>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="ghost"
          onClick={() => navigate("obs-register-clutch")}
        >
          割り出し →
        </button>
      </div>

      <div className="civ-roster-filters">
        <select className="civ-input" value={shelfFilter} onChange={(e) => setShelfFilter(e.target.value)} aria-label="棚で絞り込み">
          <option value="">棚: すべて</option>
          {placements.map((p) => (
            <option key={p.placement_id} value={p.placement_id}>
              {p.label}
            </option>
          ))}
        </select>
        <select className="civ-input" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} aria-label="ステージで絞り込み">
          <option value="">ステージ: すべて</option>
          {Object.entries(STAGE_LABELS_JA).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          className="civ-input"
          value={careFilter}
          onChange={(e) => setCareFilter(e.target.value as "all" | "30" | "45")}
          aria-label="最終お世話で絞り込み"
        >
          <option value="all">最終お世話: すべて</option>
          <option value="30">30日以上</option>
          <option value="45">45日以上</option>
        </select>
        <span className="civ-text" data-muted="true">
          該当{filteredIndividuals.length}件
        </span>
      </div>

      {overdueCount > 0 && (
        <p className="civ-text" data-muted="true">
          そろそろ: {overdueCount}件(前回から間隔が空いている子)
        </p>
      )}

      {mode === "move" && (
        <div className="civ-field">
          <label className="civ-label" htmlFor="move-target">
            移動先
          </label>
          <select id="move-target" className="civ-input" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
            <option value="">選んでください</option>
            {placements.map((p) => (
              <option key={p.placement_id} value={p.placement_id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <ul className="civ-list">
        {filteredIndividuals.map((ind) => {
          const checked = selected.has(ind.individual_id);
          const extra = extras[ind.individual_id];
          const menuOpen = rowMenuOpen === ind.individual_id;
          return (
            <li key={ind.individual_id} className="civ-roster-row">
              <label className="civ-checkbox-row">
                <input type="checkbox" checked={checked} onChange={() => toggleRow(ind.individual_id)} aria-label={`${ind.label} を選択`} />
              </label>
              <article className="civ-card">
                <div className="civ-card-head">
                  <h3 className="civ-card-title">{ind.label}</h3>
                </div>
                <div className="civ-card-badges">
                  {ind.species && <Badge text={ind.species} tone="neutral" />}
                  {ind.stage && <Badge text={STAGE_LABELS_JA[ind.stage] ?? ind.stage} tone="neutral" />}
                </div>
                <p className="civ-text" data-muted="true">
                  {ind.last_measurement_summary ? `前回 ${ind.last_measurement_summary}` : "初回"}
                  {ind.last_care_at ? `・${formatDateJa(ind.last_care_at)}` : ""}
                  {placementLabel(ind.placement_id) ? `・${placementLabel(ind.placement_id)}` : ""}
                </p>
                {extra && (
                  <p className="civ-text">
                    {extra.kind === "death" ? "☠ 死亡として記録(今回)" : `→ ${STAGE_LABELS_JA[extra.toStage] ?? extra.toStage} に変化(今回)`}{" "}
                    <button
                      type="button"
                      className={cn("civ-interactive", "civ-button")}
                      data-variant="ghost"
                      data-compact
                      onClick={() =>
                        setExtras((e) => {
                          const n = { ...e };
                          delete n[ind.individual_id];
                          return n;
                        })
                      }
                    >
                      取消
                    </button>
                  </p>
                )}
                {!extra && (
                  <button
                    type="button"
                    className={cn("civ-interactive", "civ-button")}
                    data-variant="ghost"
                    data-compact
                    aria-expanded={menuOpen}
                    onClick={() => setRowMenuOpen(menuOpen ? null : ind.individual_id)}
                  >
                    ⋯ 死亡・ステージ変化
                  </button>
                )}
                {menuOpen && !extra && (
                  <div className="civ-disclosure-body">
                    <button
                      type="button"
                      className={cn("civ-interactive", "civ-button")}
                      data-variant="secondary"
                      onClick={() => {
                        setExtras((e) => ({ ...e, [ind.individual_id]: { kind: "death" } }));
                        setRowMenuOpen(null);
                      }}
                    >
                      ☠ 死亡として記録
                    </button>
                    <div className="civ-picker-row">
                      <select
                        className="civ-input"
                        value={stagePick[ind.individual_id] ?? ""}
                        onChange={(e) => setStagePick((s) => ({ ...s, [ind.individual_id]: e.target.value }))}
                        aria-label="次のステージ"
                      >
                        <option value="">ステージを選ぶ</option>
                        {Object.entries(STAGE_LABELS_JA).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={cn("civ-interactive", "civ-button")}
                        data-variant="secondary"
                        disabled={!stagePick[ind.individual_id]}
                        onClick={() => {
                          const toStage = stagePick[ind.individual_id];
                          if (!toStage) return;
                          setExtras((e) => ({ ...e, [ind.individual_id]: { kind: "stage", toStage } }));
                          setRowMenuOpen(null);
                        }}
                      >
                        記録
                      </button>
                    </div>
                  </div>
                )}
              </article>
            </li>
          );
        })}
        {clutches.map((cl) => {
          const current = cl.current_count ?? 0;
          const queued = reconcileQueued[cl.clutch_id];
          const promotedResult = promoted[cl.clutch_id];
          const effectiveCurrent = queued ? queued.to : current;
          return (
            <li key={cl.clutch_id} className="civ-roster-row">
              <span aria-hidden="true" />
              <article className="civ-card">
                <div className="civ-card-head">
                  <span className="civ-card-icon" aria-hidden="true">
                    🥚
                  </span>
                  <h3 className="civ-card-title">クラッチ {cl.harvested_at ?? ""}</h3>
                </div>
                <div className="civ-card-badges">
                  {cl.species && <Badge text={cl.species} tone="neutral" />}
                  <Badge text={`残${effectiveCurrent}匹`} tone="neutral" />
                </div>
                {(placementLabel(cl.placement_id) || cl.container_label) && (
                  <p className="civ-text" data-muted="true">
                    {[placementLabel(cl.placement_id), cl.container_label].filter(Boolean).join("・")}
                  </p>
                )}
                {queued && (
                  <p className="civ-text">
                    匹数を照合済み: {queued.from}→{queued.to}匹(死亡{queued.deathCount})
                  </p>
                )}
                {promotedResult && <p className="civ-text">{promotedResult.count}体を個体化しました</p>}
                <div className="civ-roster-row">
                  <button
                    type="button"
                    className={cn("civ-interactive", "civ-button")}
                    data-variant="secondary"
                    data-compact
                    onClick={() => {
                      setReconcileOpen((o) => ({ ...o, [cl.clutch_id]: !o[cl.clutch_id] }));
                      setReconcileCounted((c) => ({ ...c, [cl.clutch_id]: c[cl.clutch_id] ?? String(current) }));
                    }}
                  >
                    匹数を照合…
                  </button>
                  <button
                    type="button"
                    className={cn("civ-interactive", "civ-button")}
                    data-variant="secondary"
                    data-compact
                    disabled={!!promotedResult}
                    onClick={() => setPromoteOpen((o) => ({ ...o, [cl.clutch_id]: !o[cl.clutch_id] }))}
                  >
                    個別容器へ分割(昇格)…
                  </button>
                </div>
                {reconcileOpen[cl.clutch_id] && (
                  <div className="civ-disclosure-body">
                    <p className="civ-text" data-muted="true">
                      現在のカウント: {current}匹
                    </p>
                    <div className="civ-field">
                      <label className="civ-label" htmlFor={`recount-${cl.clutch_id}`}>
                        今日数えた数
                      </label>
                      <input
                        id={`recount-${cl.clutch_id}`}
                        className="civ-input"
                        type="number"
                        inputMode="numeric"
                        value={reconcileCounted[cl.clutch_id] ?? ""}
                        onChange={(e) => setReconcileCounted((c) => ({ ...c, [cl.clutch_id]: e.target.value }))}
                      />
                    </div>
                    <button
                      type="button"
                      className={cn("civ-interactive", "civ-button")}
                      data-variant="primary"
                      data-compact
                      onClick={() => confirmReconcile(cl.clutch_id, current)}
                    >
                      確認へ積む
                    </button>
                  </div>
                )}
                {promoteOpen[cl.clutch_id] && (
                  <div className="civ-disclosure-body">
                    <p className="civ-text" data-muted="true">
                      現在のカウント: {effectiveCurrent}匹
                    </p>
                    <div className="civ-field">
                      <label className="civ-label" htmlFor={`promote-${cl.clutch_id}`}>
                        今日カップに分けた数
                      </label>
                      <input
                        id={`promote-${cl.clutch_id}`}
                        className="civ-input"
                        type="number"
                        inputMode="numeric"
                        value={promoteCount[cl.clutch_id] ?? ""}
                        onChange={(e) => setPromoteCount((c) => ({ ...c, [cl.clutch_id]: e.target.value }))}
                      />
                    </div>
                    <p className="civ-text" data-muted="true">
                      種・血統・孵化日はクラッチから継承します(確認のみ)。
                    </p>
                    <button
                      type="button"
                      className={cn("civ-interactive", "civ-button")}
                      data-variant="primary"
                      data-compact
                      aria-busy={promotePending === cl.clutch_id || undefined}
                      onClick={() => confirmPromote(cl.clutch_id, effectiveCurrent)}
                    >
                      昇格する
                    </button>
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ul>

      {mode === "care" && selected.size > 0 && (
        // wave-1批評指摘: 390px幅では横スクロールでなくラベル付きカード積みに
        // する(入力表なので列見出しがスクロールで隠れると何を打っているか
        // わからなくなる)。civ-care-table のみに閉じたスコープの mobile CSS
        // (globals.css)。data-label は各 th と同一文言で td::before に出す。
        <table className={cn("civ-table", "civ-care-table")}>
          <thead>
            <tr>
              <th>個体</th>
              <th>体重g</th>
              <th>体長mm</th>
              <th>Δ前回</th>
            </tr>
          </thead>
          <tbody>
            {[...selected].map((id) => {
              const ind = individuals.find((i) => i.individual_id === id);
              if (!ind) return null;
              const g = grid[id] ?? { weight: "", length: "" };
              const prev = ind.last_measurement_summary ? parseFloat(ind.last_measurement_summary) : null;
              const w = Number(g.weight);
              const delta = prev != null && g.weight !== "" && Number.isFinite(w) ? w - prev : null;
              return (
                <tr key={id}>
                  <td className="civ-cell-clip" data-label="個体" title={ind.label}>
                    {ind.label}
                  </td>
                  <td data-label="体重g">
                    <input
                      className="civ-input"
                      type="number"
                      inputMode="decimal"
                      value={g.weight}
                      onChange={(e) => setGridValue(id, "weight", e.target.value)}
                      aria-label={`${ind.label} 体重g`}
                    />
                  </td>
                  <td data-label="体長mm">
                    <input
                      className="civ-input"
                      type="number"
                      inputMode="decimal"
                      value={g.length}
                      onChange={(e) => setGridValue(id, "length", e.target.value)}
                      aria-label={`${ind.label} 体長mm`}
                    />
                  </td>
                  <td data-label="Δ前回">{delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}g` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="primary" onClick={confirm}>
        確認へ →
      </button>
      {error && (
        <p role="alert" className="civ-form-error">
          {error}
        </p>
      )}
    </div>
  );
}

const BATCH_GROUP_LABELS: Record<BatchGroup, string> = {
  measure: "計測",
  move: "移動",
  death: "死亡",
  stage: "ステージ変化",
  "clutch-reconcile": "クラッチ照合",
  "clutch-promote": "クラッチ昇格",
};

// F5b: バッチ確認。種別ごとの1行サマリ+注意行(Δマイナス)だけ個別表示。
// [N件を一括保存] = POST /observation/batch-commit のあと(オプトインなら)
// scheduleTargets を個体ごと POST /observation/schedule(best-effort)。
function BatchSummaryNode() {
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);
  // sessionStorage は SSR 時に window が無く常に null を返す。マウント前の
  // 初回クライアント render は SSR と一致させる必要がある(hydration mismatch
  // 回避)ため、読み込みは useEffect に移し BatchRosterNode と同じ
  // 「読み込み中…」ゲートを挟む(F5b/F6b で Next.js dev の 1 Issue バッジが
  // 出ていた根本原因)。
  const [draft, setDraft] = useState<BatchDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setDraft(loadBatchDraft());
    setLoaded(true);
  }, []);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [registerSchedule, setRegisterSchedule] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loaded) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }

  if (!draft || (draft.items.length === 0 && draft.rows.length === 0)) {
    return (
      <div className="civ-card">
        <p className="civ-text" data-muted="true">
          保存する内容がありません。まとめて記録からやり直してください。
        </p>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          onClick={() => navigate("obs-register-batch")}
        >
          まとめて記録へ戻る
        </button>
      </div>
    );
  }

  const counts: Partial<Record<BatchGroup, number>> = {};
  for (const r of draft.rows) counts[r.group] = (counts[r.group] ?? 0) + 1;
  const attentionRows = draft.rows.filter((r) => r.attention && !dismissed.has(r.key));

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const res = (await execute(
        { kind: "api", method: "POST", path: "/api/v1/observation/batch-commit" },
        { items: draft.items },
      )) as { results?: BatchResult[] } | undefined;
      const results = res?.results ?? [];
      let scheduledAt: string | undefined;
      if (registerSchedule && draft.scheduleTargets.length > 0) {
        let scheduledCount = 0;
        for (const t of draft.scheduleTargets) {
          try {
            // F6 単発フロー(obs-register-done.json)と同じ body 形(template は
            // ネストしたオブジェクト — ドット付きキーは FormNode 経由の submit
            // でのみ setPath される規約。ここは execute() を直接呼ぶので自分で
            // ネストする必要がある)。
            await execute(
              { kind: "api", method: "POST", path: "/api/v1/observation/schedule" },
              {
                individual_id: t.individual_id,
                stage: "unspecified",
                from: new Date().toISOString(),
                template: { stage_interval_days: { unspecified: 30 } },
              },
            );
            scheduledCount += 1;
          } catch {
            // best-effort — 1件の失敗で他個体の登録を止めない(部分失敗を隠さない
            // のは batch-commit 側の results で担保、schedule は事後の付随処理)。
          }
        }
        // 誇張ゼロ: 1件も成功しなければ「登録済み」と表示しない。
        if (scheduledCount > 0) scheduledAt = formatDateJa(todayPlusDays(30));
      }
      saveBatchResults({ results, scheduledAt });
      navigate("obs-register-batch-done");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="civ-form">
      <div className="civ-list">
        {(Object.keys(BATCH_GROUP_LABELS) as BatchGroup[])
          .filter((g) => counts[g])
          .map((g) => (
            <p key={g} className="civ-text">
              ✓ {BATCH_GROUP_LABELS[g]} {counts[g]}件
            </p>
          ))}
      </div>
      {attentionRows.length > 0 && (
        <div className="civ-list">
          <p className="civ-text" data-muted="true">
            この{attentionRows.length}件だけ見てください
          </p>
          {attentionRows.map((r) => (
            <article key={r.key} className="civ-card">
              <p className="civ-text">
                {r.label} {r.valueText} {r.deltaText}
              </p>
              <div className="civ-roster-row">
                <button
                  type="button"
                  className={cn("civ-interactive", "civ-button")}
                  data-variant="secondary"
                  data-compact
                  onClick={() => setDismissed((d) => new Set(d).add(r.key))}
                >
                  OKこのまま
                </button>
                <button
                  type="button"
                  className={cn("civ-interactive", "civ-button")}
                  data-variant="ghost"
                  data-compact
                  onClick={() => navigate("obs-register-batch")}
                >
                  測り直す
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <label className="civ-checkbox-row" htmlFor="batch-register-schedule">
        <input
          id="batch-register-schedule"
          type="checkbox"
          checked={registerSchedule}
          onChange={(e) => setRegisterSchedule(e.target.checked)}
        />
        <span className="civ-label">次の目安を登録</span>
      </label>
      <button
        type="button"
        className={cn("civ-interactive", "civ-button")}
        data-variant="primary"
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={save}
      >
        {draft.items.length}件を一括保存
      </button>
      {error && (
        <p role="alert" className="civ-form-error">
          {error}
        </p>
      )}
    </div>
  );
}

// F6b: バッチ保存後の完了表示。行ごとの Δ + クラッチ結果(照合/昇格・すでに
// 直接コミット済みの行も表示)+ 次の目安の事後表示。部分失敗(batch-commit の
// results に error)があれば行ごとに「保存できませんでした」を表示する
// (部分失敗を隠さない)。
function BatchDoneNode() {
  const navigate = useContext(NavigateCtx);
  // BatchSummaryNode と同じ理由(hydration mismatch 回避)で sessionStorage
  // 読み込みは useEffect に移す。
  const [draft, setDraft] = useState<BatchDraft | null>(null);
  const [results, setResults] = useState<BatchResults | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setDraft(loadBatchDraft());
    setResults(loadBatchResults());
    setLoaded(true);
  }, []);

  if (!loaded) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }

  if (!draft || !results) {
    return (
      <div className="civ-card">
        <p className="civ-text" data-muted="true">
          保存結果がありません。
        </p>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          onClick={() => {
            clearBatch();
            navigate("home");
          }}
        >
          ホームへ
        </button>
      </div>
    );
  }

  const measureCount = draft.rows.filter((r) => r.group === "measure").length;

  return (
    <div className="civ-form">
      <ul className="civ-list">
        {draft.rows.map((r) => {
          const result = !r.alreadyCommitted && r.itemIndex != null ? results.results[r.itemIndex] : undefined;
          const failed = result != null && result.ok === false;
          return (
            <li key={r.key}>
              <article className="civ-card">
                {failed ? (
                  <p className="civ-text">
                    {r.label}: 保存できませんでした({(result as { ok: false; error: string }).error})
                  </p>
                ) : (
                  <div className="civ-card-badges">
                    <span className="civ-text">
                      {r.label} {r.valueText}
                    </span>
                    {r.deltaText && <Badge text={r.deltaText} tone={r.attention ? "caution" : "success"} />}
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ul>
      {results.scheduledAt && measureCount > 0 && (
        <p className="civ-text">
          ✓ 次の目安 登録済み — {measureCount}件 → {results.scheduledAt} 頃(間隔30日)
        </p>
      )}
      <div className="civ-roster-row">
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          onClick={() => {
            clearBatch();
            navigate("obs-register-batch");
          }}
        >
          同じ条件でもう一度
        </button>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="primary"
          onClick={() => {
            clearBatch();
            navigate("home");
          }}
        >
          完了
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// V3-AIP-101 検索スライスA(obs-search・c7-wireframes-core5 §2 のトーン/語彙
// のみ流用: F3類似度検索/ステージ別グルーピング/F1L軽量グリッド/コールド
// スタート自動プリセットは対象外)。GET /individuals(拡張フィールド込み)+
// GET /placements を1回ずつ取得し、保存検索チップ(localStorage)+ファセット
// 絞り込み+0件緩和バー+4択ソート+下部固定バスケットをこのノード1個で完結
// させる(batch-roster と同じ縮退理由: 複数API呼び出し+行単位ローカル状態が
// 多く、既存の宣言的語彙では表現しきれない)。
// =============================================================================

type SearchRow = {
  individual_id: string;
  label: string;
  species: string | null;
  stage: string | null;
  placement_id: string | null;
  last_care_at: string | null;
  latest_weight_g: number | null;
  latest_length_mm: number | null;
  capture_count: number;
  eclosion_at: string | null;
  thumbnail_path: string | null;
};

type SearchFilters = {
  species: string | null;
  stage: string | null;
  shelf: string | null;
  lengthX: number | null;
  lengthY: number | null;
  weightX: number | null;
  weightY: number | null;
};

const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  species: null,
  stage: null,
  shelf: null,
  lengthX: null,
  lengthY: null,
  weightX: null,
  weightY: null,
};

type SearchSort = "length_desc" | "weight_desc" | "last_capture_desc" | "eclosion_desc";
const DEFAULT_SEARCH_SORT: SearchSort = "last_capture_desc";
const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  length_desc: "体長↓",
  weight_desc: "体重↓",
  last_capture_desc: "最終観測日",
  eclosion_desc: "羽化日(新しい順)",
};

// 直近使った条件(フィルタ+ソート)の自動復元キー。
const SEARCH_LAST_KEY = "ihl:obs-search-last-filter";
// 保存検索チップ。Truth 保存の是非は c7-wireframes-core5.md の open_questions
// (~L899-903)がまだ裁定待ちのため、意図的に localStorage だけに留める
// (裁定後の後続波で Truth 化を検討)。
const SEARCH_SAVED_KEY = "ihl:obs-search-saved";

type SavedSearch = { id: string; name: string; filters: SearchFilters; sort: SearchSort };

function loadLastFilter(): { filters: SearchFilters; sort: SearchSort } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SEARCH_LAST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { filters?: Partial<SearchFilters>; sort?: SearchSort };
    return {
      filters: { ...DEFAULT_SEARCH_FILTERS, ...(parsed.filters ?? {}) },
      sort: parsed.sort && parsed.sort in SEARCH_SORT_LABELS ? parsed.sort : DEFAULT_SEARCH_SORT,
    };
  } catch {
    return null;
  }
}
function saveLastFilter(filters: SearchFilters, sort: SearchSort): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEARCH_LAST_KEY, JSON.stringify({ filters, sort }));
  } catch {
    /* best effort */
  }
}
function loadSavedSearches(): SavedSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SEARCH_SAVED_KEY);
    const rows = raw ? (JSON.parse(raw) as SavedSearch[]) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
function persistSavedSearches(rows: SavedSearch[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEARCH_SAVED_KEY, JSON.stringify(rows));
  } catch {
    /* best effort */
  }
}
function filtersEqual(a: SearchFilters, b: SearchFilters): boolean {
  return (
    a.species === b.species &&
    a.stage === b.stage &&
    a.shelf === b.shelf &&
    a.lengthX === b.lengthX &&
    a.lengthY === b.lengthY &&
    a.weightX === b.weightX &&
    a.weightY === b.weightY
  );
}
function matchesFilters(row: SearchRow, f: SearchFilters): boolean {
  if (f.species != null && row.species !== f.species) return false;
  if (f.stage != null && row.stage !== f.stage) return false;
  if (f.shelf != null && row.placement_id !== f.shelf) return false;
  // 中心値・幅の両方が揃って初めてレンジが有効になる(片方だけでは絞らない —
  // 小数の完全一致で誤って0件化するのを避ける)。
  if (f.lengthX != null && f.lengthY != null) {
    if (row.latest_length_mm == null || Math.abs(row.latest_length_mm - f.lengthX) > f.lengthY) return false;
  }
  if (f.weightX != null && f.weightY != null) {
    if (row.latest_weight_g == null || Math.abs(row.latest_weight_g - f.weightX) > f.weightY) return false;
  }
  return true;
}
function facetCount(rows: SearchRow[], filters: SearchFilters, key: "species" | "stage" | "shelf", value: string): number {
  return rows.filter((r) => matchesFilters(r, { ...filters, [key]: value })).length;
}
function sortValue(row: SearchRow, sort: SearchSort): number | null {
  if (sort === "length_desc") return row.latest_length_mm;
  if (sort === "weight_desc") return row.latest_weight_g;
  const iso = sort === "eclosion_desc" ? row.eclosion_at : row.last_care_at;
  return iso ? new Date(iso).getTime() : null;
}
function sortRows(rows: SearchRow[], sort: SearchSort): SearchRow[] {
  return [...rows].sort((a, b) => {
    const av = sortValue(a, sort);
    const bv = sortValue(b, sort);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // null は末尾
    if (bv == null) return -1;
    return bv - av; // 降順
  });
}
// 主要数値(bold): ステージが成虫寄り(adult/pupa/prepupa)なら体長優先、それ
// 以外は体重優先。片方しか値が無ければ他方にフォールバック。
function primaryMeasure(row: SearchRow): { text: string; unit: string } | null {
  const lengthFirst = row.stage === "adult" || row.stage === "pupa" || row.stage === "prepupa";
  if (lengthFirst && row.latest_length_mm != null) return { text: String(row.latest_length_mm), unit: "mm" };
  if (row.latest_weight_g != null) return { text: String(row.latest_weight_g), unit: "g" };
  if (row.latest_length_mm != null) return { text: String(row.latest_length_mm), unit: "mm" };
  return null;
}

// V3-OBS-02 観測対象ナビゲータ: 学名検索(substring) / アキネーター式yes-no
// 二分探索 / 分類ツリー の3経路を1ノードに持つ(POST /observation/targets/search
// の mode:"name"|"yesno"|"tree" 3モードを叩く — テキストのみ、画像/サムネイル
// は出さない・design-c2 §3.2)。3経路とも「候補提示」止まりで、確定は末尾の
// [この対象で観測を続ける] ボタン(navigate)がユーザー操作として行う — AI/API
// 側は species_confirmed を一切書かない(候補提示と確定の分離)。選んだ学名は
// obs-entry へ species_candidate として引き継ぐ(obs-entry の species_candidate
// フィールドはユーザー編集可のプレフィルなので、確定は commit 側で改めて起きる)。
type TargetCandidate = { qid: string; scientific_name: string };

function TargetNavigatorNode() {
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);

  // 選ばれた対象(3経路のどれで決まってもここに集約)。
  const [chosen, setChosen] = useState<TargetCandidate | null>(null);

  // 経路1: 学名検索。
  const [nameQuery, setNameQuery] = useState("");
  const [nameCandidates, setNameCandidates] = useState<TargetCandidate[]>([]);
  const [namePending, setNamePending] = useState(false);
  const searchByName = useCallback(async () => {
    if (!nameQuery.trim()) return;
    setNamePending(true);
    try {
      const r = (await execute({ kind: "api", method: "POST", path: "/api/v1/observation/targets/search" }, {
        mode: "name",
        query: nameQuery,
      })) as { candidates?: TargetCandidate[] } | undefined;
      setNameCandidates(r?.candidates ?? []);
    } finally {
      setNamePending(false);
    }
  }, [execute, nameQuery]);

  // 経路2: はい・いいえ二分探索(サーバは状態を持たない — クライアントが
  // 回答列を毎回まるごと再送する、targets.test.ts と同じステートレス方式)。
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [question, setQuestion] = useState<{ pivot: string; remaining: number } | null>(null);
  const [yesnoResolved, setYesnoResolved] = useState<TargetCandidate | null>(null);
  const [yesnoAsked, setYesnoAsked] = useState(0);
  const askYesNo = useCallback(
    async (nextAnswers: boolean[]) => {
      const r = (await execute({ kind: "api", method: "POST", path: "/api/v1/observation/targets/search" }, {
        mode: "yesno",
        answers: nextAnswers,
      })) as { resolved?: { qid: string; taxonomy: { species?: string } } | null; questions_asked?: number; question?: { pivot: string; remaining: number } } | undefined;
      setAnswers(nextAnswers);
      if (r?.resolved) {
        setYesnoResolved({ qid: r.resolved.qid, scientific_name: String(r.resolved.taxonomy?.species ?? r.resolved.qid) });
        setQuestion(null);
        setYesnoAsked(r.questions_asked ?? nextAnswers.length);
      } else {
        setQuestion(r?.question ?? null);
        setYesnoResolved(null);
      }
    },
    [execute],
  );
  const startYesNo = useCallback(() => {
    setStarted(true);
    setYesnoResolved(null);
    void askYesNo([]);
  }, [askYesNo]);
  const answer = useCallback((yes: boolean) => void askYesNo([...answers, yes]), [answers, askYesNo]);

  // 経路3: 分類ツリー(family → genus → species)。
  const [treePath, setTreePath] = useState<string[]>([]);
  const [treeChildren, setTreeChildren] = useState<string[]>([]);
  const [treeResolved, setTreeResolved] = useState<TargetCandidate | null>(null);
  const loadTreeLevel = useCallback(
    async (path: string[]) => {
      const r = (await execute({ kind: "api", method: "POST", path: "/api/v1/observation/targets/search" }, {
        mode: "tree",
        path,
      })) as { children?: string[]; resolved?: { qid: string; taxonomy: { species?: string } } } | undefined;
      setTreePath(path);
      if (r?.resolved) {
        setTreeResolved({ qid: r.resolved.qid, scientific_name: String(r.resolved.taxonomy?.species ?? r.resolved.qid) });
        setTreeChildren([]);
      } else {
        setTreeResolved(null);
        setTreeChildren(r?.children ?? []);
      }
    },
    [execute],
  );
  useEffect(() => {
    void loadTreeLevel([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const continueTo = useCallback(() => {
    if (!chosen) return;
    navigate("obs-entry", { species_candidate: chosen.scientific_name });
  }, [chosen, navigate]);

  return (
    <div className="civ-target-navigator">
      <h2 className="civ-heading">学名で探す</h2>
      <div className="civ-field">
        <input
          className="civ-input"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          placeholder="例: Dynastes"
          aria-label="学名の一部"
        />
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          aria-busy={namePending || undefined}
          onClick={() => void searchByName()}
        >
          候補を探す
        </button>
      </div>
      {nameCandidates.length > 0 && (
        <ul className="civ-list">
          {nameCandidates.map((c) => (
            <li key={c.qid}>
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant={chosen?.qid === c.qid ? "primary" : "ghost"}
                onClick={() => setChosen(c)}
              >
                {c.scientific_name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="civ-heading">はい・いいえで絞る</h2>
      <p className="civ-text" data-muted="true">
        7〜12問のはい・いいえで対象を二分探索します。
      </p>
      {!started ? (
        <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="secondary" onClick={startYesNo}>
          はい・いいえ形式で始める
        </button>
      ) : yesnoResolved ? (
        <div>
          <p className="civ-text">{yesnoResolved.scientific_name}({yesnoAsked}問で確定)</p>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant={chosen?.qid === yesnoResolved.qid ? "primary" : "ghost"}
            onClick={() => setChosen(yesnoResolved)}
          >
            この候補を選ぶ
          </button>
        </div>
      ) : question ? (
        <div>
          <p className="civ-text">{question.pivot} 以降ですか?(残り約{question.remaining}件)</p>
          <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="secondary" onClick={() => answer(true)}>
            はい
          </button>
          <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="secondary" onClick={() => answer(false)}>
            いいえ
          </button>
        </div>
      ) : null}

      <h2 className="civ-heading">分類ツリーから選ぶ</h2>
      {treePath.length > 0 && (
        <p className="civ-text" data-muted="true">
          {treePath.join(" › ")}
        </p>
      )}
      {treeResolved ? (
        <div>
          <p className="civ-text">{treeResolved.scientific_name}</p>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant={chosen?.qid === treeResolved.qid ? "primary" : "ghost"}
            onClick={() => setChosen(treeResolved)}
          >
            この候補を選ぶ
          </button>
          <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="ghost" onClick={() => void loadTreeLevel([])}>
            最初から選び直す
          </button>
        </div>
      ) : (
        <ul className="civ-list">
          {treeChildren.map((child) => (
            <li key={child}>
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant="ghost"
                onClick={() => void loadTreeLevel([...treePath, child])}
              >
                {child}
              </button>
            </li>
          ))}
        </ul>
      )}

      {chosen && (
        <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="primary" onClick={continueTo}>
          この対象で観測を続ける
        </button>
      )}
    </div>
  );
}

function SearchNavigatorNode() {
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);

  const [individuals, setIndividuals] = useState<SearchRow[]>([]);
  const [placements, setPlacements] = useState<PlacementRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_SEARCH_FILTERS);
  const [sort, setSort] = useState<SearchSort>(DEFAULT_SEARCH_SORT);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);

  const [lengthXDraft, setLengthXDraft] = useState("");
  const [lengthYDraft, setLengthYDraft] = useState("");
  const [weightXDraft, setWeightXDraft] = useState("");
  const [weightYDraft, setWeightYDraft] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [basketExpanded, setBasketExpanded] = useState(false);
  const [snack, setSnack] = useState<{ ids: string[] } | null>(null);
  const snackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [ind, pl] = await Promise.all([
        execute({ kind: "api", method: "GET", path: "/api/v1/individuals" }) as Promise<
          { individuals?: SearchRow[] } | undefined
        >,
        execute({ kind: "api", method: "GET", path: "/api/v1/placements" }) as Promise<
          { placements?: PlacementRow[] } | undefined
        >,
      ]);
      if (!alive) return;
      setIndividuals((ind?.individuals ?? []).map((i) => ({ ...i, label: safeLabel(i.label, i.species) })));
      setPlacements(pl?.placements ?? []);
      setSavedSearches(loadSavedSearches());
      // 直近条件の自動復元: 「読み込み中…」ゲートの裏でここまで適用してから
      // loaded を立てるので、未フィルタの全件表示が一瞬でも画面に出ない。
      const last = loadLastFilter();
      if (last) {
        setFilters(last.filters);
        setSort(last.sort);
        setLengthXDraft(last.filters.lengthX != null ? String(last.filters.lengthX) : "");
        setLengthYDraft(last.filters.lengthY != null ? String(last.filters.lengthY) : "");
        setWeightXDraft(last.filters.weightX != null ? String(last.filters.weightX) : "");
        setWeightYDraft(last.filters.weightY != null ? String(last.filters.weightY) : "");
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 直近条件の永続化(初回ロード後のみ — 復元直後の再書き込みで壊さない)。
  useEffect(() => {
    if (!loaded) return;
    saveLastFilter(filters, sort);
  }, [loaded, filters, sort]);

  const placementLabel = useCallback(
    (id: string | null) => placements.find((p) => p.placement_id === id)?.label ?? "",
    [placements],
  );

  const speciesValues = useMemo(
    () => Array.from(new Set(individuals.map((i) => i.species).filter((v): v is string => !!v))).sort(),
    [individuals],
  );
  const stageValues = useMemo(
    () => Array.from(new Set(individuals.map((i) => i.stage).filter((v): v is string => !!v))),
    [individuals],
  );
  const shelfValues = useMemo(
    () => Array.from(new Set(individuals.map((i) => i.placement_id).filter((v): v is string => !!v))),
    [individuals],
  );

  const filtered = useMemo(() => individuals.filter((r) => matchesFilters(r, filters)), [individuals, filters]);
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const totalCaptures = filtered.reduce((sum, r) => sum + (r.capture_count ?? 0), 0);

  const commitLength = () => {
    const xRaw = lengthXDraft.trim();
    const yRaw = lengthYDraft.trim();
    const x = xRaw === "" ? null : Number(xRaw);
    const y = yRaw === "" ? null : Number(yRaw);
    setFilters((f) => ({
      ...f,
      lengthX: x != null && Number.isFinite(x) ? x : null,
      lengthY: y != null && Number.isFinite(y) ? y : null,
    }));
  };
  const commitWeight = () => {
    const xRaw = weightXDraft.trim();
    const yRaw = weightYDraft.trim();
    const x = xRaw === "" ? null : Number(xRaw);
    const y = yRaw === "" ? null : Number(yRaw);
    setFilters((f) => ({
      ...f,
      weightX: x != null && Number.isFinite(x) ? x : null,
      weightY: y != null && Number.isFinite(y) ? y : null,
    }));
  };

  const toggleFacet = (key: "species" | "stage" | "shelf", value: string) => {
    setFilters((f) => ({ ...f, [key]: f[key] === value ? null : value }));
  };

  // 0件時の緩和バー: 現在アクティブなファセット/レンジごとに「これを外したら
  // 何件になるか」を計算し、実際に効くもの(>0件)だけ1タップ導線として出す。
  const reliefOptions = useMemo(() => {
    if (sorted.length > 0) return [];
    const opts: { key: string; label: string; count: number; apply: () => void }[] = [];
    if (filters.species != null) {
      const next = { ...filters, species: null };
      const count = individuals.filter((r) => matchesFilters(r, next)).length;
      if (count > 0) opts.push({ key: "species", label: `${filters.species}を外す`, count, apply: () => setFilters(next) });
    }
    if (filters.stage != null) {
      const next = { ...filters, stage: null };
      const count = individuals.filter((r) => matchesFilters(r, next)).length;
      if (count > 0)
        opts.push({
          key: "stage",
          label: `${STAGE_LABELS_JA[filters.stage] ?? filters.stage}を外す`,
          count,
          apply: () => setFilters(next),
        });
    }
    if (filters.shelf != null) {
      const next = { ...filters, shelf: null };
      const count = individuals.filter((r) => matchesFilters(r, next)).length;
      if (count > 0)
        opts.push({ key: "shelf", label: `${placementLabel(filters.shelf) || "棚"}を外す`, count, apply: () => setFilters(next) });
    }
    if (filters.lengthX != null && filters.lengthY != null) {
      const next = { ...filters, lengthX: null, lengthY: null };
      const count = individuals.filter((r) => matchesFilters(r, next)).length;
      if (count > 0)
        opts.push({
          key: "length",
          label: "体長の範囲を外す",
          count,
          apply: () => {
            setFilters(next);
            setLengthXDraft("");
            setLengthYDraft("");
          },
        });
    }
    if (filters.weightX != null && filters.weightY != null) {
      const next = { ...filters, weightX: null, weightY: null };
      const count = individuals.filter((r) => matchesFilters(r, next)).length;
      if (count > 0)
        opts.push({
          key: "weight",
          label: "体重の範囲を外す",
          count,
          apply: () => {
            setFilters(next);
            setWeightXDraft("");
            setWeightYDraft("");
          },
        });
    }
    return opts;
  }, [sorted.length, filters, individuals, placementLabel]);

  const applyFilterState = (f: SearchFilters, s: SearchSort) => {
    setFilters(f);
    setSort(s);
    setLengthXDraft(f.lengthX != null ? String(f.lengthX) : "");
    setLengthYDraft(f.lengthY != null ? String(f.lengthY) : "");
    setWeightXDraft(f.weightX != null ? String(f.weightX) : "");
    setWeightYDraft(f.weightY != null ? String(f.weightY) : "");
  };

  const saveCurrentSearch = () => {
    const name = window.prompt("この条件を保存する名前を入力してください");
    if (!name) return;
    const entry: SavedSearch = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      filters,
      sort,
    };
    const next = [...savedSearches, entry];
    setSavedSearches(next);
    persistSavedSearches(next);
    setActiveSavedId(entry.id);
  };
  const applySavedSearch = (s: SavedSearch) => {
    applyFilterState(s.filters, s.sort);
    setActiveSavedId(s.id);
  };
  const deleteSavedSearch = (id: string) => {
    const next = savedSearches.filter((s) => s.id !== id);
    setSavedSearches(next);
    persistSavedSearches(next);
    if (activeSavedId === id) setActiveSavedId(null);
  };

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearBasket = () => {
    if (selected.size === 0) return;
    const prev = [...selected];
    setSelected(new Set());
    setBasketExpanded(false);
    if (snackTimer.current) clearTimeout(snackTimer.current);
    setSnack({ ids: prev });
    snackTimer.current = setTimeout(() => setSnack(null), 5000);
  };
  const undoClear = () => {
    if (!snack) return;
    if (snackTimer.current) clearTimeout(snackTimer.current);
    setSelected(new Set(snack.ids));
    setSnack(null);
  };

  const goToBatch = () => {
    savePreselect([...selected]);
    navigate("obs-register-batch");
  };

  if (!loaded) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }

  const basketIds = [...selected];
  const activeSaved = savedSearches.find((s) => s.id === activeSavedId) ?? null;
  const savedDirty = activeSaved != null && !filtersEqual(activeSaved.filters, filters);

  return (
    <div className="civ-form civ-search-navigator">
      <div className="civ-chip-row">
        {savedSearches.map((s) => (
          <span key={s.id} className="civ-saved-chip-wrap">
            <button
              type="button"
              className={cn("civ-interactive", "civ-badge", "civ-facet-chip")}
              data-active={s.id === activeSavedId || undefined}
              onClick={() => applySavedSearch(s)}
            >
              {s.name}
              {s.id === activeSavedId && savedDirty ? " ✱" : ""}
            </button>
            <button
              type="button"
              className={cn("civ-interactive", "civ-chip-remove")}
              aria-label={`${s.name} を削除`}
              onClick={() => deleteSavedSearch(s.id)}
            >
              ✕
            </button>
          </span>
        ))}
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="ghost"
          data-compact
          onClick={saveCurrentSearch}
        >
          ＋今の条件を保存
        </button>
      </div>

      <p className="civ-text">
        {sorted.length}個体 / {totalCaptures}枚
      </p>

      <div className="civ-disclosure" data-open={filterOpen || undefined}>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button", "civ-disclosure-trigger")}
          data-variant="secondary"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((o) => !o)}
        >
          絞り込み {filterOpen ? "▾" : "▸"}
        </button>
        {filterOpen && (
          <div className="civ-disclosure-body">
            {speciesValues.length > 0 && (
              <div className="civ-chip-row">
                {speciesValues.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={cn("civ-interactive", "civ-badge", "civ-facet-chip")}
                    data-active={filters.species === v || undefined}
                    onClick={() => toggleFacet("species", v)}
                  >
                    {v}({facetCount(individuals, filters, "species", v)})
                  </button>
                ))}
              </div>
            )}
            {stageValues.length > 0 && (
              <div className="civ-chip-row">
                {stageValues.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={cn("civ-interactive", "civ-badge", "civ-facet-chip")}
                    data-active={filters.stage === v || undefined}
                    onClick={() => toggleFacet("stage", v)}
                  >
                    {STAGE_LABELS_JA[v] ?? v}({facetCount(individuals, filters, "stage", v)})
                  </button>
                ))}
              </div>
            )}
            {shelfValues.length > 0 && (
              <div className="civ-chip-row">
                {shelfValues.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={cn("civ-interactive", "civ-badge", "civ-facet-chip")}
                    data-active={filters.shelf === v || undefined}
                    onClick={() => toggleFacet("shelf", v)}
                  >
                    {placementLabel(v) || v}({facetCount(individuals, filters, "shelf", v)})
                  </button>
                ))}
              </div>
            )}
            <div className="civ-picker-row">
              <label className="civ-label" htmlFor="search-length-x">
                体長(mm)
              </label>
              <input
                id="search-length-x"
                className="civ-input"
                type="number"
                inputMode="decimal"
                placeholder="中心値"
                value={lengthXDraft}
                onChange={(e) => setLengthXDraft(e.target.value)}
                onBlur={commitLength}
                onKeyDown={(e) => e.key === "Enter" && commitLength()}
              />
              <span className="civ-text" data-muted="true">
                ±
              </span>
              <input
                className="civ-input"
                type="number"
                inputMode="decimal"
                placeholder="幅"
                aria-label="体長の幅"
                value={lengthYDraft}
                onChange={(e) => setLengthYDraft(e.target.value)}
                onBlur={commitLength}
                onKeyDown={(e) => e.key === "Enter" && commitLength()}
              />
            </div>
            <div className="civ-picker-row">
              <label className="civ-label" htmlFor="search-weight-x">
                体重(g)
              </label>
              <input
                id="search-weight-x"
                className="civ-input"
                type="number"
                inputMode="decimal"
                placeholder="中心値"
                value={weightXDraft}
                onChange={(e) => setWeightXDraft(e.target.value)}
                onBlur={commitWeight}
                onKeyDown={(e) => e.key === "Enter" && commitWeight()}
              />
              <span className="civ-text" data-muted="true">
                ±
              </span>
              <input
                className="civ-input"
                type="number"
                inputMode="decimal"
                placeholder="幅"
                aria-label="体重の幅"
                value={weightYDraft}
                onChange={(e) => setWeightYDraft(e.target.value)}
                onBlur={commitWeight}
                onKeyDown={(e) => e.key === "Enter" && commitWeight()}
              />
            </div>
          </div>
        )}
      </div>

      {sorted.length === 0 && reliefOptions.length > 0 && (
        <div className="civ-relief-bar">
          {reliefOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              className={cn("civ-interactive", "civ-button")}
              data-variant="secondary"
              data-compact
              onClick={o.apply}
            >
              {o.label} → {o.count}件
            </button>
          ))}
        </div>
      )}
      {sorted.length === 0 && reliefOptions.length === 0 && (
        <p className="civ-text" data-muted="true">
          該当する個体がいません。
        </p>
      )}

      <div className="civ-segmented" role="radiogroup" aria-label="並び替え">
        {(Object.keys(SEARCH_SORT_LABELS) as SearchSort[]).map((k) => (
          <label key={k} className="civ-segment">
            <input type="radio" checked={sort === k} onChange={() => setSort(k)} />
            <span>{SEARCH_SORT_LABELS[k]}</span>
          </label>
        ))}
      </div>

      <ul className="civ-list">
        {sorted.map((row) => {
          const checked = selected.has(row.individual_id);
          const primary = primaryMeasure(row);
          let dateIso: string | null = null;
          let dateLabel = "";
          if (row.eclosion_at) {
            dateIso = row.eclosion_at;
            dateLabel = "羽化";
          } else if (row.last_care_at) {
            dateIso = row.last_care_at;
            dateLabel = "最終観測";
          }
          return (
            <li key={row.individual_id} className="civ-roster-row">
              <label className="civ-checkbox-row">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSelect(row.individual_id)}
                  aria-label={`${row.label} を選択`}
                />
              </label>
              <article
                className="civ-card"
                data-clickable="true"
                role="button"
                tabIndex={0}
                aria-label={`${row.label} の個体詳細を開く`}
                onClick={() => navigate("individual-detail", { id: row.individual_id })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate("individual-detail", { id: row.individual_id });
                  }
                }}
              >
                <div className="civ-card-head">
                  {row.thumbnail_path && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="civ-search-thumb" src={row.thumbnail_path} alt="" />
                  )}
                  <h3 className="civ-card-title">{row.label}</h3>
                </div>
                <div className="civ-card-badges">
                  {row.species && <Badge text={row.species} tone="neutral" />}
                  {row.stage && <Badge text={STAGE_LABELS_JA[row.stage] ?? row.stage} tone="neutral" />}
                </div>
                {primary && (
                  <p className="civ-search-primary">
                    {primary.text}
                    <span className="civ-search-primary-unit">{primary.unit}</span>
                  </p>
                )}
                <p className="civ-text" data-muted="true">
                  {dateIso ? `${dateLabel} ${relativeLabel(new Date(dateIso).getTime())}` : "観測記録なし"}
                  {`・観測${row.capture_count}回`}
                </p>
                <button
                  type="button"
                  className={cn("civ-interactive", "civ-button")}
                  data-variant="secondary"
                  data-compact
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate("obs-register-entry", { id: row.individual_id });
                  }}
                >
                  追観測 →
                </button>
              </article>
            </li>
          );
        })}
      </ul>

      {(basketIds.length > 0 || snack) && (
        <div className="civ-basket-tray">
          {snack && (
            <div className="civ-snackbar">
              <span>{snack.ids.length}個体を削除しました</span>
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant="ghost"
                data-compact
                onClick={undoClear}
              >
                元に戻す
              </button>
            </div>
          )}
          {basketIds.length > 0 && (
            <>
              <div className="civ-basket-chips">
                {(basketExpanded ? basketIds : basketIds.slice(0, 6)).map((id) => {
                  const ind = individuals.find((i) => i.individual_id === id);
                  return (
                    <span key={id} className="civ-basket-chip">
                      {ind?.label ?? id}
                      <button
                        type="button"
                        className={cn("civ-interactive", "civ-chip-remove")}
                        aria-label={`${ind?.label ?? id} を外す`}
                        onClick={() => toggleSelect(id)}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
                {!basketExpanded && basketIds.length > 6 && (
                  <button
                    type="button"
                    className={cn("civ-interactive", "civ-button")}
                    data-variant="ghost"
                    data-compact
                    onClick={() => setBasketExpanded(true)}
                  >
                    ＋{basketIds.length - 6} 一覧▾
                  </button>
                )}
              </div>
              <div className="civ-basket-actions">
                <button
                  type="button"
                  className={cn("civ-interactive", "civ-button")}
                  data-variant="ghost"
                  data-compact
                  onClick={clearBasket}
                >
                  空にする
                </button>
                <button
                  type="button"
                  className={cn("civ-interactive", "civ-button")}
                  data-variant="primary"
                  onClick={goToBatch}
                >
                  → 計測グリッドへ({basketIds.length}件)
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// V3-AIP-101 個体詳細スライスA (c7-wireframes-core5 §4 F1/F2) — growth-chart
// (手書き SVG 折れ線・依存追加なし) + individual-profile(ヘッダ/血統健全度・
// 近交リスクチップ/血縁レール/変化点タイムライン/sticky下端バーを1画面に持つ
// 専用ノード。GET /individuals/{id}/profile + /pedigree を自前取得する —
// search-navigator/batch-summary と同じ縮退)。
// =============================================================================

type ProfileMeasurement = { item: string; kind: string; value: number | string; unit?: string };
type ProfileCapture = {
  capture_id: string;
  time: string;
  measurements?: ProfileMeasurement[];
  photo_id?: string | null;
  thumbnail_path?: string | null;
};
type ProfileLifeEvent = { individual_id: string; kind: string; at: string; detail?: Record<string, unknown> };
type ProfileParentRef = { individual_id: string; label: string };
type ProfileSibling = ProfileParentRef & { dead: boolean; eclosed: boolean };
type IndividualProfile = {
  individual_id: string;
  master: { local_label_text?: string; species?: string } | null;
  name: string | null;
  species: string | null;
  stage: string | null;
  status: "alive" | "deceased";
  thumbnail_path: string | null;
  placement_id: string | null;
  schedule: { next_observation_at: string } | null;
  parents: { sire?: ProfileParentRef; dam?: ProfileParentRef };
  siblings: ProfileSibling[];
  children: ProfileParentRef[];
  observations: ProfileCapture[];
  life_events: ProfileLifeEvent[];
  parent_observations: { sire: ProfileCapture[]; dam: ProfileCapture[] };
  cohort_observations: { individual_id: string; capture_id: string; weight_g: number | null; length_mm: number | null }[];
};
type PedNode = {
  individual_id: string;
  known: boolean;
  parent_role?: string;
  circular?: boolean;
  truncated?: boolean;
  parents: PedNode[];
};

function profileLabel(profile: IndividualProfile): string {
  const raw = profile.master?.local_label_text || profile.name || profile.individual_id;
  return safeLabel(raw, profile.species);
}

function measureValue(cap: ProfileCapture, item: string): number | null {
  const m = (cap.measurements ?? []).find((mm) => mm.item === item && typeof mm.value === "number");
  return m ? (m.value as number) : null;
}

// 系列(x=経過時間[日]・系列ごとに自分の初回観測を0とする・y=値)。実観測間隔
// (envelope time)を反映するので3ヶ月間隔と3日間隔が同じ幅に見えない(ユーザー
// 裁定2026-07-12)。時刻無効/値無しの行は無視。
// ponytail: E2E seed のようにループ内で連続 POST して全点が数秒未満(ミリ秒差)
// に縮退する場合だけ観測順の等間隔にフォールバックする(degenerate は呼び出し
// 側が本個体+親♂+親♀の合算レンジで判定・実運用は日〜月オーダーの間隔が付く
// ので起きない)。
function seriesFor(
  caps: ProfileCapture[],
  item: string,
  degenerate: boolean,
): { x: number; y: number; iso: string }[] {
  const pts = caps
    .map((c) => ({ t: Date.parse(c.time), y: measureValue(c, item), iso: c.time }))
    .filter((pt): pt is { t: number; y: number; iso: string } => Number.isFinite(pt.t) && pt.y != null)
    .sort((a, b) => a.t - b.t);
  if (pts.length === 0) return [];
  const t0 = pts[0].t;
  return pts.map((pt, i) => ({ x: degenerate ? i : (pt.t - t0) / 86_400_000, y: pt.y, iso: pt.iso }));
}

// 本個体+親♂+親♀を合算した実時刻レンジが1分未満なら「ミリ秒差で縮退」とみなす
// (E2E seed 判定用の閾値。実運用の採取間隔は最短でも時間〜日オーダー)。
function isDegenerate(seriesCaps: ProfileCapture[][]): boolean {
  const ts = seriesCaps.flat().map((c) => Date.parse(c.time)).filter((t) => Number.isFinite(t));
  return ts.length > 1 && Math.max(...ts) - Math.min(...ts) < 60_000;
}

const CHART_UNITS = [
  { value: "weight", label: "体重(g)" },
  { value: "length", label: "体長(mm)" },
] as const;
type ChartUnit = (typeof CHART_UNITS)[number]["value"];
const CHART_UNIT_SUFFIX: Record<ChartUnit, string> = { weight: "g", length: "mm" };
// axis labels stay short (小さく) — round to 1 decimal only when needed.
const fmtAxisVal = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// V3-AIP-101 新レンダラ部品 growth-chart: 本個体実線+親破線オーバーレイ+
// コホート(兄弟)min-max帯を手書き SVG で描く(チャートライブラリ非依存)。
// 親カーブ欠損(購入個体等 [訂正8])はⓘ帯+親リンクの小フォームを内包し、
// エラーではなく第一級の正常状態として描く。でっち上げの「同種標準帯」は
// 実データが無いため描かない(誇張ゼロ)。
function GrowthChartView({ profile, onLinked }: { profile: IndividualProfile; onLinked: () => void }) {
  const execute = useContext(ExecuteCtx);
  const [unit, setUnit] = useState<ChartUnit>("weight");
  const [linkOpen, setLinkOpen] = useState(false);
  const [sireId, setSireId] = useState("");
  const [damId, setDamId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const degenerate = isDegenerate([
    profile.observations,
    profile.parent_observations.sire,
    profile.parent_observations.dam,
  ]);
  const own = seriesFor(profile.observations, unit, degenerate);
  const sire = seriesFor(profile.parent_observations.sire, unit, degenerate);
  const dam = seriesFor(profile.parent_observations.dam, unit, degenerate);
  const cohortValues = profile.cohort_observations
    .map((o) => (unit === "weight" ? o.weight_g : o.length_mm))
    .filter((v): v is number => v != null);
  // コホート帯は3点以上の実データがある時だけ(でっち上げの基準帯を描かない)。
  const cohortBand: [number, number] | null =
    cohortValues.length >= 3 ? [Math.min(...cohortValues), Math.max(...cohortValues)] : null;
  const noParentLink = !profile.parents.sire && !profile.parents.dam;

  const allY = [...own, ...sire, ...dam].map((pt) => pt.y).concat(cohortBand ?? []);
  const maxX = Math.max(1, ...[...own, ...sire, ...dam].map((pt) => pt.x));
  // fix#2(磨き直し): axis hints need the REAL data min/max (not baselined at 0)
  // so the two small numbers at the left edge mean something ("45g"/"120g").
  // A little headroom (8%) keeps points off the very edge of the plot.
  const rawMin = allY.length ? Math.min(...allY) : null;
  const rawMax = allY.length ? Math.max(...allY) : null;
  const yPad = rawMin != null && rawMax != null ? (rawMax - rawMin) * 0.08 || Math.max(1, rawMax * 0.1) : 1;
  const yMin = rawMin != null ? rawMin - yPad : 0;
  const yMax = rawMax != null ? rawMax + yPad : 1;
  const unitSuffix = CHART_UNIT_SUFFIX[unit];
  const W = 320;
  const H = 160;
  const PAD_L = 28; // room for the y-axis min/max labels at the left edge
  const PAD_R = 8;
  const PAD_T = 12; // room for the top (max) label
  const PAD_B = 16; // room for the x-axis date labels
  const px = (x: number) => PAD_L + (x / maxX) * (W - PAD_L - PAD_R);
  const py = (y: number) => H - PAD_B - ((y - yMin) / (yMax - yMin || 1)) * (H - PAD_T - PAD_B);
  const pathOf = (pts: { x: number; y: number }[]) =>
    pts.map((pt, i) => `${i === 0 ? "M" : "L"}${px(pt.x).toFixed(1)},${py(pt.y).toFixed(1)}`).join(" ");
  // 最大3本の水平グリッド線(上端・中央・下端) — 親破線が「宙に浮いて見える」
  // 問題を、目盛りの手がかりで解消する(fix#2)。
  const gridYs = [PAD_T, (PAD_T + (H - PAD_B)) / 2, H - PAD_B];

  const submitLink = async () => {
    if (!sireId.trim() && !damId.trim()) return;
    setPending(true);
    setError(null);
    try {
      if (sireId.trim()) {
        await execute(
          { kind: "api", method: "POST", path: `/api/v1/individuals/${profile.individual_id}/parents` },
          { parent_id: sireId.trim(), parent_role: "sire" },
        );
      }
      if (damId.trim()) {
        await execute(
          { kind: "api", method: "POST", path: `/api/v1/individuals/${profile.individual_id}/parents` },
          { parent_id: damId.trim(), parent_role: "dam" },
        );
      }
      onLinked();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="civ-growth-chart">
      <div className="civ-segmented" role="radiogroup" aria-label="表示単位">
        {CHART_UNITS.map((u) => (
          <label key={u.value} className="civ-segment">
            <input type="radio" checked={unit === u.value} onChange={() => setUnit(u.value)} />
            <span>{u.label}</span>
          </label>
        ))}
      </div>

      {noParentLink && (
        <div className="civ-info-banner">
          <p className="civ-text">ⓘ 親データ無し — 親をリンクすると比較が始まります。</p>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="ghost"
            data-compact
            aria-expanded={linkOpen}
            onClick={() => setLinkOpen((o) => !o)}
          >
            親をリンク {linkOpen ? "▾" : "▸"}
          </button>
          {linkOpen && (
            <div className="civ-disclosure-body">
              <div className="civ-field">
                <label className="civ-label" htmlFor="chart-sire-id">
                  親♂の個体ID(任意)
                </label>
                <input
                  id="chart-sire-id"
                  className="civ-input"
                  value={sireId}
                  onChange={(e) => setSireId(e.target.value)}
                />
              </div>
              <div className="civ-field">
                <label className="civ-label" htmlFor="chart-dam-id">
                  親♀の個体ID(任意)
                </label>
                <input
                  id="chart-dam-id"
                  className="civ-input"
                  value={damId}
                  onChange={(e) => setDamId(e.target.value)}
                />
              </div>
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant="primary"
                data-compact
                data-loading={pending || undefined}
                disabled={pending}
                onClick={submitLink}
              >
                リンクする
              </button>
              {error && (
                <span role="alert" className="civ-field-error">
                  {error}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {own.length === 0 ? (
        <p className="civ-empty">まだ観測がありません</p>
      ) : own.length === 1 ? (
        // fix#5(磨き直し): 点1つ+広い空白の代わりに、小さい枠+点の下の1行に留める。
        <div className="civ-growth-chart-single">
          <svg className="civ-growth-chart-svg" viewBox={`0 0 ${W} 56`} role="img" aria-label="成長曲線(観測1回)">
            <circle cx={W / 2} cy={28} r={3} fill="var(--civ-primary)" />
            <text x={W / 2 + 8} y={32} className="civ-chart-axis-label">
              {fmtAxisVal(own[0].y)}
              {unitSuffix}
            </text>
          </svg>
          <p className="civ-text" data-muted="true">
            観測1回 — 2回目からカーブになります
          </p>
        </div>
      ) : (
        <>
          <svg className="civ-growth-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="成長曲線">
            {gridYs.map((gy, i) => (
              <line key={i} x1={PAD_L} x2={W - PAD_R} y1={gy} y2={gy} stroke="var(--civ-border)" strokeWidth="1" />
            ))}
            {cohortBand && (
              <rect
                x={PAD_L}
                y={py(cohortBand[1])}
                width={W - PAD_L - PAD_R}
                height={Math.max(1, py(cohortBand[0]) - py(cohortBand[1]))}
                fill="var(--civ-surface-2)"
              />
            )}
            {sire.length > 0 && (
              <path d={pathOf(sire)} fill="none" stroke="var(--civ-text-muted)" strokeWidth="1.5" strokeDasharray="6 3" />
            )}
            {dam.length > 0 && (
              <path d={pathOf(dam)} fill="none" stroke="var(--civ-text-muted)" strokeWidth="1.5" strokeDasharray="2 2" />
            )}
            <path d={pathOf(own)} fill="none" stroke="var(--civ-primary)" strokeWidth="2" />
            {own.map((pt, i) => (
              <circle key={i} cx={px(pt.x)} cy={py(pt.y)} r={2.5} fill="var(--civ-primary)" />
            ))}
            {/* fix#2(磨き直し): Y軸min/max・X軸最初/最後の観測日を小さく添える。 */}
            {rawMax != null && (
              <text x={2} y={py(rawMax) + 3} className="civ-chart-axis-label">
                {fmtAxisVal(rawMax)}
                {unitSuffix}
              </text>
            )}
            {rawMin != null && (
              <text x={2} y={py(rawMin) + 3} className="civ-chart-axis-label">
                {fmtAxisVal(rawMin)}
                {unitSuffix}
              </text>
            )}
            <text x={px(own[0].x)} y={H - 2} className="civ-chart-axis-label" textAnchor="start">
              {formatDateJa(own[0].iso)}
            </text>
            <text x={px(own[own.length - 1].x)} y={H - 2} className="civ-chart-axis-label" textAnchor="end">
              {formatDateJa(own[own.length - 1].iso)}
            </text>
          </svg>
          <div className="civ-chip-row">
            <span className="civ-text" data-muted="true">
              ● 本個体
            </span>
            {sire.length > 0 && (
              <span className="civ-text" data-muted="true">
                ┄┄ 親♂
              </span>
            )}
            {dam.length > 0 && (
              <span className="civ-text" data-muted="true">
                ┈┈ 親♀
              </span>
            )}
            {cohortBand && (
              <span className="civ-text" data-muted="true">
                ▧ 同腹帯(n={cohortValues.length})
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// 標準の source_path 自前取得ラッパー(単独 screen-def ノードとしても宣言可能)。
// individual-profile から使う時は data を直接渡す(GrowthChartView 参照)ので
// 二重取得しない。
function GrowthChartNode({ node }: { node: ScreenNode }) {
  useSource(node);
  const scope = useContext(ScopeCtx);
  const navigate = useContext(NavigateCtx);
  const profile = getPath(scope, `data.${node.id}`) as IndividualProfile | undefined;
  if (!profile) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }
  return (
    <GrowthChartView
      profile={profile}
      onLinked={() => navigate("individual-detail", { id: profile.individual_id })}
    />
  );
}

// Wright の近交係数 F = Σ (1/2)^(n1+n2+1)・(1+F_A)。共通祖先自身の近交係数
// F_A はこのスライスでは 0 と仮定する簡易版(ponytail: 祖先の近交まで遡ると
// 要件の「深さ4世代」を超えて再帰することになり過剰実装 — 精密版が要るなら
// 別途要件化してから)。深さは sire/dam=世代1 として祖先3世代先(計4世代)まで。
function collectAncestors(node: PedNode | undefined, depth: number, out: { id: string; depth: number }[]): void {
  if (!node || !node.known) return;
  out.push({ id: node.individual_id, depth });
  if (depth >= 3) return;
  for (const parent of node.parents ?? []) collectAncestors(parent, depth + 1, out);
}
function inbreedingCoefficient(pedigree: PedNode | null): number | null {
  if (!pedigree) return null;
  const sireNode = pedigree.parents?.find((n) => n.parent_role === "sire");
  const damNode = pedigree.parents?.find((n) => n.parent_role === "dam");
  if (!sireNode?.known || !damNode?.known) return null;
  const sireAnc: { id: string; depth: number }[] = [];
  const damAnc: { id: string; depth: number }[] = [];
  collectAncestors(sireNode, 0, sireAnc);
  collectAncestors(damNode, 0, damAnc);
  let f = 0;
  for (const d of damAnc) for (const s of sireAnc) if (s.id === d.id) f += Math.pow(0.5, s.depth + d.depth + 1);
  return f;
}

// fix#3(磨き直し): F係数に語+トーンを添える。あくまで表示上の目安(自動確定
// ではない・認定文言は出さない)。
// ponytail: 閾値は暫定・裁定で調整可。
function inbreedingTone(f: number): { symbol: string; word: string } {
  if (f < 0.0625) return { symbol: "●", word: "低" };
  if (f < 0.125) return { symbol: "▲", word: "中" };
  return { symbol: "⚠", word: "高" };
}

// 血統健全度(同腹N匹・死亡率・羽化到達率)。siblings が空(単体登録・購入個体)
// なら算出母数が無いので null(「同腹集計なし」の第一級表示に回す)。
// fix#4(磨き直し): 死亡率に良し悪し語を添える(羽化到達は語なし)。母数5未満
// は smallSample フラグで「(母数小)」を誠実に併記する。
function computeHealth(profile: IndividualProfile) {
  if (profile.siblings.length === 0) return null;
  const cohortSize = profile.siblings.length + 1;
  const selfEclosed = profile.life_events.some((e) => e.kind === "eclosion");
  const deathCount = profile.siblings.filter((s) => s.dead).length + (profile.status === "deceased" ? 1 : 0);
  const eclosionCount = profile.siblings.filter((s) => s.eclosed).length + (selfEclosed ? 1 : 0);
  const deathPct = Math.round((deathCount / cohortSize) * 100);
  const deathTone =
    deathPct < 10 ? { symbol: "●", word: "良" } : deathPct < 30 ? { symbol: "▲", word: "注意" } : { symbol: "⚠", word: "高" };
  return {
    cohortSize,
    deathCount,
    deathPct,
    deathTone,
    eclosionCount,
    eclosionPct: Math.round((eclosionCount / cohortSize) * 100),
    smallSample: cohortSize < 5,
  };
}

// ●badge▾メニュー(死亡記録+QR再発行)。確認は既存 death-toggle と同じ「必須
// チェックボックス+ボタン」の流儀(ネイティブ confirm() は使わない・指摘6)。
function StatusMenu({ profile, onChanged }: { profile: IndividualProfile; onChanged: () => void }) {
  const execute = useContext(ExecuteCtx);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cohortSize = profile.siblings.length + 1;

  const recordDeath = async () => {
    if (!confirmed) return;
    setPending(true);
    setError(null);
    try {
      await execute(
        { kind: "api", method: "POST", path: `/api/v1/individuals/${profile.individual_id}/life-events` },
        { kind: "death", at: new Date().toISOString() },
      );
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };
  const reissueQr = async () => {
    setPending(true);
    setError(null);
    try {
      await execute({ kind: "api", method: "POST", path: `/api/v1/individuals/${profile.individual_id}/qr` });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="civ-disclosure" data-open={open || undefined}>
      <button
        type="button"
        className={cn("civ-interactive", "civ-badge", "civ-disclosure-trigger")}
        data-tone={profile.status === "deceased" ? "neutral" : "success"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {profile.status === "deceased" ? "●死亡" : "●飼育中"} {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="civ-disclosure-body">
          {profile.status !== "deceased" && (
            <div className="civ-field">
              <label className="civ-checkbox-row">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span className="civ-label">
                  死亡として記録することを確認しました(同腹{cohortSize}匹の集計母数が変わります。記録の削除はできません)
                </span>
              </label>
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant="secondary"
                data-compact
                disabled={!confirmed || pending}
                onClick={recordDeath}
              >
                死亡を記録する
              </button>
            </div>
          )}
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="ghost"
            data-compact
            disabled={pending}
            onClick={reissueQr}
          >
            🖨 QRラベル再発行
          </button>
          {error && (
            <span role="alert" className="civ-field-error">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// 死亡個体の「誤記録を訂正 ▸」— append-only の survival_correction を追記する
// (元の death レコードは消さない・不変条項③)。生存中は非表示。
function SurvivalCorrectionLink({ profile, onChanged }: { profile: IndividualProfile; onChanged: () => void }) {
  const execute = useContext(ExecuteCtx);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (profile.status !== "deceased") return null;

  const submit = async () => {
    if (!confirmed) return;
    setPending(true);
    setError(null);
    try {
      await execute(
        { kind: "api", method: "POST", path: `/api/v1/individuals/${profile.individual_id}/life-events` },
        { kind: "survival_correction", at: new Date().toISOString() },
      );
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="civ-disclosure" data-open={open || undefined}>
      <button
        type="button"
        className={cn("civ-interactive", "civ-button", "civ-disclosure-trigger")}
        data-variant="ghost"
        data-compact
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        誤記録を訂正 {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="civ-disclosure-body">
          <label className="civ-checkbox-row">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span className="civ-label">死亡記録は誤りで生存していることを確認しました(元の記録は消さず訂正レコードを追記します)</span>
          </label>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="secondary"
            data-compact
            disabled={!confirmed || pending}
            onClick={submit}
          >
            訂正を記録する
          </button>
          {error && (
            <span role="alert" className="civ-field-error">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function KinshipChip({ label, muted, onClick }: { label: string; muted?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn("civ-interactive", "civ-card", "civ-recent-chip")}
      data-muted={muted || undefined}
      onClick={onClick}
    >
      <span className="civ-card-title">{label}</span>
    </button>
  );
}

// 変化点タイムライン: observations + life_events をマージし新しい順に描く。
type TimelineEntry =
  | { kind: "capture"; at: number; atIso: string; capture: ProfileCapture }
  | { kind: "life"; at: number; atIso: string; event: ProfileLifeEvent };
const LIFE_ICON: Record<string, string> = {
  birth: "🐣",
  molt: "🔄",
  death: "☠",
  eclosion: "🦋",
  specimen: "🏺",
  move: "📦",
  survival_correction: "↩",
};
const LIFE_LABEL_JA: Record<string, string> = {
  birth: "誕生",
  molt: "脱皮",
  death: "死亡",
  eclosion: "羽化",
  specimen: "標本化",
  move: "移動",
  survival_correction: "生存訂正(誤記録の訂正)",
};
function buildTimeline(profile: IndividualProfile): TimelineEntry[] {
  const caps: TimelineEntry[] = profile.observations
    .map((c) => ({ kind: "capture" as const, at: Date.parse(c.time), atIso: c.time, capture: c }))
    .filter((e) => Number.isFinite(e.at));
  const life: TimelineEntry[] = profile.life_events
    .map((e) => ({ kind: "life" as const, at: Date.parse(e.at), atIso: e.at, event: e }))
    .filter((e) => Number.isFinite(e.at));
  return [...caps, ...life].sort((a, b) => a.at - b.at);
}
// 直近の同一項目値(訂正の「記録値 X → 訂正後」表示・Δ計算の両方に使う)。
// observations は backend で capture_id(ULID)昇順=時刻順が保証されている。
function prevValueFn(observations: ProfileCapture[]) {
  return (captureId: string, item: string): number | null => {
    const idx = observations.findIndex((o) => o.capture_id === captureId);
    for (let i = idx - 1; i >= 0; i--) {
      const v = measureValue(observations[i], item);
      if (v != null) return v;
    }
    return null;
  };
}

// タイムライン計測行の「値を訂正 ▸」— 新しい capture を append するだけ(元の
// 記録は消さない)。POST /observation/captures は既存の単発計測エンドポイント
// (obs-register-confirm の /solid-observation/commit と同じ Truth 型)。
function CorrectionForm({
  individualId,
  item,
  unit,
  current,
  onDone,
}: {
  individualId: string;
  item: string;
  unit: string;
  current: number;
  onDone: () => void;
}) {
  const execute = useContext(ExecuteCtx);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    setPending(true);
    setError(null);
    try {
      await execute(
        { kind: "api", method: "POST", path: "/api/v1/observation/captures" },
        {
          domain: "biology",
          subject_ref: `individual/${individualId}`,
          measurements: [{ item, kind: "number", value: n, unit, value_origin: "direct_observed" }],
        },
      );
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="civ-disclosure-body">
      <p className="civ-text" data-muted="true">
        記録値 {current}
        {unit} → 訂正後の値
      </p>
      <div className="civ-picker-row">
        <input
          className="civ-input"
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          data-compact
          disabled={pending || value.trim() === ""}
          onClick={submit}
        >
          訂正を記録する
        </button>
      </div>
      <p className="civ-text" data-muted="true">
        元の記録は消しません。訂正は append-only の新レコードとして追記します。
      </p>
      {error && (
        <span role="alert" className="civ-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

function TimelineRow({
  entry,
  prevValueOf,
  individualId,
  onChanged,
}: {
  entry: TimelineEntry;
  prevValueOf: (captureId: string, item: string) => number | null;
  individualId: string;
  onChanged: () => void;
}) {
  const [openCorrection, setOpenCorrection] = useState(false);
  if (entry.kind === "life") {
    return (
      <li className="civ-timeline-row">
        <span aria-hidden="true">{LIFE_ICON[entry.event.kind] ?? "•"}</span>
        <span className="civ-text">
          {formatDateJa(entry.atIso)} {LIFE_LABEL_JA[entry.event.kind] ?? entry.event.kind}
        </span>
      </li>
    );
  }
  const cap = entry.capture;
  const ms = (cap.measurements ?? []).filter((m): m is ProfileMeasurement & { value: number } => typeof m.value === "number");
  return (
    <li className="civ-timeline-row">
      <span aria-hidden="true">📏</span>
      {cap.thumbnail_path && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="civ-timeline-thumb" src={cap.thumbnail_path} alt="" />
      )}
      <span className="civ-text">
        {formatDateJa(entry.atIso)}{" "}
        {ms.map((m, i) => {
          const prev = prevValueOf(cap.capture_id, m.item);
          const delta = prev != null ? m.value - prev : null;
          const sign = delta != null ? (delta > 0 ? "+" : delta < 0 ? "" : "±") : "";
          return (
            <span key={i}>
              {m.value}
              {m.unit ?? ""}
              {delta != null ? ` (${sign}${delta.toFixed(1)}${m.unit ?? ""})` : ""}
              {i < ms.length - 1 ? "・" : ""}
            </span>
          );
        })}
      </span>
      {ms.length > 0 && (
        <div className="civ-disclosure" data-open={openCorrection || undefined}>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button", "civ-disclosure-trigger")}
            data-variant="ghost"
            data-compact
            aria-expanded={openCorrection}
            onClick={() => setOpenCorrection((o) => !o)}
          >
            値を訂正 {openCorrection ? "▾" : "▸"}
          </button>
          {openCorrection && (
            <CorrectionForm
              individualId={individualId}
              item={ms[0].item}
              unit={ms[0].unit ?? ""}
              current={ms[0].value}
              onDone={onChanged}
            />
          )}
        </div>
      )}
    </li>
  );
}

// V3-AIP-101 個体詳細スライスA 本体。ヘッダ/判断3指標/血縁レール/タイムライン
// /sticky下端バーを1画面に持つ(search-navigator/batch-summary と同じ縮退)。
function IndividualProfileNode() {
  const scope = useContext(ScopeCtx);
  const navigate = useContext(NavigateCtx);
  const execute = useContext(ExecuteCtx);
  const id = String(scope.params.id ?? "");
  const fromId = scope.params.from;
  const [profile, setProfile] = useState<IndividualProfile | null>(null);
  const [pedigree, setPedigree] = useState<PedNode | null>(null);
  // fix#1(磨き直し): placement_id→ラベル解決用(GET /placements は既存 BatchRoster
  // /search-navigator と同じ「無ければ非表示」の縮退。取れなければ [] のまま)。
  const [placements, setPlacements] = useState<PlacementRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [prof, ped, pl] = await Promise.all([
          execute({ kind: "api", method: "GET", path: `/api/v1/individuals/${id}/profile` }) as Promise<IndividualProfile>,
          execute({ kind: "api", method: "GET", path: `/api/v1/individuals/${id}/pedigree` }) as Promise<PedNode>,
          (execute({ kind: "api", method: "GET", path: "/api/v1/placements" }) as Promise<
            { placements?: PlacementRow[] } | undefined
          >).catch(() => undefined),
        ]);
        if (!alive) return;
        setProfile(prof);
        setPedigree(ped);
        setPlacements(pl?.placements ?? []);
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const refresh = useCallback(() => navigate("individual-detail", { id }), [navigate, id]);
  const timeline = useMemo(() => (profile ? buildTimeline(profile).slice().reverse() : []), [profile]);
  const prevValueOf = useMemo(() => prevValueFn(profile?.observations ?? []), [profile]);

  if (!loaded) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }
  if (notFound || !profile) {
    return <p className="civ-empty">個体が見つかりません。</p>;
  }

  const label = profileLabel(profile);
  const stageLabel = profile.stage ? STAGE_LABELS_JA[profile.stage] ?? profile.stage : null;
  const placementLabel = placements.find((p) => p.placement_id === profile.placement_id)?.label ?? null;
  const fCoef = inbreedingCoefficient(pedigree);
  const fTone = fCoef != null ? inbreedingTone(fCoef) : null;
  const health = computeHealth(profile);
  const gotoIndividual = (targetId: string) => navigate("individual-detail", { id: targetId, from: id });
  const hasKin = !!profile.parents.sire || !!profile.parents.dam || profile.children.length > 0 || profile.siblings.length > 0;

  return (
    <div className="civ-individual-profile">
      <section className="civ-card">
        <div className="civ-card-head">
          {profile.thumbnail_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="civ-profile-thumb" src={profile.thumbnail_path} alt="" />
          )}
          <h2 className="civ-card-title">{label}</h2>
          <StatusMenu profile={profile} onChanged={refresh} />
        </div>
        {/* fix#1(磨き直し): obs-register-entry ヘッダと同じ言語(種/ステージ/棚を
            badge で並べる) — placement_id はラベル解決できた時だけ出す。 */}
        {(profile.species || stageLabel || placementLabel) && (
          <div className="civ-card-badges">
            {profile.species && <Badge text={profile.species} tone="neutral" />}
            {stageLabel && <Badge text={stageLabel} tone="neutral" />}
            {placementLabel && <Badge text={placementLabel} tone="neutral" />}
          </div>
        )}
        {profile.schedule && (
          <p className="civ-text" data-muted="true">
            次の目安 {formatDateJa(profile.schedule.next_observation_at)} 頃
          </p>
        )}
        <SurvivalCorrectionLink profile={profile} onChanged={refresh} />
      </section>

      <div className="civ-indicator-row">
        <section className="civ-card civ-growth-chart-card">
          <h3 className="civ-card-title">成長</h3>
          <GrowthChartView profile={profile} onLinked={refresh} />
        </section>
        <div className="civ-indicator-side">
          <section className="civ-card">
            <h3 className="civ-card-title">血統健全度</h3>
            {health ? (
              <>
                <p className="civ-text" data-muted="true">
                  同腹 {health.cohortSize}匹{health.smallSample ? "(母数小)" : ""}
                </p>
                <p className="civ-text">
                  死亡率 {health.deathPct}%{" "}
                  <span className="civ-text" data-muted="true">
                    ({health.deathCount}/{health.cohortSize})
                  </span>{" "}
                  {health.deathTone.symbol}
                  {health.deathTone.word}
                </p>
                <p className="civ-text">
                  羽化到達 {health.eclosionPct}%{" "}
                  <span className="civ-text" data-muted="true">
                    ({health.eclosionCount}/{health.cohortSize})
                  </span>
                </p>
              </>
            ) : (
              <p className="civ-text" data-muted="true">
                同腹集計なし(単体登録)
              </p>
            )}
          </section>
          <section className="civ-card">
            <h3 className="civ-card-title">近交リスク</h3>
            {fCoef != null && fTone ? (
              <p className="civ-text">
                F = {fCoef.toFixed(3)} {fTone.symbol}
                {fTone.word}
                {fCoef === 0 ? "(共通祖先なし)" : ""}
              </p>
            ) : (
              <p className="civ-text" data-muted="true">
                算定不能(血統データ無し)
              </p>
            )}
          </section>
        </div>
      </div>

      <section className="civ-card">
        <h3 className="civ-card-title">血縁</h3>
        {fromId && (
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="ghost"
            data-compact
            onClick={() => navigate("individual-detail", { id: fromId })}
          >
            ← 前の個体に戻る
          </button>
        )}
        {hasKin ? (
          <div className="civ-chip-row">
            {profile.parents.sire && (
              <KinshipChip
                label={`♂ ${profile.parents.sire.label}`}
                onClick={() => gotoIndividual(profile.parents.sire!.individual_id)}
              />
            )}
            {profile.parents.dam && (
              <KinshipChip
                label={`♀ ${profile.parents.dam.label}`}
                onClick={() => gotoIndividual(profile.parents.dam!.individual_id)}
              />
            )}
            <Badge text={`${label}(この個体)`} tone="neutral" />
            {profile.children.map((c) => (
              <KinshipChip key={c.individual_id} label={c.label} onClick={() => gotoIndividual(c.individual_id)} />
            ))}
            {profile.siblings.map((s) => (
              <KinshipChip
                key={s.individual_id}
                label={s.dead ? `${s.label}(死亡)` : s.label}
                muted={s.dead}
                onClick={() => gotoIndividual(s.individual_id)}
              />
            ))}
          </div>
        ) : (
          <p className="civ-text" data-muted="true">
            血縁情報なし(単体登録)
          </p>
        )}
      </section>

      <section className="civ-card">
        <h3 className="civ-card-title">変化点タイムライン</h3>
        {timeline.length === 0 ? (
          <p className="civ-empty">記録がまだありません。</p>
        ) : (
          <ul className="civ-list civ-timeline">
            {timeline.map((entry, i) => (
              <TimelineRow key={i} entry={entry} prevValueOf={prevValueOf} individualId={id} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>

      <div className="civ-sticky-bar">
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="primary"
          onClick={() => navigate("obs-register-entry", { id })}
        >
          📏 {label}に記録を追加
        </button>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          onClick={() => {
            savePreselect([id]);
            navigate("obs-register-batch");
          }}
        >
          まとめて記録へ
        </button>
      </div>
    </div>
  );
}

// V3-AIP-101 c8 knowledge-thread — per-post avatar/handle/body/cite/action row
// (Path B dedicated node: catalog c8-ui-asset-catalog.md 【最優先2】 — the
// generic `list` node's item_text is text+image only and cannot express a
// per-post avatar + inline actions). Self-fetches its own thread (same
// convention as individual-profile/search-navigator) instead of depending on
// a sibling list node's source_path.
type ThreadPost = {
  post_id: string;
  actor_id: string;
  channel: string;
  topic: string;
  board_kind: string;
  body: string;
  created_at: string;
  reply_to?: string;
  cite_refs?: Array<{ type: string; id: string; label?: string }>;
  tags?: string[];
};
type ThreadView = {
  thread_id: string;
  channel: string;
  topic: string;
  posts: ThreadPost[];
  tombstones?: Array<{ ref: { type: string; id: string }; reason: string }>;
};

// The avatar monogram is derived FROM the real actor_id (not an invented
// name) — same honesty bar as the short-hash label next to it. A self-
// reported display_name (ihl.actor.display_name.v1, c8 UI磨き第2弾#5) may
// additionally exist now; monogram stays id-derived either way (a stable,
// always-available glyph even before the name has resolved/if never set).
function monogram(actorId: string): string {
  return actorId.trim().slice(0, 1).toUpperCase() || "?";
}

// actor_id is a 64-char hex hash (deriveActorId) — showing it in full breaks
// mobile (390px) layout (V3-AIP-101 c8 screenshot gate caught this: the raw
// id overflowed the viewport instead of wrapping). Truncate for display; the
// full id still round-trips via the title attribute for anyone who needs to
// copy it (e.g. into the dispute screen's respondent_id field).
function shortActorId(actorId: string): string {
  return actorId.length > 12 ? `${actorId.slice(0, 10)}…` : actorId;
}

// c8 UI磨き第2弾#5(受領10・actor_id 生ハッシュ露出の解消): actor 表示プリミティブ。
// display_name があればそれを、無ければ shortActorId フォールバックを表示する。
// module-level cache は同一 actor_id が同一画面内で何度も出る(スレの各投稿・
// 入札テーブルの各行等)ため、per-instance に毎回 fetch させない最小の共有(React
// state ではなく素朴な Map ひとつ — 新アーキテクチャは要らない)。"" はキャッシュ
// 済みだが display_name 未設定を意味し、再フェッチしない。
const actorNameCache = new Map<string, string>();

function ActorLabel({ actorId }: { actorId: string }) {
  const execute = useContext(ExecuteCtx);
  const [name, setName] = useState<string>(() => actorNameCache.get(actorId) ?? "");
  useEffect(() => {
    if (!actorId || actorNameCache.has(actorId)) return;
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path: `/api/v1/users/${actorId}/profile` }))
      .then((r) => {
        const dn = String((r as { display_name?: string } | undefined)?.display_name ?? "");
        actorNameCache.set(actorId, dn);
        if (alive) setName(dn);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId]);
  return <span title={actorId}>{name || shortActorId(actorId)}</span>;
}

// c8 UI磨き第2弾#3(受領10「『…』のなかに畳んで」): a kebab ("⋮") trigger that
// reveals its children on tap and closes again on: (a) selecting a menu item
// (click bubbles from the item up to the wrapping div — this fires AFTER the
// item's own onClick, so the action already ran) or (b) an outside click.
// Renderer primitive, not a declarative NodeType — the one concrete case this
// wave has (knowledge-thread's per-post "この投稿を相談室へ") lives inside a
// dedicated node (ThreadPostsNode), not a JSON screen-def; a table row-actions
// cell is the natural next caller if one shows up (not built speculatively).
function KebabMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);
  return (
    <div className="civ-kebab" ref={ref}>
      <button
        type="button"
        className={cn("civ-interactive", "civ-kebab-trigger")}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        ⋮
      </button>
      {open && (
        <div className="civ-kebab-menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

// round-16 OQ-PLZ-03 (resolve mark, thread-starter only) rides the EXISTING
// plaza post endpoint as a tag convention (tags:["resolved"|"unresolved"])
// instead of a new Truth event type — the latest such tagged post wins.
// ponytail: OQ-PLZ-01/02/05 (weighted-vote promotion badges + card-issuance
// delegation) need real actor-role Truth data (certified breeder / primary
// observer flags) that does not exist in any schema today — out of scope
// here, not silently faked. See task report.
function resolvedStatus(posts: ThreadPost[]): boolean {
  for (let i = posts.length - 1; i >= 0; i--) {
    const tags = posts[i].tags ?? [];
    if (tags.includes("resolved")) return true;
    if (tags.includes("unresolved")) return false;
  }
  return false;
}

function ThreadPostsNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);
  const threadId = String(scope.params.thread_id ?? "");
  const [view, setView] = useState<ThreadView | null>(null);
  const [viewerId, setViewerId] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [resolving, setResolving] = useState(false);
  // c8磨き第2弾#6(受領10「投稿ごとの投票ボタンに」): per-post Agree/Disagree/
  // Pass — replaces the old screen-def stance-form's manual "対象の投稿 ID"
  // text field entirely (a post's own id was always the thing being voted on;
  // making the visitor type it back was the actual bug). castStance is local
  // session feedback only (no live re-fetch of the sibling consensus table —
  // the pre-c8 stance-form had no such refresh either, so this is parity, not
  // a regression; a full reload already showed the updated tally before and
  // still does).
  const [castStance, setCastStance] = useState<Record<string, "agree" | "disagree" | "pass">>({});
  const [votingId, setVotingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!threadId) {
      setLoaded(true);
      return;
    }
    try {
      const v = (await execute({ kind: "api", method: "GET", path: `/api/v1/plaza/threads/${threadId}` })) as ThreadView;
      setView(v);
    } catch {
      setView(null);
    } finally {
      setLoaded(true);
    }
  }, [execute, threadId]);

  useEffect(() => {
    let alive = true;
    void reload();
    // Promise.resolve(...) defensively wraps execute()'s return the same way
    // useSource does — a bare test double (vi.fn() with no implementation)
    // returns undefined synchronously, not a Promise, and .then() on that
    // throws (V3-AIP-50 snapshot sweep caught this).
    Promise.resolve(execute({ kind: "api", method: "GET", path: "/api/v1/me/profile" }))
      .then((r) => {
        if (alive) setViewerId(String((r as { actor_id?: string } | undefined)?.actor_id ?? ""));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const toggleResolve = useCallback(
    async (root: ThreadPost, next: boolean) => {
      setResolving(true);
      try {
        await execute(
          { kind: "api", method: "POST", path: "/api/v1/plaza/posts" },
          {
            channel: root.channel,
            topic: root.topic,
            board_kind: root.board_kind,
            // thread_id is the THREAD's key, not the root post's own post_id —
            // those coincide only when the thread was seeded without an
            // explicit thread_id (projectThread filters posts by exact
            // thread_id match, so getting this wrong silently files the
            // resolve-tag post into a different/new thread bucket).
            thread_id: threadId,
            reply_to: root.post_id,
            body: next ? "スレッドを解決済みにしました。" : "解決を取り消しました。",
            tags: [next ? "resolved" : "unresolved"],
          },
        );
        await reload();
      } finally {
        setResolving(false);
      }
    },
    [execute, reload],
  );

  const castVote = useCallback(
    async (postId: string, value: "agree" | "disagree" | "pass") => {
      setVotingId(postId);
      try {
        await execute({ kind: "api", method: "POST", path: "/api/v1/plaza/stances" }, { statement_id: postId, value });
        setCastStance((m) => ({ ...m, [postId]: value }));
      } finally {
        setVotingId(null);
      }
    },
    [execute],
  );

  if (!loaded) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }
  if (!view || view.posts.length === 0) {
    return <p className="civ-empty">{String(p.empty_text ?? "まだ投稿がありません。")}</p>;
  }
  const root = view.posts[0];
  const resolved = resolvedStatus(view.posts);
  const isStarter = !!viewerId && viewerId === root.actor_id;
  const tombstoned = new Set((view.tombstones ?? []).map((t) => `${t.ref.type}:${t.ref.id}`));

  return (
    <div className="civ-thread-posts">
      <div className="civ-thread-posts-head">
        <Badge text={resolved ? "✔ 解決済み" : "未解決"} tone={resolved ? "success" : "neutral"} />
        {isStarter && (
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="secondary"
            disabled={resolving}
            aria-busy={resolving || undefined}
            onClick={() => void toggleResolve(root, !resolved)}
          >
            {resolved ? "解決を取り消す" : "✔ 解決済みにする"}
          </button>
        )}
      </div>
      <ul className="civ-list civ-thread-post-list">
        {view.posts.map((post) => (
          <li key={post.post_id}>
            <article className="civ-card civ-thread-post" data-post-id={post.post_id}>
              <div className="civ-thread-post-head">
                <span className="civ-avatar-badge" aria-hidden="true">
                  {monogram(post.actor_id)}
                </span>
                <span className="civ-thread-post-actor">
                  <ActorLabel actorId={post.actor_id} />
                </span>
                <span className="civ-text" data-muted="true">
                  {formatDateJa(post.created_at)}
                </span>
                {post.post_id === root.post_id && <Badge text="スレ主" tone="neutral" />}
              </div>
              {post.reply_to && (
                <p className="civ-text" data-muted="true">
                  &gt;&gt;{post.reply_to}
                </p>
              )}
              <p className="civ-text">{post.body}</p>
              {(post.cite_refs ?? []).length > 0 && (
                <div className="civ-card-badges">
                  {(post.cite_refs ?? []).map((ref, i) => {
                    // BBS-20 tombstone: the cite target no longer resolves
                    // (projectThread's citeTargetExists check) — the ref
                    // itself is kept (append-only) but flagged invalid.
                    const invalid = tombstoned.has(`${ref.type}:${ref.id}`);
                    return (
                      <Badge
                        key={i}
                        text={invalid ? `${ref.type}: ${ref.label ?? ref.id}（無効）` : `${ref.type}: ${ref.label ?? ref.id}`}
                        tone={invalid ? "warning" : "neutral"}
                      />
                    );
                  })}
                </div>
              )}
              <div className="civ-thread-post-stance" role="group" aria-label="この投稿への賛否">
                {(["agree", "disagree", "pass"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={cn("civ-interactive", "civ-button")}
                    data-variant={castStance[post.post_id] === v ? "primary" : "secondary"}
                    data-compact
                    disabled={votingId === post.post_id}
                    aria-busy={votingId === post.post_id || undefined}
                    onClick={() => void castVote(post.post_id, v)}
                  >
                    {v === "agree" ? "賛成" : v === "disagree" ? "反対" : "保留"}
                  </button>
                ))}
              </div>
              <KebabMenu label="この投稿の操作">
                <button
                  type="button"
                  className={cn("civ-interactive", "civ-button")}
                  data-variant="ghost"
                  onClick={() =>
                    navigate("dispute", {
                      category: "board",
                      subject_type: "post",
                      subject_id: post.post_id,
                      respondent_id: post.actor_id,
                    })
                  }
                >
                  この投稿を相談室へ
                </button>
              </KebabMenu>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}

// c8 UI磨き第2弾#1(受領10「買い手/売り手だけ表示」・ui-asset-catalog.md
// 【最優先1】が指摘した「レンダラに scope 条件表示(when)が無い」P0ギャップの
// 解消): ANY node may carry `props.when: { eq: [a, b] }` (or `not_eq`) — both
// sides are `{{...}}` templates resolved against the SAME scope everything
// else interpolates against, so a screen-def compares e.g.
// {{viewer.actor_id}} to {{data.state.matched_with}} to show a button only to
// the matched buyer. No `when` prop = always renders (upper-compatible; every
// existing screen-def is unaffected). Deliberately just eq/not_eq of two
// interpolated strings — not a rules engine; every role check this round-16
// wave needs (buyer/seller/thread_owner) reduces to one id comparison.
function evalWhen(p: Record<string, unknown>, scope: Scope): boolean {
  const w = p.when as { eq?: [string, string]; not_eq?: [string, string] } | undefined;
  if (!w) return true;
  // Both templates resolving empty (the viewer/data fetch hasn't landed yet —
  // {{viewer.actor_id}} and {{data.state.matched_with}} both "" on first
  // render) must NOT count as a match: an eq of two unknowns is unknown, not
  // true. Without this guard every role-gated button would flash visible for
  // one render before the real ids arrive.
  if (w.eq) {
    const a = interpolate(w.eq[0], scope);
    return a !== "" && a === interpolate(w.eq[1], scope);
  }
  if (w.not_eq) {
    const a = interpolate(w.not_eq[0], scope);
    return a !== "" && a !== interpolate(w.not_eq[1], scope);
  }
  return true;
}

// V3-UIX-28 全画面共通ブランドクロム + V3-AUT-12 ログイン/登録/ログアウトの
// 常時ナビ。app-shell は47全screen-defに1個ずつ既にあるため、ここ1箇所に
// 実装すれば全画面へ横展開される(per-screen改修不要)。
//
// ロゴは画像アセットパイプライン(apps/web にはまだ public/ が無い)を新設
// せず、差し替え容易なテキストワードマークで表す(ponytail: 画像ロゴが要る
// ようになったら public/ を新設してこの1箇所を <img> に差し替える)。
//
// 認証状態は既存の公開 GET /api/v1/auth/session(401を返さない)で判定。未
// ログイン中は knowledge-board 等の保護ルートへの死にリンクを見せないよう
// フッター(愚痴/投票/Builder)とヘッダーの深い導線を隠し、ブランド+ログイン/
// 新規登録の最小ヘッダーだけを出す。「新規登録」はこのアプリがマジックリンク
// 一本化方針(専用サインアップ画面なし)のため /s/login と同じ遷移先だが、
// V3-AUT-12 が要求する3リンク(ログイン/登録/ログアウト)を文言として満たす。
function ChromeAuthLinks({
  authenticated,
  loggingOut,
  onLogout,
}: {
  authenticated: boolean;
  loggingOut: boolean;
  onLogout: () => void;
}) {
  if (!authenticated) {
    return (
      <>
        <a className="civ-link civ-chrome-link" href="/s/login">
          ログイン
        </a>
        <a className="civ-link civ-chrome-link" href="/s/login">
          新規登録
        </a>
      </>
    );
  }
  return (
    <button
      type="button"
      className={cn("civ-interactive", "civ-button", "civ-chrome-link")}
      data-variant="ghost"
      aria-busy={loggingOut || undefined}
      onClick={onLogout}
    >
      ログアウト
    </button>
  );
}

function AppShellNode({ node }: { node: ScreenNode }) {
  const execute = useContext(ExecuteCtx);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path: "/api/v1/auth/session" }))
      .then((r) => {
        if (!alive) return;
        const body = r as { authenticated?: unknown } | undefined;
        setAuthenticated(body?.authenticated === true);
      })
      .catch(() => {
        if (alive) setAuthenticated(false);
      })
      .finally(() => {
        if (alive) setAuthLoaded(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await execute({ kind: "api", method: "POST", path: "/api/v1/auth/logout" });
    } catch {
      // ponytail: logout is best-effort — even if the API call fails, sending
      // the visitor to /s/login is the safe outcome (never strand them on a
      // page that still thinks it's logged in).
    } finally {
      if (typeof window !== "undefined") window.location.assign("/s/login");
    }
  }, [execute]);

  return (
    <div className="civ-app-shell">
      <header className="civ-chrome-header">
        <a className="civ-brand" href="/">
          IHL
        </a>
        {authLoaded && authenticated && (
          <nav className="civ-chrome-nav" aria-label="主要ナビゲーション">
            <a className="civ-link civ-chrome-link" href="/s/obs-search">
              観測対象を探す
            </a>
            <a className="civ-link civ-chrome-link" href="/s/profile">
              マイページ
            </a>
            <a className="civ-link civ-chrome-link" href="/">
              通知
            </a>
            <a className="civ-link civ-chrome-link" href="/s/settings">
              設定
            </a>
          </nav>
        )}
        <div className="civ-chrome-auth">
          <ChromeAuthLinks authenticated={authLoaded && authenticated} loggingOut={loggingOut} onLogout={onLogout} />
        </div>
      </header>
      <Children nodes={node.children} />
      {authLoaded && authenticated && (
        <footer className="civ-chrome-footer">
          <a className="civ-link civ-chrome-link" href="/s/knowledge-board">
            愚痴・改善
          </a>
          <a className="civ-link civ-chrome-link" href="/s/template-market">
            投票・Fork
          </a>
          <a className="civ-link civ-chrome-link" href="/s/ui-templates">
            Builder
          </a>
        </footer>
      )}
    </div>
  );
}

export function NodeView({ node }: { node: ScreenNode }) {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const resolve = useContext(MessagesCtx);
  if (!evalWhen(p, scope)) return null;
  switch (node.type) {
    case "app-shell":
      return <AppShellNode node={node} />;
    case "page":
      return (
        <main className="civ-page">
          <Children nodes={node.children} />
        </main>
      );
    case "heading": {
      const level = Number(p.level ?? 1);
      const Tag = (level >= 2 ? "h2" : "h1") as "h1" | "h2";
      return (
        <Tag className="civ-heading" data-level={String(level)}>
          {interpolate(displayText(resolve, p.text_key, p.text, node.id), scope)}
          {p.draft ? <span className="civ-draft-badge">草案</span> : null}
        </Tag>
      );
    }
    case "text": {
      // V3-AIP-101 磨き直し fix#4: hide_if_empty_path points at a scope array
      // (e.g. pedigree.parents) — an empty/absent array swaps the templated
      // text for a muted replacement line (or nothing, if none is given)
      // instead of interpolating "×" out of two missing tokens.
      if (p.hide_if_empty_path) {
        const arr = getPath(scope, String(p.hide_if_empty_path));
        const isEmpty = !Array.isArray(arr) || arr.length === 0;
        if (isEmpty) {
          if (p.empty_replacement_text || p.empty_replacement_text_key) {
            return (
              <p className="civ-text" data-muted="true">
                {displayText(resolve, p.empty_replacement_text_key, p.empty_replacement_text, "")}
              </p>
            );
          }
          return null;
        }
      }
      const content = interpolate(displayText(resolve, p.text_key, p.text, ""), scope);
      // V3-AIP-101 F6 の静的 Δ recap: compare_current is a scope template (the
      // saved value, e.g. "{{params.weight_g}}") rather than live input — the
      // FieldNode twin above compares against what the user is typing instead.
      if (p.compare_source) {
        const curRaw = p.compare_current != null ? interpolate(String(p.compare_current), scope) : "";
        const curNum = curRaw !== "" ? Number(curRaw) : null;
        const cmp = compareLine(scope, {
          source: p.compare_source,
          item: p.compare_item,
          unit: p.compare_unit,
          exclude: p.compare_exclude,
          current: curNum != null && Number.isFinite(curNum) ? curNum : null,
        });
        return (
          <p className="civ-text">
            {content}
            {content && cmp ? "　" : ""}
            {cmp}
          </p>
        );
      }
      if (p.ugc) return <UgcText node={node} text={content} />;
      return (
        <p className="civ-text" data-muted={p.muted === true || undefined}>
          {content}
        </p>
      );
    }
    case "button":
      return <ButtonNode node={node} />;
    case "form":
      return <FormNode node={node} />;
    case "field":
      return <FieldNode node={node} />;
    case "list":
      return <ListNode node={node} />;
    case "card":
      return <CardNode node={node} />;
    case "image": {
      // V3-OBS-24 hero 写真: hide_if_empty_path (text node と同じ規約) は
      // capture.photos が空の観測(写真なし)でも壊れた <img src> を出さない
      // ためのガード。
      if (p.hide_if_empty_path) {
        const arr = getPath(scope, String(p.hide_if_empty_path));
        if (!Array.isArray(arr) || arr.length === 0) {
          return p.empty_text ? <p className="civ-empty">{String(p.empty_text)}</p> : null;
        }
      }
      // eslint-disable-next-line @next/next/no-img-element
      return (
        <img
          className="civ-image"
          src={interpolate(String(p.src ?? ""), scope)}
          alt={String(p.alt ?? "")}
        />
      );
    }
    case "qr-code":
      return <QrNode node={node} />;
    case "measurement-table":
      return <MeasurementTableNode node={node} />;
    case "table":
      return <TableNode node={node} />;
    case "badge":
      return <BadgeNode node={node} />;
    case "progress":
      return <ProgressNode node={node} />;
    case "tabs":
      return <TabsNode node={node} />;
    case "image-grid":
      return <ImageGridNode node={node} />;
    case "stepper":
      return <StepperNode node={node} />;
    case "kpi-tile":
      return <KpiTileNode node={node} />;
    case "visit-tracker":
      return <VisitTrackerNode node={node} />;
    case "recent-chips":
      return <RecentChipsNode node={node} />;
    case "disclosure":
      return <DisclosureNode node={node} />;
    case "clutch-intake":
      return <ClutchIntakeNode />;
    case "batch-roster":
      return <BatchRosterNode />;
    case "batch-summary":
      return <BatchSummaryNode />;
    case "batch-done":
      return <BatchDoneNode />;
    case "search-navigator":
      return <SearchNavigatorNode />;
    case "growth-chart":
      return <GrowthChartNode node={node} />;
    case "individual-profile":
      return <IndividualProfileNode />;
    case "thread-posts":
      return <ThreadPostsNode node={node} />;
    case "target-navigator":
      return <TargetNavigatorNode />;
    case "link": {
      const href = interpolate(String(p.href ?? p.to ?? "#"), scope);
      return (
        <a className="civ-link" href={href}>
          {displayText(resolve, p.label_key, p.label ?? p.text, href)}
        </a>
      );
    }
    default:
      return null;
  }
}

// V3-BBS-03: 「全ファイル・全コンポーネント・全画面テンプレート」に説明/愚痴/改善の
// 3板を必須付与する要求文の「全画面」側を、50 本の screen-def JSON を個別編集する
// 代わりに Renderer 本体へ 1 回だけ差し込むことで機械的に満たす(per-file 手編集は
// 増える screen-def ごとに漏れる・ここが唯一の差し込み点なら漏れようがない)。
// channel = `screen-${screen_id}` に固定し、plaza-routes.ts の既存 3 板グルーピング
// (projectChannelThreads・plaza-constants.ts BOARD_KINDS)をそのまま再利用する
// (新 Truth 型なし・新 route なし)。コンポーネント編集/入れ替え/Fork一覧ポップアップ/
// IDE 導線は要求文の別の柱で、identity/Fork lineage UI の設計待ち(progress.json note
// に継続明記・捏造しない)。
const FILE_BOARD_KINDS = [
  { kind: "guide", label: "説明" },
  { kind: "complaint", label: "愚痴" },
  { kind: "improvement", label: "改善" },
] as const;
type FileBoardKind = (typeof FILE_BOARD_KINDS)[number]["kind"];

interface FileBoardThread { thread_id: string; topic: string; board_kind: string; post_count: number }
interface FileBoardsView { channel: string; threads: FileBoardThread[]; boards: Record<string, FileBoardThread[]> }

function ScreenBoardsFooter({ screenId }: { screenId: string }) {
  const execute = useContext(ExecuteCtx);
  const channel = `screen-${screenId}`;
  // ponytail: collapsed by default (same trigger convention as the `disclosure`
  // node — V3-AIP-101 fix#5/#6) instead of auto-fetching on every screen mount.
  // Firing a GET unconditionally on mount made this footer an invisible side
  // effect that inflated onAction call-count assertions across ~100 unrelated
  // renderer tests (form-submit-count checks, mock.calls[0] ordering) that
  // were written before this footer existed. Gating the fetch behind an
  // explicit tap keeps every existing screen's zero-interaction render at
  // zero extra API calls, which is also the honest UX default (nobody wants
  // a board panel auto-loading under every screen they open).
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<FileBoardsView | null>(null);
  const [kind, setKind] = useState<FileBoardKind>("complaint");
  const [topic, setTopic] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);

  const reload = useCallback(async () => {
    try {
      const v = await execute({ kind: "api", method: "GET", path: `/api/v1/plaza/channels/${channel}/threads` });
      setView((v ?? null) as FileBoardsView | null);
    } catch {
      setView(null);
    }
  }, [execute, channel]);

  useEffect(() => {
    if (!open) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, open]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!topic.trim() || !body.trim() || pending) return;
      setPending(true);
      try {
        await execute(
          { kind: "api", method: "POST", path: "/api/v1/plaza/posts" },
          { channel, board_kind: kind, topic: topic.trim(), body: body.trim() },
        );
        setTopic("");
        setBody("");
        await reload();
      } finally {
        setPending(false);
      }
    },
    [execute, channel, kind, topic, body, pending, reload],
  );

  if (!open) {
    return (
      <button
        type="button"
        className={cn("civ-interactive", "civ-button")}
        data-variant="secondary"
        onClick={() => setOpen(true)}
      >
        このページの掲示板を開く(説明・愚痴・改善)
      </button>
    );
  }

  const boards = view?.boards ?? {};
  return (
    <section className="civ-card" aria-label="このページの掲示板(説明/愚痴/改善)">
      <h2 className="civ-heading" data-level="2">
        このページの掲示板
      </h2>
      {FILE_BOARD_KINDS.map(({ kind: k, label }) => {
        const threads = boards[k] ?? [];
        return (
          <div key={k}>
            <span className="civ-badge">
              {label}（{threads.length}）
            </span>
            {threads.length === 0 ? (
              <p className="civ-empty">まだ投稿がありません。</p>
            ) : (
              <ul className="civ-list">
                {threads.map((t) => (
                  <li key={t.thread_id}>
                    <a className="civ-link" href={`/s/knowledge-thread?thread_id=${t.thread_id}`}>
                      {t.topic}（{t.post_count}）
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <form className="civ-form" onSubmit={(e) => void submit(e)}>
        <div className="civ-field">
          <label htmlFor={`${screenId}-board-kind`}>板</label>
          <select
            id={`${screenId}-board-kind`}
            value={kind}
            onChange={(e) => setKind(e.target.value as FileBoardKind)}
          >
            {FILE_BOARD_KINDS.map(({ kind: k, label }) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="civ-field">
          <label htmlFor={`${screenId}-board-topic`}>話題</label>
          <input id={`${screenId}-board-topic`} value={topic} onChange={(e) => setTopic(e.target.value)} />
        </div>
        <div className="civ-field">
          <label htmlFor={`${screenId}-board-body`}>本文</label>
          <textarea id={`${screenId}-board-body`} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <button type="submit" className={cn("civ-interactive", "civ-button")} data-variant="primary" disabled={pending}>
          投稿する
        </button>
      </form>
    </section>
  );
}

export interface RendererProps {
  def: ScreenDef;
  onAction?: Execute;
  onNavigate?: (to: string, query?: Record<string, string>) => void;
  /** URL query scope (?id=…). Defaults to window.location.search in the browser. */
  params?: Record<string, string>;
  /**
   * I18-08 text_key resolver (lib/i18n supplies the catalog + fallback chain).
   * Explicit resolveMessage wins; otherwise it is derived from `catalogs` +
   * `viewerLocale` below (a plain function can't cross the server/client
   * boundary, but the serializable catalog data can — I18-01/I18-03).
   */
  resolveMessage?: ResolveMessage;
  /** I18-08: catalogs loaded server-side (lib/i18n loadCatalogs()); combined
   *  with viewerLocale to build the resolver when resolveMessage is omitted. */
  catalogs?: Catalogs;
  /** I18-06/I18-03 viewer locale — drives both the UGC translate affordance
   *  and (via `catalogs`) the resolved UI text; follows the account's saved
   *  preference so the whole product switches with it (I18-01/I18-03). */
  viewerLocale?: string;
}

export function Renderer({
  def,
  onAction,
  onNavigate,
  params,
  resolveMessage,
  catalogs,
  viewerLocale,
}: RendererProps) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<Record<string, unknown>>({});
  const [viewer, setViewer] = useState<Record<string, unknown>>({});
  const execute = onAction ?? defaultExecute(onNavigate);
  const resolvedMessage = useMemo(
    () => resolveMessage ?? (catalogs ? makeResolver(catalogs, viewerLocale ?? "ja") : () => undefined),
    [resolveMessage, catalogs, viewerLocale],
  );

  // c8#1: fetch the viewer once per screen mount so any node's `when` can
  // compare {{viewer.actor_id}} against fetched data (buyer/seller/thread_owner
  // role gating) without every node re-implementing its own /me/profile call
  // (ThreadPostsNode did exactly that before this existed — same idea, lifted
  // one level so declarative screen-defs can use it too). Only fires when THIS
  // screen-def actually has a `when` prop somewhere — the other ~46 screens
  // (and every existing action-count assertion in renderer.test.tsx) see zero
  // behaviour change, and no screen pays for a fetch it never reads.
  const needsViewer = useMemo(() => anyField(def.nodes, (n) => n.props?.when != null), [def]);
  useEffect(() => {
    if (!needsViewer) return;
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path: "/api/v1/me/profile" }))
      .then((r) => {
        if (alive && r && typeof r === "object") setViewer(r as Record<string, unknown>);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsViewer]);

  const navigate = useCallback(
    (to: string, query?: Record<string, string>) => {
      if (onNavigate) onNavigate(to, query);
      else if (typeof window !== "undefined") window.location.assign(screenHref(to, query));
    },
    [onNavigate],
  );
  const setNodeData = useCallback(
    (id: string, value: unknown) => setData((d) => ({ ...d, [id]: value })),
    [],
  );
  const setActionResult = useCallback(
    (value: unknown) =>
      setResult((r) => ({ ...r, ...(value && typeof value === "object" ? (value as object) : {}) })),
    [],
  );

  const scope: Scope = { params: params ?? readQuery(), data, result, viewer };

  return (
    <MessagesCtx.Provider value={resolvedMessage}>
      <LocaleCtx.Provider value={viewerLocale ?? "ja"}>
        <ExecuteCtx.Provider value={execute}>
          <ScopeCtx.Provider value={scope}>
            <TransitionsCtx.Provider value={def.transitions ?? []}>
              <NavigateCtx.Provider value={navigate}>
                <DataSinkCtx.Provider value={{ setNodeData, setActionResult }}>
                  {def.nodes.map((n) => (
                    <NodeView key={n.id} node={n} />
                  ))}
                  <ScreenBoardsFooter screenId={def.screen_id} />
                </DataSinkCtx.Provider>
              </NavigateCtx.Provider>
            </TransitionsCtx.Provider>
          </ScopeCtx.Provider>
        </ExecuteCtx.Provider>
      </LocaleCtx.Provider>
    </MessagesCtx.Provider>
  );
}
