import { describe, it, expect } from "vitest";
import { puckToScreenDef, slugify, type PuckData } from "./puck-to-screendef";

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
});
