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
  | "link"
  | "measurement-table"
  // A層共有レンダラ語彙（c7 ui-parity-map §2）。table/badge/progress/tabs/
  // image-grid/stepper/kpi-tile の 7 種を追加。card は既存ノードに rich な
  // props（icon/title/meta/badges/action によるナビ）を additive に拡張した
  // ので新種は起こしていない（上位互換・既存 screen-def は無変更で動く）。
  | "table"
  | "badge"
  | "progress"
  | "tabs"
  | "image-grid"
  | "stepper"
  | "kpi-tile"
  // V3-AIP-101 観測登録スライス1(c7): client-only "recently viewed individual"
  // convenience cache (no new Truth type). visit-tracker stamps localStorage on
  // mount (invisible); recent-chips reads the last 3 as tap-to-navigate chips.
  | "visit-tracker"
  | "recent-chips"
  // V3-AIP-101 磨き直し(c7 親レビュー13件・fix#5/#6): a collapsed-by-default
  // trigger (badge- or button-styled) that reveals its children on tap. Shared
  // by the F2 stage chip and the death-record button — one mechanism, no fork.
  | "disclosure"
  // V3-AIP-101 観測登録スライス2(c7-wireframes-core5 §F3/F4/F5/F6): クラッチ
  // 割り出し1画面完結フォーム(F3)/お世話・移動・クラッチ照合昇格の一括選択
  // グリッド(F4)/バッチ確認サマリ(F5b)/バッチ保存後の完了表示(F6b)。
  | "clutch-intake"
  | "batch-roster"
  | "batch-summary"
  | "batch-done"
  // V3-AIP-101 検索スライスA(c7-wireframes-core5 §2 obs-navigator のトーン/
  // 語彙のみ流用): GET /individuals + GET /placements の取得、保存検索チップ
  // (localStorage)、ファセット絞り込み+0件緩和バー、4択ソート、下部固定
  // バスケットを1画面に持つ。
  | "search-navigator"
  // V3-AIP-101 個体詳細スライスA(c7-wireframes-core5 §4 F1/F2): 手書き SVG
  // 折れ線チャート(本個体実線+親破線オーバーレイ+コホート帯)。依存追加禁止
  // (ライブラリ無し)。親カーブ欠損時はⓘ帯+親リンクの小フォームを内包。
  | "growth-chart"
  // V3-AIP-101 個体詳細スライスA: ヘッダ(名前/種/ステージ/状態badge・死亡記録
  // /誤記録訂正)+血統健全度・近交リスクチップ+血縁レール(親/子/きょうだい
  // chip・chipタップで対象個体を差替)+変化点タイムライン(観測+life-events
  // マージ・Δ計算・値の訂正)+sticky下端の次の一手バーを1画面に持つ。
  // GET /individuals/{id}/profile + /pedigree の2本を自前取得する(growth-chart
  // と合わせて2重取得になるが、この規模では素朴な自前fetchのほうが軽い —
  // search-navigator/batch-summary と同じ縮退)。
  | "individual-profile";

// field node props.variant (V3-AUT-06 adds "checkbox"; V3-OBS-18 adds
// "segmented" — a horizontal toggle group of radios). Documents the supported
// controls; the Renderer reads props.variant untyped, schema is the SSOT.
export type FieldVariant =
  | "text"
  | "number"
  | "date"
  | "select"
  | "photo"
  | "checkbox"
  | "segmented"
  // V3-AIP-101: an invisible carry-forward field (props.default, scope-
  // interpolated) — e.g. the individual id riding F2 → F5 through the draft.
  | "hidden";

// Documented props the Renderer understands (props stays an open Record so the
// schema — additionalProperties:true — remains the SSOT). C5/K4 adds:
//  - text_key/label_key: i18n catalog keys resolved via MessagesCtx (I18-08);
//    the literal text/label is the fallback when a key does not resolve.
//  - empty_text: honest empty-state copy for list/card (V3-UIX-03).
//  - draft: render a "草案" badge on the heading/card (V3-UIX-45).
//  - ugc + lang: mark viewer-generated text; enables the on-device translate
//    affordance when the viewer locale differs from `lang` (V3-I18-06).
//  - next_step: trailing "次にやること" navigation hint (V3-UIX-05).
// A層（c7 ui-parity-map §2）: table props.columns[] ({key,label,cell:
// "text"|"badge"|"progress",tone_key,max}) + bind_items; badge/progress
// props.tone (success|warning|caution|neutral — no new hex, mapped onto the
// existing primary/danger/muted trio); tabs props.tabs[] + child props.tab_id;
// image-grid mirrors list's bind_items with item_image/item_label/item_meta/
// item_badge; stepper props.steps[] + props.current; kpi-tile props.value/
// label/trend. card gains icon/title/meta/badges[] + a nav chevron rendered
// when the card node itself carries an `action`.
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
