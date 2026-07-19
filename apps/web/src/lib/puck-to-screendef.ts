// reuse-first の唯一の自作部分(裁定 FORK-FC-2 / 代替A+B R174): 完成 OSS Puck の
// 保存形(JSON 部品ツリー)を、このアプリの画面定義 ScreenDef(screen_id/route/title/
// nodes/transitions・renderer/types.ts)へ変換するアダプタ。Puck を丸ごと採用し、自作は
// この写像だけに絞る。汎用の動作配線 UI(Langflow 的な物)は作らない — renderer が既に
// 持つ node.action(kind:api|navigate)/検索部品を「書き出す・読み戻す」だけ。
//
// 双方向:
//  ・puckToScreenDef … 組み立て/微調整した Puck Data → ScreenDef(保存)。
//  ・screenDefToPuck … 既存 ScreenDef → Puck Data((あ)既存画面の fork→微調整)。
//    無劣化のため、パレット部品で素直に編集できるノードだけ編集可能部品へ写し、
//    それ以外は Preserved(原文 JSON を保持・読み取り専用)にして保存時にそのまま書き戻す。
import type { ScreenDef, ScreenNode, Action } from "@/renderer/types";

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

// Puck コンポーネント名 → ScreenDef ノード種別。パレット(puck.config.tsx の components
// キー)と一致させる。search-navigator/target-navigator は renderer 実装済みの実動検索
// 部品を「そのまま置ける」ゼロ設定部品として開放したもの(新規の飾り部品ではない)。
const TYPE_MAP: Record<string, ScreenNode["type"]> = {
  Heading: "heading",
  KpiCard: "kpi-tile",
  Chart: "card",
  Table: "table",
  Button: "button",
  SearchNavigator: "search-navigator",
  TargetNavigator: "target-navigator",
};

const API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type ApiMethod = (typeof API_METHODS)[number];

// Button の動作(action)を Puck props → ScreenDef node.action へ写す。renderer は
// node.action をクリックで実行する既存実装。actionKind="none"(既定)は文字だけボタン。
function buttonAction(p: Record<string, unknown>): Action | undefined {
  const kind = String(p.actionKind ?? "none");
  if (kind === "navigate") {
    const to = String(p.navigateTo ?? "").trim();
    return to ? { kind: "navigate", to } : undefined;
  }
  if (kind === "api") {
    const path = String(p.apiPath ?? "").trim();
    const method = String(p.apiMethod ?? "POST").toUpperCase();
    if (path.startsWith("/") && (API_METHODS as readonly string[]).includes(method)) {
      return { kind: "api", method: method as ApiMethod, path };
    }
    return undefined;
  }
  return undefined;
}

function toNode(item: PuckItem, index: number): ScreenNode {
  const p = item.props ?? {};
  // Preserved: fork した既存ノードを一字一句そのまま書き戻す(可逆・無劣化)。
  if (item.type === "Preserved" && typeof p.raw === "string") {
    try {
      const node = JSON.parse(p.raw) as ScreenNode;
      if (node && typeof node === "object" && typeof node.type === "string") return node;
    } catch {
      /* 壊れた raw は下の text フォールバックへ */
    }
  }
  const id = typeof p.id === "string" && p.id ? p.id : `${item.type}-${index}`;
  const type = TYPE_MAP[item.type] ?? "text";
  const props: Record<string, unknown> = {};
  let action: Action | undefined;
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
      action = buttonAction(p);
      break;
    case "table":
      props.title = String(p.title ?? "表");
      break;
    case "card":
      props.title = String(p.title ?? "グラフ");
      break;
    case "search-navigator":
    case "target-navigator":
      // renderer が自前で実データを取得するゼロ設定の実動部品。props 不要。
      break;
    default:
      props.text = String(p.text ?? "");
  }
  const node: ScreenNode = { id, type };
  if (Object.keys(props).length) node.props = props;
  if (action) node.action = action;
  return node;
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

// ─────────────────────────────────────────────────────────────────────────────
// (あ) 既存画面の fork: ScreenDef → Puck Data(逆写像)。
// ─────────────────────────────────────────────────────────────────────────────

// ScreenDef ノード種別 → 編集可能な Puck コンポーネント名(TYPE_MAP の逆・素直な種のみ)。
const REVERSE_TYPE: Record<string, string> = {
  heading: "Heading",
  "kpi-tile": "KpiCard",
  button: "Button",
  "search-navigator": "SearchNavigator",
  "target-navigator": "TargetNavigator",
};

// Preserved ブロックに出す平易な種別名(画面には内部 enum を出さない・語彙辞書規律)。
const TYPE_LABEL: Record<string, string> = {
  text: "説明文",
  card: "カード",
  table: "表",
  list: "一覧",
  form: "入力フォーム",
  field: "入力欄",
  image: "画像",
  "image-grid": "画像グリッド",
  link: "リンク",
  "qr-code": "QRコード",
  badge: "バッジ",
  progress: "進捗",
  tabs: "タブ",
  stepper: "ステップ",
  "kpi-tile": "数値カード",
  "measurement-table": "計測入力表",
  "growth-chart": "成長グラフ",
  "individual-profile": "個体プロフィール",
  "search-navigator": "検索(個体をしぼり込む)",
  "target-navigator": "検索(観測対象をたどる)",
  "thread-posts": "スレッド投稿",
  "clutch-intake": "クラッチ割り出し",
  "batch-roster": "一括選択",
  "batch-summary": "一括確認",
  "batch-done": "一括完了",
  "recent-chips": "最近見た個体",
  "visit-tracker": "閲覧履歴(不可視)",
  disclosure: "折りたたみ",
  heading: "見出し",
  button: "ボタン",
};

function nodeSummary(node: ScreenNode): string {
  const label = TYPE_LABEL[node.type] ?? node.type;
  const p = node.props ?? {};
  const t = p.text ?? p.title ?? p.label;
  return typeof t === "string" && t ? `${label}: ${t}` : label;
}

// そのノードが「パレット部品で無劣化に編集できる」か。編集対象の props の部分集合で、
// 子/action(button の action は別扱い)など編集 UI が持たない構造が無い時だけ編集可能。
// 満たさなければ null → Preserved(原文保持)。
function editableItem(node: ScreenNode): PuckItem | null {
  if (!REVERSE_TYPE[node.type]) return null;
  const p = node.props ?? {};
  const keys = Object.keys(p);
  const id = node.id;
  if (node.type === "heading") {
    if (keys.some((k) => k !== "text" && k !== "level")) return null;
    return { type: "Heading", props: { id, text: String(p.text ?? ""), level: String(p.level ?? 2) } };
  }
  if (node.type === "kpi-tile") {
    if (keys.some((k) => k !== "label" && k !== "value")) return null;
    return { type: "KpiCard", props: { id, label: String(p.label ?? ""), value: String(p.value ?? "") } };
  }
  if (node.type === "button") {
    if (node.children?.length) return null;
    if (keys.some((k) => k !== "label")) return null; // variant/label_key 等があれば preserve
    const a = node.action;
    const props: Record<string, unknown> = {
      id,
      label: String(p.label ?? "ボタン"),
      actionKind: "none",
      navigateTo: "",
      apiMethod: "POST",
      apiPath: "",
    };
    if (a?.kind === "navigate") {
      props.actionKind = "navigate";
      props.navigateTo = a.to;
    } else if (a?.kind === "api") {
      props.actionKind = "api";
      props.apiMethod = a.method;
      props.apiPath = a.path;
    }
    return { type: "Button", props };
  }
  // 検索部品: props/children/action を持たない純粋なゼロ設定部品のみ編集可能扱い。
  if (node.type === "search-navigator" || node.type === "target-navigator") {
    if (keys.length || node.children?.length || node.action) return null;
    return { type: REVERSE_TYPE[node.type], props: { id } };
  }
  return null;
}

function findPage(def: ScreenDef): ScreenNode | undefined {
  const shell = def.nodes?.[0];
  if (!shell) return undefined;
  if (shell.type === "page") return shell;
  return shell.children?.find((n) => n.type === "page") ?? shell;
}

/** 既存 ScreenDef → Puck Data。編集できるノードは編集可能部品へ、それ以外は Preserved で
 *  原文を保持(保存時に puckToScreenDef が JSON.parse でそのまま書き戻す=無劣化 round-trip)。 */
export function screenDefToPuck(def: ScreenDef): PuckData {
  const page = findPage(def);
  const children = page?.children ?? [];
  const content: PuckItem[] = children.map((node) => {
    const e = editableItem(node);
    if (e) return e;
    return { type: "Preserved", props: { id: node.id, raw: JSON.stringify(node), summary: nodeSummary(node) } };
  });
  return { content, root: { props: {} } };
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
