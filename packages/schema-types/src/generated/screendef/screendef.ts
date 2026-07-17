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
   * コンポーネントカタログ v0（§4.2 の 12 種 + measurement-table + A層7種 + 観測登録スライス1の2種 + 磨き直し1種 + スライス2の4種 + 検索スライスAの1種 + 個体詳細スライスAの2種 + 観測対象ナビゲータの1種 + 個体ファインダーの1種）。individual-finder は design-individual-finder.md §2.3/§4(T-63 波1): 一覧・絞り込み面のMVP。GET /individuals を1回取得し、決定論sort(体長/体重/観測回数/最終観測/次の予定)+q/種/ステージ/状態のAND絞り込み+実データ分位点プリセット(体長・体重の上位10%)をクライアント側で組み立てる(search-navigatorと同じ縮退)。行選択で個体詳細パネル(実測形質+写真枠)を出し、選択個体ごとに GET /individuals/{id}/pedigree(先祖・多世代)+ /individuals/{id}/profile(子・1世代)を取得して血統ツリーを描く(先祖=info・子孫=successのテーマトークン色)。target-navigator は V3-OBS-02: 学名検索/アキネーター式yes-no二分探索/分類ツリーの3経路を1ノードに持つ観測対象ナビゲータ(POST /observation/targets/search の3 mode を叩く・確定は1ボタンのみ・候補提示と確定を分離)。field は props.variant で text|number|select|photo|checkbox|segmented|hidden を表現。measurement-table は行追加できる計測入力表（項目/数値/単位/計測方法 × N 行 → measurements[] へ整形・V3-OBS-18）。table/badge/progress/tabs/image-grid/stepper/kpi-tile は共有レンダラ語彙 A層（c7 ui-parity-map §2）。card は既存ノードを icon/title/meta/badges/action ナビで上位互換拡張（新種なし）。visit-tracker/recent-chips は V3-AIP-101 観測登録スライス1: 個体閲覧履歴を localStorage に記録/直近3件をチップ表示する client-only 部品（新 Truth 型なし）。disclosure は V3-AIP-101 磨き直し: 既定折りたたみのトリガー（badge/buttonスタイル）+タップで開く children（F2ステージ変更・死亡記録）。clutch-intake/batch-roster/batch-summary/batch-done は V3-AIP-101 観測登録スライス2（c7-wireframes-core5 §F3/F4/F5/F6）: クラッチ割り出し1画面完結フォーム、お世話/移動/クラッチ照合・昇格の一括選択グリッド、バッチ確認サマリ、バッチ保存後の完了表示。複数 API 呼び出し+行単位のローカル状態を1画面内に持つため、既存の宣言的 form/list/table 語彙では表現しきれず専用ノードにした（measurement-table と同じ縮退）。search-navigator は V3-AIP-101 検索スライスA（obs-search）: GET /individuals + GET /placements の取得、localStorage 保存検索チップ、ファセット絞り込み+0件時の緩和バー、ソート、下部固定バスケットを1画面に持つ。同じく複数 API 呼び出し+行単位ローカル状態が多く宣言的語彙では表現しきれないため専用ノードにした。growth-chart は V3-AIP-101 個体詳細スライスA（c7-wireframes-core5 §4 F1/F2）: 依存追加なしの手書き SVG 折れ線（本個体実線+親破線オーバーレイ+コホート min-max 帯）。親データ無しはⓘ帯+親リンク小フォームを内包する第一級状態。individual-profile は同スライスAのヘッダ/血統健全度・近交リスクチップ/血縁レール/変化点タイムライン/sticky下端バーを1画面に持つ（GET /individuals/{id}/profile + /pedigree を自前取得）。thread-posts は c8（ui-asset-catalog.md 【最優先2】）: per-post avatar（actor_id モノグラム）/handle/body/引用badge/相談室（dispute）導線+スレ主のみの解決マーク（POST /plaza/posts への tags 規約・新 Truth 型なし）を1画面に持つ。GET /plaza/threads/{thread_id} + GET /me/profile を自前取得する。field は textarea variant（c8: 複数行返信本文）も表現する。
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
    | "search-navigator"
    | "growth-chart"
    | "individual-profile"
    | "thread-posts"
    | "target-navigator"
    | "individual-finder";
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
