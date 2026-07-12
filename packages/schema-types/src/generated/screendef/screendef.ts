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
   * コンポーネントカタログ v0（§4.2 の 12 種 + measurement-table + A層7種 + 観測登録スライス1の2種 + 磨き直し1種 + スライス2の4種 + 検索スライスAの1種）。field は props.variant で text|number|select|photo|checkbox|segmented|hidden を表現。measurement-table は行追加できる計測入力表（項目/数値/単位/計測方法 × N 行 → measurements[] へ整形・V3-OBS-18）。table/badge/progress/tabs/image-grid/stepper/kpi-tile は共有レンダラ語彙 A層（c7 ui-parity-map §2）。card は既存ノードを icon/title/meta/badges/action ナビで上位互換拡張（新種なし）。visit-tracker/recent-chips は V3-AIP-101 観測登録スライス1: 個体閲覧履歴を localStorage に記録/直近3件をチップ表示する client-only 部品（新 Truth 型なし）。disclosure は V3-AIP-101 磨き直し: 既定折りたたみのトリガー（badge/buttonスタイル）+タップで開く children（F2ステージ変更・死亡記録）。clutch-intake/batch-roster/batch-summary/batch-done は V3-AIP-101 観測登録スライス2（c7-wireframes-core5 §F3/F4/F5/F6）: クラッチ割り出し1画面完結フォーム、お世話/移動/クラッチ照合・昇格の一括選択グリッド、バッチ確認サマリ、バッチ保存後の完了表示。複数 API 呼び出し+行単位のローカル状態を1画面内に持つため、既存の宣言的 form/list/table 語彙では表現しきれず専用ノードにした（measurement-table と同じ縮退）。search-navigator は V3-AIP-101 検索スライスA（obs-search）: GET /individuals + GET /placements の取得、localStorage 保存検索チップ、ファセット絞り込み+0件時の緩和バー、ソート、下部固定バスケットを1画面に持つ。同じく複数 API 呼び出し+行単位ローカル状態が多く宣言的語彙では表現しきれないため専用ノードにした。
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
    | "link"
    | "measurement-table"
    | "table"
    | "badge"
    | "progress"
    | "tabs"
    | "image-grid"
    | "stepper"
    | "kpi-tile"
    | "visit-tracker"
    | "recent-chips"
    | "disclosure"
    | "clutch-intake"
    | "batch-roster"
    | "batch-summary"
    | "batch-done"
    | "search-navigator";
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
