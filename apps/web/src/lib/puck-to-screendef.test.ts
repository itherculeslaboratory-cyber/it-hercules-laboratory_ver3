import { describe, it, expect } from "vitest";
import { puckToScreenDef, screenDefToPuck, slugify, type PuckData } from "./puck-to-screendef";
import type { ScreenDef } from "@/renderer/types";

describe("puckToScreenDef adapter (Puck 保存形 → ScreenDef)", () => {
  it("maps palette components onto ScreenDef node types under app-shell/page", () => {
    const data: PuckData = {
      root: { props: {} },
      content: [
        { type: "Heading", props: { id: "h1", text: "今日の観測", level: "1" } },
        { type: "KpiCard", props: { id: "k1", label: "温度", value: "23.4℃" } },
        { type: "Chart", props: { id: "c1", title: "体重の推移" } },
        { type: "Table", props: { id: "t1", title: "観測一覧" } },
        { type: "Button", props: { id: "b1", label: "保存" } },
      ],
    };
    const def = puckToScreenDef(data, { screenId: "ui-template-demo", title: "デモ" });

    // top shape matches ScreenDef contract
    expect(def.screen_id).toBe("ui-template-demo");
    expect(def.route).toBe("/s/ui-template-demo");
    expect(def.nodes[0].type).toBe("app-shell");
    const page = def.nodes[0].children![0];
    expect(page.type).toBe("page");

    const kids = page.children!;
    expect(kids.map((n) => n.type)).toEqual(["heading", "kpi-tile", "card", "table", "button"]);
    expect(kids[0].props).toMatchObject({ text: "今日の観測", level: 1 });
    expect(kids[1].props).toMatchObject({ label: "温度", value: "23.4℃" });
    expect(kids[4].props).toMatchObject({ label: "保存" });
    // ids are preserved from Puck
    expect(kids[0].id).toBe("h1");
  });

  it("empty canvas yields an empty page (no fabricated nodes)", () => {
    const def = puckToScreenDef({ content: [] }, { screenId: "x", title: "空" });
    expect(def.nodes[0].children![0].children).toEqual([]);
  });

  it("slugify produces ascii-kebab screen ids with a safe fallback", () => {
    expect(slugify("Temp Dash")).toBe("ui-template-temp-dash");
    expect(slugify("観測ダッシュ")).toBe("ui-template-custom");
  });

  // (い) 実動部品の開放: 検索2種 + ボタン動作(action)の書き出し。
  it("maps the two real search parts to their renderer node types", () => {
    const def = puckToScreenDef(
      {
        content: [
          { type: "SearchNavigator", props: { id: "s1" } },
          { type: "TargetNavigator", props: { id: "t1" } },
        ],
      },
      { screenId: "x", title: "検索" },
    );
    const kids = def.nodes[0].children![0].children!;
    expect(kids.map((n) => n.type)).toEqual(["search-navigator", "target-navigator"]);
    // ゼロ設定部品: 余計な props を捏造しない(renderer が自前で実データを取る)。
    expect(kids[0].props).toBeUndefined();
  });

  it("writes node.action for a button wired to a screen (ボタンに検索を紐付ける)", () => {
    const def = puckToScreenDef(
      {
        content: [
          {
            type: "Button",
            props: { id: "b1", label: "検索する", actionKind: "navigate", navigateTo: "obs-search" },
          },
        ],
      },
      { screenId: "x", title: "y" },
    );
    const btn = def.nodes[0].children![0].children![0];
    expect(btn.action).toEqual({ kind: "navigate", to: "obs-search" });
  });

  it("writes an api action and rejects malformed api input", () => {
    const ok = puckToScreenDef(
      { content: [{ type: "Button", props: { id: "b", label: "送信", actionKind: "api", apiMethod: "POST", apiPath: "/api/v1/x" } }] },
      { screenId: "x", title: "y" },
    );
    expect(ok.nodes[0].children![0].children![0].action).toEqual({ kind: "api", method: "POST", path: "/api/v1/x" });

    const bad = puckToScreenDef(
      { content: [{ type: "Button", props: { id: "b", label: "送信", actionKind: "api", apiMethod: "POST", apiPath: "no-slash" } }] },
      { screenId: "x", title: "y" },
    );
    // path が "/" 始まりでない → action を書き出さない(誇張ゼロ・壊れた導線を作らない)。
    expect(bad.nodes[0].children![0].children![0].action).toBeUndefined();
  });

  it("actionKind=none leaves the button as text only (従来どおり)", () => {
    const def = puckToScreenDef(
      { content: [{ type: "Button", props: { id: "b", label: "ただの文字", actionKind: "none" } }] },
      { screenId: "x", title: "y" },
    );
    expect(def.nodes[0].children![0].children![0].action).toBeUndefined();
  });
});

describe("screenDefToPuck adapter ((あ) 既存画面の fork・無劣化 round-trip)", () => {
  const def: ScreenDef = {
    screen_id: "sample",
    route: "/sample",
    title: "見本",
    layout: "standard",
    nodes: [
      {
        id: "shell",
        type: "app-shell",
        children: [
          {
            id: "page",
            type: "page",
            children: [
              { id: "title", type: "heading", props: { text: "見本", level: 1 } },
              { id: "lead", type: "text", props: { text: "説明", muted: true } }, // 未対応 → Preserved
              { id: "find", type: "button", props: { label: "対象を特定する" }, action: { kind: "navigate", to: "obs-navigator" } },
              { id: "styled", type: "button", props: { label: "戻る", variant: "secondary" }, action: { kind: "navigate", to: "home" } }, // variant → Preserved
              { id: "nav", type: "search-navigator" },
              { id: "grid", type: "card", props: { title: "枠", source_path: "/api/v1/x" } }, // props 過多 → Preserved
            ],
          },
        ],
      },
    ],
    transitions: [],
  };

  it("maps clean nodes to editable components and preserves the rest verbatim", () => {
    const puck = screenDefToPuck(def);
    const types = (puck.content ?? []).map((i) => i.type);
    expect(types).toEqual(["Heading", "Preserved", "Button", "Preserved", "SearchNavigator", "Preserved"]);

    const btn = puck.content!.find((i) => i.props?.id === "find")!;
    expect(btn.props).toMatchObject({ actionKind: "navigate", navigateTo: "obs-navigator", label: "対象を特定する" });

    // Preserved は原文 JSON を丸ごと保持する。
    const lead = puck.content!.find((i) => i.props?.id === "lead")!;
    expect(lead.type).toBe("Preserved");
    expect(JSON.parse(String(lead.props!.raw))).toEqual(def.nodes[0].children![0].children![1]);
  });

  it("round-trips losslessly: screenDefToPuck → puckToScreenDef equals the original page children", () => {
    const puck = screenDefToPuck(def);
    const back = puckToScreenDef(puck, { screenId: "sample", title: "見本" });
    expect(back.nodes[0].children![0].children).toEqual(def.nodes[0].children![0].children);
  });
});
