"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/cn";
import { apiUrl } from "@/lib/api";
import type { Action, ScreenDef, ScreenNode } from "./types";

/* -------------------------------------------------------------------------- *
 * Action execution + form-invalid propagation via context.
 * Individual catalog parts read these; screens never wire a11y/state by hand.
 * -------------------------------------------------------------------------- */

export type Execute = (
  action: Action,
  body?: Record<string, unknown>,
) => void | Promise<void>;

const ExecuteCtx = createContext<Execute>(async () => {});
const InvalidCtx = createContext<Set<string>>(new Set());

function defaultExecute(onNavigate?: (to: string) => void): Execute {
  return async (action, body) => {
    if (action.kind === "navigate") {
      if (onNavigate) onNavigate(action.to);
      // action.to is a screen_id, not a URL. Map it to the real route:
      // `home` is served at "/", every other screen-def at "/s/<id>".
      else if (typeof window !== "undefined")
        window.location.assign(action.to === "home" ? "/" : `/s/${action.to}`);
      return;
    }
    const res = await fetch(apiUrl(action.path), {
      method: action.method,
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: action.method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error(`api ${res.status}`);
  };
}

/* -------------------------------------------------------------------------- *
 * Catalog v0 — 12 types (design-c2 §4.2). Semantic classes only; all color and
 * every one of the 7 states live in globals.css (.civ-interactive layer).
 * -------------------------------------------------------------------------- */

function props(node: ScreenNode): Record<string, unknown> {
  return node.props ?? {};
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
  const execute = useContext(ExecuteCtx);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    p.error ? String(p.error) : null,
  );
  const loading = pending || p.loading === true;
  const disabled = p.disabled === true || loading;

  const onClick = useCallback(async () => {
    if (!node.action || disabled) return;
    setError(null);
    setPending(true);
    try {
      await execute(node.action);
    } catch (e) {
      setError((e as Error)?.message ?? String(e));
    } finally {
      setPending(false);
    }
  }, [node.action, disabled, execute]);

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
        {String(p.label ?? node.id)}
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
        {String(p.label ?? name)}
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
  const execute = useContext(ExecuteCtx);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(
    p.error ? String(p.error) : null,
  );
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());

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
      const body: Record<string, unknown> = {};
      fd.forEach((v, k) => {
        body[k] = v;
      });
      setPending(true);
      try {
        await execute(node.action, body);
      } catch (err) {
        setFormError((err as Error)?.message ?? String(err));
      } finally {
        setPending(false);
      }
    },
    [node.action, execute],
  );

  return (
    <form
      className="civ-form"
      aria-busy={pending || undefined}
      data-loading={pending || undefined}
      onSubmit={onSubmit}
      noValidate
    >
      <InvalidCtx.Provider value={invalidFields}>
        <Children nodes={node.children} />
      </InvalidCtx.Provider>
      {formError && (
        <p role="alert" className="civ-form-error">
          {formError}
        </p>
      )}
    </form>
  );
}

function QrNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const value = String(p.value ?? p.token ?? "");
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

export function NodeView({ node }: { node: ScreenNode }) {
  const p = props(node);
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
          {String(p.text ?? node.id)}
        </Tag>
      );
    }
    case "text":
      return (
        <p className="civ-text" data-muted={p.muted === true || undefined}>
          {String(p.text ?? "")}
        </p>
      );
    case "button":
      return <ButtonNode node={node} />;
    case "form":
      return <FormNode node={node} />;
    case "field":
      return <FieldNode node={node} />;
    case "list":
      return (
        <ul className="civ-list">
          {(node.children ?? []).map((c) => (
            <li key={c.id}>
              <NodeView node={c} />
            </li>
          ))}
        </ul>
      );
    case "card":
      return (
        <article className="civ-card">
          <Children nodes={node.children} />
        </article>
      );
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return (
        <img
          className="civ-image"
          src={String(p.src ?? "")}
          alt={String(p.alt ?? "")}
        />
      );
    case "qr-code":
      return <QrNode node={node} />;
    case "link": {
      const href = String(p.href ?? p.to ?? "#");
      return (
        <a className="civ-link" href={href}>
          {String(p.label ?? p.text ?? href)}
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
  onNavigate?: (to: string) => void;
}

export function Renderer({ def, onAction, onNavigate }: RendererProps) {
  const execute = onAction ?? defaultExecute(onNavigate);
  return (
    <ExecuteCtx.Provider value={execute}>
      {def.nodes.map((n) => (
        <NodeView key={n.id} node={n} />
      ))}
    </ExecuteCtx.Provider>
  );
}
