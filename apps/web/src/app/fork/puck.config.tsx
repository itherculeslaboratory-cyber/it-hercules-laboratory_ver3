"use client";
// Puck(@measured/puck・MIT・丸ごと採用)の最小 Config。mockup パレット
// (見出し/数値カード/グラフ/表/ボタン)を Puck コンポーネントとして定義する。
// コンポーネント名は puck-to-screendef.ts の TYPE_MAP と一致させる(保存時に写像)。
// 描画は生 hex を避け --civ-* トークンで組む(check-ui-tokens 規律)。
import type { Config } from "@measured/puck";

export interface PuckProps {
  Heading: { text: string; level: string };
  KpiCard: { label: string; value: string };
  Chart: { title: string };
  Table: { title: string };
  Button: { label: string };
}

const box: React.CSSProperties = {
  background: "var(--civ-surface)",
  border: "1px solid var(--civ-border)",
  borderRadius: 9,
  padding: "11px 13px",
  color: "var(--civ-text)",
  fontSize: 13,
};

export const puckConfig: Config<PuckProps> = {
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
      fields: { label: { type: "text" } },
      defaultProps: { label: "ボタン" },
      render: ({ label }) => (
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
      ),
    },
  },
};
