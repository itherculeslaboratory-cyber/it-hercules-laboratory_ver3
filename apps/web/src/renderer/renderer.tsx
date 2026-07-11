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
  if (variant === "select") {
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
        type={variant === "number" ? "number" : "text"}
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
function CardNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  useSource(node);
  const scope = useContext(ScopeCtx);
  const children = node.children ?? [];
  const bindText = p.bind_text ? String(p.bind_text) : "";
  if (children.length === 0 && !bindText && p.empty_text) {
    return <p className="civ-empty">{String(p.empty_text)}</p>;
  }
  // props.bind_text renders the card's OWN fetched object (data[node.id]), so
  // bare fields ({{karma_value}}, {{listing.title}}) resolve against the
  // source_path response — the single-object twin of a list's bind_items.
  return (
    <article className="civ-card">
      {p.draft ? <span className="civ-draft-badge">草案</span> : null}
      {bindText ? (
        <p className="civ-text">
          {interpolate(bindText, getPath(scope, `data.${node.id}`) ?? {})}
        </p>
      ) : null}
      <Children nodes={node.children} />
    </article>
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
