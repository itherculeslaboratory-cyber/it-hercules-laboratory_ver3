import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { Renderer } from "./renderer";
import type { Action, ScreenDef } from "./types";

// g87-p0base: table の button/action セル(catalog L19 P0穴3件のうち残る1件
// — field textarea と scope条件表示(when)は発注時点で既に実装済みだった=
// 別途報告書に記載)。既存の row-as-scope 規約("link" cell の href_tpl・
// ImageGridNode の item_action_*)と既存の実行経路(ButtonNode の navigate/api
// 分岐・useRunAction)を合成しただけで、新しい実行経路は追加していない。

afterEach(() => cleanup());

function screenDef(nodes: ScreenDef["nodes"]): ScreenDef {
  return { screen_id: "t", route: "/t", title: "t", nodes };
}

describe("TableNode cell:'button' (g87-p0base — catalog L19 table button/actionセル)", () => {
  it("navigate action: interpolates `to`/`query` against the ROW (not page scope) and calls onNavigate", async () => {
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.path === "/api/v1/x") return { rows: [{ id: "R1", title: "個体A" }] };
      return undefined;
    });
    const onNavigate = vi.fn();
    render(
      <Renderer
        onAction={onAction}
        onNavigate={onNavigate}
        def={screenDef([
          {
            id: "t",
            type: "table",
            props: {
              source_path: "/api/v1/x",
              bind_items: "data.t.rows",
              columns: [
                { key: "title", label: "個体" },
                {
                  key: "id",
                  label: "操作",
                  cell: "button",
                  action: { kind: "navigate", to: "/s/ind-profile", query: { individual_id: "{{id}}" } },
                },
              ],
            },
          },
        ])}
      />,
    );
    await waitFor(() => expect(screen.getByText("個体A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "操作" }));
    expect(onNavigate).toHaveBeenCalledWith("/s/ind-profile", { individual_id: "R1" });
  });

  it("api action: interpolates `path` against the ROW, resolves `static` against the ROW, and fires via the shared execute path (toast included)", async () => {
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.method === "GET" && a.path === "/api/v1/x") {
        return { rows: [{ listing_id: "L1", note: "急ぎ" }] };
      }
      if (a.kind === "api" && a.method === "POST" && a.path === "/api/v1/market/listings/L1/approve") {
        return { ok: true };
      }
      return undefined;
    });
    render(
      <Renderer
        onAction={onAction}
        def={screenDef([
          {
            id: "t",
            type: "table",
            props: {
              source_path: "/api/v1/x",
              bind_items: "data.t.rows",
              columns: [
                {
                  key: "listing_id",
                  label: "承認",
                  cell: "button",
                  action: {
                    kind: "api",
                    method: "POST",
                    path: "/api/v1/market/listings/{{listing_id}}/approve",
                    toast: "承認しました",
                    static: { memo: "{{note}}" },
                  },
                },
              ],
            },
          },
        ])}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "承認" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "承認" }));
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith(
        { kind: "api", method: "POST", path: "/api/v1/market/listings/L1/approve", toast: "承認しました" },
        { memo: "急ぎ" },
      ),
    );
  });
});
