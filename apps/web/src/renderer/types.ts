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

// Documented props the Renderer understands (props stays an open Record so the
// schema — additionalProperties:true — remains the SSOT). C5/K4 adds:
//  - text_key/label_key: i18n catalog keys resolved via MessagesCtx (I18-08);
//    the literal text/label is the fallback when a key does not resolve.
//  - empty_text: honest empty-state copy for list/card (V3-UIX-03).
//  - draft: render a "草案" badge on the heading/card (V3-UIX-45).
//  - ugc + lang: mark viewer-generated text; enables the on-device translate
//    affordance when the viewer locale differs from `lang` (V3-I18-06).
//  - next_step: trailing "次にやること" navigation hint (V3-UIX-05).
export interface KnownNodeProps {
  text?: string;
  text_key?: string;
  label?: string;
  label_key?: string;
  empty_text?: string;
  draft?: boolean;
  ugc?: boolean;
  lang?: string;
  next_step?: string;
  [key: string]: unknown;
}

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
