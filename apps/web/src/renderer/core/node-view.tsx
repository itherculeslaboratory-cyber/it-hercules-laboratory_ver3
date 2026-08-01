"use client";

import { useContext, useEffect, type ReactElement } from "react";
import type { ScreenNode } from "../types";
import {
  DataSinkCtx,
  ExecuteCtx,
  HeaderScopeCtx,
  MessagesCtx,
  ScopeCtx,
} from "./context";
import { appendHeaderScope, compareLine, displayText, evalWhen, getPath, interpolate } from "./scope";
import { lookupNode } from "./registry";
import { UgcText } from "../renderer";

// renderer分割Phase 2b(uiplan §1-5 Phase2b①・g85-split2a-ruling §3 #5)。
// zone I(NodeView)をここへ移す。props/useSource/Children はNodeViewと不可分
// (循環)なのでNodeViewと同居させる(設計書の判断をそのまま踏襲)。
//
// zone C(button/form/field/card/table/badge/progress/tabs/image-grid/
// stepper/kpi-tile/visit-tracker/recent-chips/disclosure/qr-code/
// measurement-table/list/UgcText)の各コンポーネントは renderer.tsx 側に残る
// (Phase 3 = zone C分割はこのラウンドの範囲外)。NodeView が呼ぶ側なので
// "../renderer" から import する — renderer.tsx が NodeView をこのファイルから
// import する向きと合わさって循環importになるが、いずれも `function X() {}`
// 宣言(巻き上げされる)であり、モジュール評価時点で互いを呼び出さない
// (registerNode等はコンポーネント参照を保存するだけ)ため実行時は安全
// (Next.js/webpackのES循環import解決に依存。既存の Children↔NodeView 自己
// 循環と同種の実装判断)。専用ノード(zones/*.tsx)側は lookupNode() を使う —
// これが循環を作らずに9ゾーンを切り離せた理由(設計§1-3)。
import {
  BadgeNode,
  ButtonNode,
  CardNode,
  DisclosureNode,
  FieldNode,
  FormNode,
  ImageGridNode,
  KpiTileNode,
  ListNode,
  MeasurementTableNode,
  ProgressNode,
  QrNode,
  RecentChipsNode,
  StepperNode,
  TableNode,
  TabsNode,
  VisitTrackerNode,
} from "../renderer";

export function props(node: ScreenNode): Record<string, unknown> {
  return node.props ?? {};
}

// Fetch node.props.source_path (GET) on mount, store the response at data[id].
// HDR-1第2スライス(A1#4): props.header_scoped:true な画面定義ノードだけ、現在の
// ヘッダー観測対象を追加クエリとして付ける(明示オプトインで対象外の55画面の
// 大半は挙動不変 — market-trade.json の listings-grid 等が使う)。
export function useSource(node: ScreenNode) {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const headerScope = useContext(HeaderScopeCtx);
  const execute = useContext(ExecuteCtx);
  const { setNodeData } = useContext(DataSinkCtx);
  const rawPath = p.source_path ? interpolate(String(p.source_path), scope) : "";
  const path = rawPath && p.header_scoped ? appendHeaderScope(rawPath, headerScope) : rawPath;
  useEffect(() => {
    if (!path) return;
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path }))
      .then((r) => {
        if (alive && r !== undefined) setNodeData(node.id, r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
}

export function Children({ nodes }: { nodes?: ScreenNode[] }) {
  return (
    <>
      {(nodes ?? []).map((c) => (
        <NodeView key={c.id} node={c} />
      ))}
    </>
  );
}

function lookupOrNull(key: string, node: ScreenNode) {
  const Comp = lookupNode(key);
  return Comp ? <Comp node={node} /> : null;
}

export function NodeView({ node }: { node: ScreenNode }) {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const resolve = useContext(MessagesCtx);
  if (!evalWhen(p, scope)) return null;
  switch (node.type) {
    case "app-shell":
      return lookupOrNull("app-shell", node);
    case "page":
      return (
        <main className="civ-page">
          <Children nodes={node.children} />
        </main>
      );
    case "heading": {
      const level = Number(p.level ?? 1);
      const Tag = (level >= 2 ? "h2" : "h1") as "h1" | "h2";
      return (
        <Tag className="civ-heading" data-level={String(level)}>
          {interpolate(displayText(resolve, p.text_key, p.text, node.id), scope)}
          {p.draft ? <span className="civ-draft-badge">草案</span> : null}
        </Tag>
      );
    }
    case "text": {
      // V3-AIP-101 磨き直し fix#4: hide_if_empty_path points at a scope array
      // (e.g. pedigree.parents) — an empty/absent array swaps the templated
      // text for a muted replacement line (or nothing, if none is given)
      // instead of interpolating "×" out of two missing tokens.
      if (p.hide_if_empty_path) {
        const arr = getPath(scope, String(p.hide_if_empty_path));
        const isEmpty = !Array.isArray(arr) || arr.length === 0;
        if (isEmpty) {
          if (p.empty_replacement_text || p.empty_replacement_text_key) {
            return (
              <p className="civ-text" data-muted="true">
                {displayText(resolve, p.empty_replacement_text_key, p.empty_replacement_text, "")}
              </p>
            );
          }
          return null;
        }
      }
      const content = interpolate(displayText(resolve, p.text_key, p.text, ""), scope);
      // V3-AIP-101 F6 の静的 Δ recap: compare_current is a scope template (the
      // saved value, e.g. "{{params.weight_g}}") rather than live input — the
      // FieldNode twin above compares against what the user is typing instead.
      if (p.compare_source) {
        const curRaw = p.compare_current != null ? interpolate(String(p.compare_current), scope) : "";
        const curNum = curRaw !== "" ? Number(curRaw) : null;
        const cmp = compareLine(scope, {
          source: p.compare_source,
          item: p.compare_item,
          unit: p.compare_unit,
          exclude: p.compare_exclude,
          current: curNum != null && Number.isFinite(curNum) ? curNum : null,
        });
        return (
          <p className="civ-text">
            {content}
            {content && cmp ? "　" : ""}
            {cmp}
          </p>
        );
      }
      if (p.ugc) return <UgcText node={node} text={content} />;
      return (
        <p className="civ-text" data-muted={p.muted === true || undefined}>
          {content}
        </p>
      );
    }
    case "button":
      return <ButtonNode node={node} />;
    case "form":
      return <FormNode node={node} />;
    case "field":
      return <FieldNode node={node} />;
    case "list":
      return <ListNode node={node} />;
    case "card":
      return <CardNode node={node} />;
    case "image": {
      // V3-OBS-24 hero 写真: hide_if_empty_path (text node と同じ規約) は
      // capture.photos が空の観測(写真なし)でも壊れた <img src> を出さない
      // ためのガード。
      if (p.hide_if_empty_path) {
        const arr = getPath(scope, String(p.hide_if_empty_path));
        if (!Array.isArray(arr) || arr.length === 0) {
          return p.empty_text ? <p className="civ-empty">{String(p.empty_text)}</p> : null;
        }
      }
      // eslint-disable-next-line @next/next/no-img-element
      return (
        <img
          className="civ-image"
          src={interpolate(String(p.src ?? ""), scope)}
          alt={String(p.alt ?? "")}
        />
      );
    }
    case "qr-code":
      return <QrNode node={node} />;
    case "measurement-table":
      return <MeasurementTableNode node={node} />;
    case "table":
      return <TableNode node={node} />;
    case "badge":
      return <BadgeNode node={node} />;
    case "progress":
      return <ProgressNode node={node} />;
    case "tabs":
      return <TabsNode node={node} />;
    case "image-grid":
      return <ImageGridNode node={node} />;
    case "stepper":
      return <StepperNode node={node} />;
    case "kpi-tile":
      return <KpiTileNode node={node} />;
    case "visit-tracker":
      return <VisitTrackerNode node={node} />;
    case "recent-chips":
      return <RecentChipsNode node={node} />;
    case "disclosure":
      return <DisclosureNode node={node} />;
    case "clutch-intake":
      return lookupOrNull("clutch-intake", node);
    case "batch-roster":
      return lookupOrNull("batch-roster", node);
    case "batch-summary":
      return lookupOrNull("batch-summary", node);
    case "batch-done":
      return lookupOrNull("batch-done", node);
    case "search-navigator": {
      // SearchNavigatorNode は他の専用ノードと違い {tabId} を受け取る
      // (node ではない・zones/search.tsx:709)。lookupNode 経由でも元の
      // シグネチャを維持するため、ここだけ node.props から tabId を取り出す。
      const SearchNavigator = lookupNode("search-navigator") as
        | ((props: { tabId?: string }) => ReactElement | null)
        | undefined;
      return SearchNavigator ? (
        <SearchNavigator tabId={node.props?.tab_id != null ? String(node.props.tab_id) : undefined} />
      ) : null;
    }
    case "research-panel":
      return lookupOrNull("research-panel", node);
    case "growth-chart":
      return lookupOrNull("growth-chart", node);
    case "individual-profile":
      return lookupOrNull("individual-profile", node);
    case "thread-posts":
      return lookupOrNull("thread-posts", node);
    case "target-navigator":
      return lookupOrNull("target-navigator", node);
    case "graph-view":
      return lookupOrNull("graph-view", node);
    case "link": {
      const href = interpolate(String(p.href ?? p.to ?? "#"), scope);
      return (
        <a className="civ-link" href={href}>
          {displayText(resolve, p.label_key, p.label ?? p.text, href)}
        </a>
      );
    }
    default:
      return null;
  }
}
