"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/cn";
import { apiUrl } from "@/lib/api";
import { ApiError, mapError } from "@/lib/error-messages";
import { shouldOfferTranslation, translateOnDemand } from "@/lib/ugc-translate";
import { clearDraft, loadDraft, saveDraft } from "./draft";
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
          effBody = d.body;
          effFile = d.file;
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
      if (t) navigate(t.to_screen_id, queryFromResult(result));
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(p.error ? String(p.error) : null);
  const formValid = useContext(FormValidityCtx);
  const loading = pending || p.loading === true;
  const isSubmit = (p.type ?? "button") === "submit";
  // V3-AUT-06: a submit inside a gated (consent) form is disabled from first
  // paint until the form is valid — before any input event fires.
  const disabled = p.disabled === true || loading || (isSubmit && !formValid);

  const onClick = useCallback(async () => {
    if (!node.action || disabled) return;
    setError(null);
    setPending(true);
    try {
      await run(node.action);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }, [node.action, disabled, run]);

  return (
    <>
      <button
        type={(p.type as "button" | "submit") ?? "button"}
        className={cn("civ-interactive", "civ-button")}
        data-variant={String(p.variant ?? "primary")}
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
  const variant = String(p.variant ?? "text");
  const name = String(p.name ?? node.id);
  const required = p.required === true;
  const invalid = p.invalid === true || invalidCtx.has(name);
  const id = `field-${node.id}`;

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
    control = <input {...shared} type="file" accept="image/*" />;
  } else if (variant === "checkbox") {
    // data-required='true' means "must be checked"; scanFormValidity + the
    // submit-time missing scan (unchecked => fd.get null) both cover it.
    control = <input {...shared} type="checkbox" />;
  } else {
    control = (
      <input
        {...shared}
        type={variant === "number" ? "number" : variant === "date" ? "date" : "text"}
        placeholder={p.placeholder ? String(p.placeholder) : undefined}
      />
    );
  }

  return (
    <div className="civ-field">
      <label className="civ-label" htmlFor={id}>
        {displayText(resolve, p.label_key, p.label, name)}
        {required ? " *" : ""}
      </label>
      {control}
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
      if (stat) for (const [k, v] of Object.entries(stat)) setPath(body, k, v);
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
    [node.action, run, p.static],
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
      {badges.length > 0 && (
        <div className="civ-card-badges">
          {badges.map((b, i) => (
            <Badge
              key={i}
              text={displayText(resolve, b.text_key ?? b.label_key, b.text ?? b.label, "")}
              tone={b.tone != null ? String(b.tone) : undefined}
            />
          ))}
        </div>
      )}
      {bindText ? (
        <p className="civ-text">
          {interpolate(bindText, getPath(scope, `data.${node.id}`) ?? {})}
        </p>
      ) : null}
      <Children nodes={node.children} />
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
      const content = interpolate(displayText(resolve, p.text_key, p.text, ""), scope);
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
