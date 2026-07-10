// GENERATED FILE — do not edit by hand.
// source: schemas/screendef/screendef.schema.json
// title: ScreenDef (ver3 Renderer 実行可能画面定義)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

export type Action =
  | {
      kind: "api";
      /**
       * HTTP メソッド。
       */
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      /**
       * API パス（NEXT_PUBLIC_API_URL 相対）。
       */
      path: string;
      /**
       * リクエストボディを組み立てる元（フォーム node id 等・任意）。
       */
      body_from?: string;
    }
  | {
      kind: "navigate";
      /**
       * 遷移先（screen_id または route）。
       */
      to: string;
    };

/**
 * ScreenDef Renderer の入力正本（V3-UIX-16/17/18/81）。トップ形状は ver2 63 JSON を継承（screen_id/route/title/layout/nodes/transitions）。node を Renderer 実行可能に拡張（type=カタログ enum §4.2・action=api|navigate）。色/className の直書きは props の semantic 値のみで表現し raw hex/任意色クラスは機械 GATE（check-ui-tokens.mjs）が拒否する。
 */
export interface Screendef {
  /**
   * 画面の一意キー。route と 1:1。
   */
  screen_id: string;
  /**
   * 画面の URL パス（route matrix と対応）。
   */
  route: string;
  /**
   * 画面タイトル（日本語可）。
   */
  title: string;
  /**
   * レイアウト種別（例: 'standard'）。任意。
   */
  layout?: string;
  /**
   * 画面を構成するノード木のルート配列。
   */
  nodes: Node[];
  /**
   * 画面遷移（ver2 継承形状）。
   */
  transitions?: Transition[];
  /**
   * 設計メモ（任意・ユーザー向け UI には出さない）。
   */
  notes?: string;
}
export interface Node {
  /**
   * ノードの一意キー（screen 内）。
   */
  id: string;
  /**
   * コンポーネントカタログ v0（§4.2 の 12 種）。field は props.variant で text|number|select|photo を表現。
   */
  type:
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
  /**
   * semantic props のみ（variant 等）。raw hex/任意色クラスは禁止（check-ui-tokens.mjs が拒否）。
   */
  props?: {
    [k: string]: unknown;
  };
  /**
   * 子ノード（再帰）。
   */
  children?: Node[];
  action?: Action;
}
export interface Transition {
  /**
   * 遷移の起点（node id / hotspot 等）。
   */
  from: string;
  /**
   * 遷移先 screen_id。
   */
  to_screen_id: string;
  /**
   * 遷移の説明ラベル（任意）。
   */
  label?: string;
}
