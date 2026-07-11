// ScreenDef Renderer types — mirror of schemas/screendef/screendef.schema.json.
// ponytail: defined locally (not imported from @ihl/schema-types) so Next needs
// no transpilePackages for a workspace TS source. Schema stays the SSOT; the
// screen-defs are validated against it by scripts/check-ui-tokens.mjs at lint.

export type NodeType =
  | "app-shell"
  | "page"
  | "heading"
  | "text"
  | "button"
  | "form"
  | "field"
  | "list"
  | "card"
  | "image"
  | "qr-code"
  | "link";

// field node props.variant (V3-AUT-06 adds "checkbox"). Documents the supported
// controls; the Renderer reads props.variant untyped, schema is the SSOT.
export type FieldVariant = "text" | "number" | "select" | "photo" | "checkbox";

export type Action =
  | {
      kind: "api";
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      path: string;
      body_from?: string;
    }
  | { kind: "navigate"; to: string };

export interface ScreenNode {
  id: string;
  type: NodeType;
  props?: Record<string, unknown>;
  children?: ScreenNode[];
  action?: Action;
}

export interface Transition {
  from: string;
  to_screen_id: string;
  label?: string;
}

export interface ScreenDef {
  screen_id: string;
  route: string;
  title: string;
  layout?: string;
  nodes: ScreenNode[];
  transitions?: Transition[];
  notes?: string;
}
