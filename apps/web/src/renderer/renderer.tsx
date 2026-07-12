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
};

type DataSink = {
  setNodeData: (id: string, value: unknown) => void;
  setActionResult: (value: unknown) => void;
};

const ExecuteCtx = createContext<Execute>(async () => undefined);
const InvalidCtx = createContext<Set<string>>(new Set());
const ScopeCtx = createContext<Scope>({ params: {}, data: {}, result: {} });
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
    if (!res.ok) throw new ApiError(res.status);
    const ct = res.headers.get("content-type") ?? "";
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
      // Two-stage photo upload (design-c2 §3.2): the capture is created first,
      // then — if the form carried a photo — the file is POSTed as multipart
      // against the returned capture_id, BEFORE the transition unmounts us.
      const captureId = (result as Record<string, unknown> | undefined)?.capture_id;
      if (effFile && typeof captureId === "string") {
        await execute(
          { kind: "api", method: "POST", path: "/api/v1/observation/upload" },
          { capture_id: captureId, file: effFile },
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
      <select {...shared} defaultValue="">
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
  } else {
    control = (
      <input
        {...shared}
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
          if (v.trim() !== "") setPath(body, k, v);
        } else if (v instanceof File && v.size > 0 && !file) {
          file = v;
        }
      });
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
    return (
      <ul className="civ-list">
        {items.map((it, i) => (
          <li key={i}>
            <article className="civ-card">
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
type Tone = "success" | "warning" | "caution" | "neutral";
const TONES: readonly Tone[] = ["success", "warning", "caution", "neutral"];
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
    return <Badge text={String(value ?? "")} tone={tone} />;
  }
  if (cell === "progress") {
    const n = Number(value ?? 0);
    return <ProgressBar value={Number.isFinite(n) ? n : 0} max={Number(col.max ?? 100)} />;
  }
  if (cell === "date") {
    return formatDateJa(value) || "—";
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
              <td key={ci}>{renderCell(c, row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Tabs / section switcher (§2-5). props.tabs[] drives the tab strip; each
// child node opts into a tab via props.tab_id — only the active tab's
// children render (unassigned children never show, keeping the contract
// explicit rather than "everything without tab_id always shows").
function TabsNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const tabs = (p.tabs as Array<Record<string, unknown>>) ?? [];
  const [active, setActive] = useState<string>(
    p.default_tab != null ? String(p.default_tab) : String(tabs[0]?.id ?? ""),
  );
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
              onClick={() => setActive(id)}
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

// Image grid / thumbnail cards (§2-6) — the bind_items twin of ListNode's
// image branch, laid out as a grid instead of a stacked list, each cell
// carrying a meta line + optional Badge.
function ImageGridNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const items = useBoundItems(node);
  if (items.length === 0 && p.empty_text) {
    return <p className="civ-empty">{String(p.empty_text)}</p>;
  }
  const imgTpl = p.item_image ? String(p.item_image) : "";
  const altTpl = p.item_alt ? String(p.item_alt) : "";
  const labelTpl = p.item_label ? String(p.item_label) : "";
  const metaTpl = p.item_meta ? String(p.item_meta) : "";
  const badgeTpl = p.item_badge ? String(p.item_badge) : "";
  const badgeToneTpl = p.item_badge_tone ? String(p.item_badge_tone) : "";
  return (
    <div className="civ-image-grid">
      {items.map((it, i) => (
        <figure className="civ-thumb-card" key={i}>
          {imgTpl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="civ-image" src={interpolate(imgTpl, it)} alt={interpolate(altTpl, it)} />
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
          </figcaption>
        </figure>
      ))}
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
  const steps = (p.steps as Array<Record<string, unknown>>) ?? [];
  const cur = p.current;
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
function KpiTileNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  useSource(node);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const value = interpolate(String(p.value ?? ""), scope);
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
function MeasurementTableNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const baseItems = toOptions(p.item_options);
  const baseUnits = toOptions(p.unit_options);
  const methodOpts = toOptions(p.method_options);
  const templates = (p.rows as Array<Record<string, unknown>>) ?? [];
  const [extra, setExtra] = useState(0);
  // V3-OBS-18 自由項目: user-defined item/unit choices extend every row's select.
  const [extraItems, setExtraItems] = useState<Opt[]>([]);
  const [extraUnits, setExtraUnits] = useState<Opt[]>([]);
  const [adding, setAdding] = useState<null | "item" | "unit">(null);
  const [pendingName, setPendingName] = useState("");
  const itemOpts = [...baseItems, ...extraItems];
  const unitOpts = [...baseUnits, ...extraUnits];
  const rowCount = templates.length + extra;
  const th = (k: unknown, l: unknown, fb: string) => displayText(resolve, k, l, fb);
  const itemLabel = th(p.item_label_key, p.item_label, "項目");
  const valueLabel = th(p.value_label_key, p.value_label, "数値");
  const unitLabel = th(p.unit_label_key, p.unit_label, "単位");
  const methodLabel = th(p.method_label_key, p.method_label, "計測方法");
  const canAddItem = p.add_item_label != null;
  const canAddUnit = p.add_unit_label != null;

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
        return (
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
      })}
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
        <table className="civ-table">
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
                  <td className="civ-cell-clip" title={ind.label}>
                    {ind.label}
                  </td>
                  <td>
                    <input
                      className="civ-input"
                      type="number"
                      inputMode="decimal"
                      value={g.weight}
                      onChange={(e) => setGridValue(id, "weight", e.target.value)}
                      aria-label={`${ind.label} 体重g`}
                    />
                  </td>
                  <td>
                    <input
                      className="civ-input"
                      type="number"
                      inputMode="decimal"
                      value={g.length}
                      onChange={(e) => setGridValue(id, "length", e.target.value)}
                      aria-label={`${ind.label} 体長mm`}
                    />
                  </td>
                  <td>{delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}g` : "—"}</td>
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
              <article className="civ-card">
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
                  onClick={() => navigate("obs-register-entry", { id: row.individual_id })}
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

export function NodeView({ node }: { node: ScreenNode }) {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const resolve = useContext(MessagesCtx);
  switch (node.type) {
    case "app-shell":
      return (
        <div className="civ-app-shell">
          <Children nodes={node.children} />
        </div>
      );
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
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return (
        <img
          className="civ-image"
          src={interpolate(String(p.src ?? ""), scope)}
          alt={String(p.alt ?? "")}
        />
      );
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

export interface RendererProps {
  def: ScreenDef;
  onAction?: Execute;
  onNavigate?: (to: string, query?: Record<string, string>) => void;
  /** URL query scope (?id=…). Defaults to window.location.search in the browser. */
  params?: Record<string, string>;
  /** I18-08 text_key resolver (lib/i18n supplies the catalog + fallback chain). */
  resolveMessage?: ResolveMessage;
  /** I18-06 viewer locale for the on-device UGC translate affordance. */
  viewerLocale?: string;
}

export function Renderer({
  def,
  onAction,
  onNavigate,
  params,
  resolveMessage,
  viewerLocale,
}: RendererProps) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<Record<string, unknown>>({});
  const execute = onAction ?? defaultExecute(onNavigate);

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

  const scope: Scope = { params: params ?? readQuery(), data, result };

  return (
    <MessagesCtx.Provider value={resolveMessage ?? (() => undefined)}>
      <LocaleCtx.Provider value={viewerLocale ?? "ja"}>
        <ExecuteCtx.Provider value={execute}>
          <ScopeCtx.Provider value={scope}>
            <TransitionsCtx.Provider value={def.transitions ?? []}>
              <NavigateCtx.Provider value={navigate}>
                <DataSinkCtx.Provider value={{ setNodeData, setActionResult }}>
                  {def.nodes.map((n) => (
                    <NodeView key={n.id} node={n} />
                  ))}
                </DataSinkCtx.Provider>
              </NavigateCtx.Provider>
            </TransitionsCtx.Provider>
          </ScopeCtx.Provider>
        </ExecuteCtx.Provider>
      </LocaleCtx.Provider>
    </MessagesCtx.Provider>
  );
}
