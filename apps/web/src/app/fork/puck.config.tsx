"use client";
// Puck(@measured/puck・MIT・丸ごと採用)の Config。パレット = 飾り部品(見出し/数値
// カード/グラフ/表/ボタン)+ 既に動く実動部品(検索2種)。コンポーネント名は
// puck-to-screendef.ts の TYPE_MAP と一致させる(保存時に写像)。描画は生 hex を避け
// --civ-* トークンで組む(check-ui-tokens 規律)。
//
// 代替A+B(R174): 新しい飾り部品は作らず、renderer が既に実データ付きで描ける部品を
// 「パレットから選べるようにするだけ」。検索2種はゼロ設定で置ける(renderer が自前で
// GET /individuals・POST /observation/targets/search を叩く)。ボタンは動作(action)を
// 選べる欄を持ち、renderer の既存 node.action(kind:navigate|api)として書き出す。
// Preserved は fork した既存ノードを無劣化で保持する内部部品(パレット非表示)。
import type { Config } from "@measured/puck";

export interface PuckProps {
  Heading: { text: string; level: string };
  KpiCard: { label: string; value: string };
  Chart: { title: string };
  Table: { title: string };
  Button: { label: string; actionKind: string; navigateTo: string; apiMethod: string; apiPath: string };
  SearchNavigator: Record<string, never>;
  TargetNavigator: Record<string, never>;
  Preserved: { summary: string; raw: string };
}

const box: React.CSSProperties = {
  background: "var(--civ-surface)",
  border: "1px solid var(--civ-border)",
  borderRadius: 9,
  padding: "11px 13px",
  color: "var(--civ-text)",
  fontSize: 13,
};

// ボタンの動作先(画面へ移動)= 実在する screen_id。平易語ラベルで見せる(内部語を出さない)。
// 先頭に「検索」を置き、R168『ボタンに検索を紐付ける』を最短で選べるようにする。
const NAV_OPTIONS = [
  { label: "(選んでください)", value: "" },
  { label: "検索(個体をしぼり込む)へ移動", value: "obs-search" },
  { label: "検索(観測対象をたどる)へ移動", value: "obs-navigator" },
  { label: "観測を記録する へ移動", value: "obs-entry" },
  { label: "個体一覧 へ移動", value: "species" },
  { label: "市場 へ移動", value: "market-trade" },
  { label: "知の広場 へ移動", value: "knowledge-hub" },
  { label: "ホーム へ移動", value: "home" },
];

function actionCaption(actionKind: string, navigateTo: string, apiMethod: string, apiPath: string): string {
  if (actionKind === "navigate") {
    const opt = NAV_OPTIONS.find((o) => o.value === navigateTo);
    return navigateTo ? `→ ${opt ? opt.label : navigateTo}` : "→ 移動先を選んでください";
  }
  if (actionKind === "api") return apiPath ? `→ ${apiMethod} ${apiPath}` : "→ 送信先(API)を入れてください";
  return "押しても何もしません(動作なし)";
}

export const puckConfig: Config<PuckProps> = {
  categories: {
    parts: {
      title: "部品",
      components: ["Heading", "KpiCard", "Chart", "Table", "Button", "SearchNavigator", "TargetNavigator"],
    },
    // Preserved は fork 時にだけ生成する内部部品。パレットには出さない。
    internal: { title: "保持ブロック", visible: false, components: ["Preserved"] },
  },
  components: {
    Heading: {
      label: "見出し",
      fields: {
        text: { type: "text" },
        level: {
          type: "select",
          options: [
            { label: "大", value: "1" },
            { label: "中", value: "2" },
            { label: "小", value: "3" },
          ],
        },
      },
      defaultProps: { text: "見出し", level: "2" },
      render: ({ text, level }) => (
        <div style={{ ...box, fontWeight: 800, fontSize: level === "1" ? 20 : level === "3" ? 13 : 16 }}>{text}</div>
      ),
    },
    KpiCard: {
      label: "数値カード",
      fields: { label: { type: "text" }, value: { type: "text" } },
      defaultProps: { label: "温度", value: "23.4℃" },
      render: ({ label, value }) => (
        <div style={box}>
          <div style={{ fontSize: 11, color: "var(--civ-text-muted)" }}>{label}</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{value}</div>
        </div>
      ),
    },
    Chart: {
      label: "グラフ",
      fields: { title: { type: "text" } },
      defaultProps: { title: "体重の推移" },
      render: ({ title }) => (
        <div style={box}>
          <div style={{ fontWeight: 700 }}>📈 {title}</div>
          <div style={{ fontSize: 11, color: "var(--civ-text-muted)", marginTop: 4 }}>
            参照するデータは各画面側で結びます
          </div>
        </div>
      ),
    },
    Table: {
      label: "表",
      fields: { title: { type: "text" } },
      defaultProps: { title: "観測一覧" },
      render: ({ title }) => (
        <div style={box}>
          <div style={{ fontWeight: 700 }}>▦ {title}</div>
        </div>
      ),
    },
    Button: {
      label: "ボタン",
      fields: {
        label: { type: "text" },
        actionKind: {
          type: "select",
          options: [
            { label: "動作なし(文字だけ)", value: "none" },
            { label: "画面へ移動する", value: "navigate" },
            { label: "データを送る/取得する(API)", value: "api" },
          ],
        },
        navigateTo: { type: "select", options: NAV_OPTIONS },
        apiMethod: {
          type: "select",
          options: [
            { label: "GET", value: "GET" },
            { label: "POST", value: "POST" },
            { label: "PUT", value: "PUT" },
            { label: "PATCH", value: "PATCH" },
            { label: "DELETE", value: "DELETE" },
          ],
        },
        apiPath: { type: "text" },
      },
      defaultProps: { label: "ボタン", actionKind: "none", navigateTo: "", apiMethod: "POST", apiPath: "" },
      render: ({ label, actionKind, navigateTo, apiMethod, apiPath }) => (
        <div>
          <button
            type="button"
            style={{
              background: "var(--civ-primary)",
              color: "var(--civ-primary-text)",
              border: "none",
              borderRadius: 999,
              padding: "9px 18px",
              fontWeight: 700,
            }}
          >
            {label}
          </button>
          <div style={{ fontSize: 11, color: "var(--civ-text-muted)", marginTop: 4 }}>
            {actionCaption(actionKind, navigateTo, apiMethod, apiPath)}
          </div>
        </div>
      ),
    },
    SearchNavigator: {
      label: "検索(個体をしぼり込む)",
      fields: {},
      defaultProps: {},
      render: () => (
        <div style={box}>
          <div style={{ fontWeight: 700 }}>🔎 検索(個体をしぼり込む)</div>
          <div style={{ fontSize: 11, color: "var(--civ-text-muted)", marginTop: 4 }}>
            実データに接続済みの検索部品です。条件で個体をしぼり込みます(このまま置くだけで動きます)。
          </div>
        </div>
      ),
    },
    TargetNavigator: {
      label: "検索(観測対象をたどる)",
      fields: {},
      defaultProps: {},
      render: () => (
        <div style={box}>
          <div style={{ fontWeight: 700 }}>🔎 検索(観測対象をたどる)</div>
          <div style={{ fontSize: 11, color: "var(--civ-text-muted)", marginTop: 4 }}>
            実データに接続済みの検索部品です。名前・はい/いいえ・分類の3通りで対象をたどります。
          </div>
        </div>
      ),
    },
    Preserved: {
      label: "保持ブロック",
      fields: { summary: { type: "text" }, raw: { type: "textarea" } },
      defaultProps: { summary: "(保持ブロック)", raw: "" },
      render: ({ summary }) => (
        <div style={{ ...box, borderStyle: "dashed", color: "var(--civ-text-muted)" }}>
          <div style={{ fontWeight: 700 }}>🔒 そのまま保持: {summary}</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>
            この部品は元の画面のまま保存されます(この簡易ビルダーでは中身を編集しません)。
          </div>
        </div>
      ),
    },
  },
};
