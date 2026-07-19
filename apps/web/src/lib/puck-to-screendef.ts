// reuse-first の唯一の自作部分(裁定 FORK-FC-2): 完成 OSS Puck の保存形(JSON 部品ツリー)
// を、このアプリの画面定義 ScreenDef(screen_id/route/title/nodes/transitions・renderer/types.ts)
// へ変換するアダプタ。Puck を丸ごと採用し、自作はこの写像だけに絞る。
//
// Puck の content 各要素 { type, props:{id,...} } を ScreenDef ノードへ1対1で写す。
// blank なビルダーから作るテンプレは配線先データを持たないため、グラフ/表は骨組み(card/table)
// として写す(誇張ゼロ — 実データ束縛は各画面側の後続作業)。
import type { ScreenDef, ScreenNode } from "@/renderer/types";

// Puck Data の必要最小限を構造的に写した型(Puck ランタイムを import せず、テストを
// node 単体で走らせるため)。Puck 実体の Data はこの形の上位互換。
export interface PuckItem {
  type: string;
  props?: Record<string, unknown> & { id?: string };
}
export interface PuckData {
  content?: PuckItem[];
  root?: { props?: Record<string, unknown> };
}

// Puck コンポーネント名 → ScreenDef ノード種別。mockup パレット(見出し/数値カード/
// グラフ/表/ボタン)= puck.config.tsx の components キーと一致させる。
const TYPE_MAP: Record<string, ScreenNode["type"]> = {
  Heading: "heading",
  KpiCard: "kpi-tile",
  Chart: "card",
  Table: "table",
  Button: "button",
};

function toNode(item: PuckItem, index: number): ScreenNode {
  const p = item.props ?? {};
  const id = typeof p.id === "string" && p.id ? p.id : `${item.type}-${index}`;
  const type = TYPE_MAP[item.type] ?? "text";
  const props: Record<string, unknown> = {};
  switch (type) {
    case "heading":
      props.text = String(p.text ?? "見出し");
      props.level = Number(p.level ?? 2) || 2;
      break;
    case "kpi-tile":
      props.label = String(p.label ?? "");
      props.value = String(p.value ?? "");
      break;
    case "button":
      props.label = String(p.label ?? "ボタン");
      break;
    case "table":
      props.title = String(p.title ?? "表");
      break;
    case "card":
      props.title = String(p.title ?? "グラフ");
      break;
    default:
      props.text = String(p.text ?? "");
  }
  return { id, type, props };
}

/** Puck Data → ScreenDef。screenId/title は保存フォームの入力から与える。 */
export function puckToScreenDef(data: PuckData, meta: { screenId: string; title: string }): ScreenDef {
  const children = (data.content ?? []).map(toNode);
  return {
    screen_id: meta.screenId,
    route: `/s/${meta.screenId}`,
    title: meta.title,
    layout: "standard",
    nodes: [
      {
        id: "shell",
        type: "app-shell",
        children: [{ id: "page", type: "page", children }],
      },
    ],
    transitions: [],
  };
}

/** テンプレ名 → screen_id 用の ascii kebab スラグ(schema の key は任意文字列だが、
 *  他の screen_id と同じ英小文字 kebab に揃える)。空になったら custom へフォールバック。 */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s ? `ui-template-${s}` : "ui-template-custom";
}
