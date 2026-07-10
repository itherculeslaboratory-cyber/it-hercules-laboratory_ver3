import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { Renderer } from "./renderer";
import type { ScreenDef } from "./types";
import { allScreenDefs } from "@/lib/screendefs";
// GATE logic under test (color discipline). Imported for the negative case.
import { scanColors } from "../../../../scripts/check-ui-tokens.mjs";

afterEach(() => cleanup());

function screenDef(nodes: ScreenDef["nodes"]): ScreenDef {
  return { screen_id: "t", route: "/t", title: "t", nodes };
}

describe("Renderer — screen-defs", () => {
  it("renders every one of the 7 MVP screen-defs", () => {
    const defs = allScreenDefs();
    expect(defs.length).toBe(7);
    for (const def of defs) {
      const { unmount } = render(<Renderer def={def} onAction={vi.fn()} />);
      // each screen has an h1 heading node -> title text is on screen
      expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe("Renderer — button state + keyboard (V3-UIX-81)", () => {
  it("carries the common interactive class (focus-visible/44px come from it)", () => {
    render(
      <Renderer
        def={screenDef([
          { id: "b", type: "button", props: { label: "押す" }, action: { kind: "navigate", to: "home" } },
        ])}
        onAction={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "押す" });
    expect(btn).toHaveClass("civ-interactive");
  });

  it("fires the action on keyboard activation (Enter/Space via click)", async () => {
    const onAction = vi.fn();
    render(
      <Renderer
        def={screenDef([
          { id: "b", type: "button", props: { label: "実行" }, action: { kind: "navigate", to: "home" } },
        ])}
        onAction={onAction}
      />,
    );
    const btn = screen.getByRole("button", { name: "実行" });
    btn.focus();
    expect(btn).toHaveFocus(); // keyboard-reachable
    // native button: Enter/Space dispatch a click; action executor is async
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onAction).toHaveBeenCalledWith({ kind: "navigate", to: "home" });
  });

  it("renders disabled state (aria-disabled + disabled, no action)", () => {
    const onAction = vi.fn();
    render(
      <Renderer
        def={screenDef([
          { id: "b", type: "button", props: { label: "無効", disabled: true }, action: { kind: "navigate", to: "home" } },
        ])}
        onAction={onAction}
      />,
    );
    const btn = screen.getByRole("button", { name: "無効" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(btn);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renders loading state (aria-busy + data-loading)", () => {
    render(
      <Renderer
        def={screenDef([{ id: "b", type: "button", props: { label: "送信中", loading: true } }])}
        onAction={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "送信中" });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveAttribute("data-loading", "true");
  });

  it("renders error state (aria-invalid + alert text)", () => {
    render(
      <Renderer
        def={screenDef([{ id: "b", type: "button", props: { label: "失敗", error: "送信に失敗しました" } }])}
        onAction={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "失敗" });
    expect(btn).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("送信に失敗しました");
  });
});

describe("Renderer — form aria-invalid (field regime)", () => {
  it("marks a declaratively-invalid field with aria-invalid/data-invalid", () => {
    render(
      <Renderer
        def={screenDef([
          {
            id: "f",
            type: "form",
            children: [
              { id: "email", type: "field", props: { variant: "text", name: "email", label: "メール", invalid: true } },
            ],
          },
        ])}
        onAction={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("メール");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("data-invalid", "true");
  });

  it("marks required-empty fields invalid on submit and blocks the action", () => {
    const onAction = vi.fn();
    render(
      <Renderer
        def={screenDef([
          {
            id: "f",
            type: "form",
            action: { kind: "api", method: "POST", path: "/api/v1/observation/captures" },
            children: [
              { id: "item", type: "field", props: { variant: "text", name: "item", label: "項目", required: true } },
              { id: "s", type: "button", props: { label: "保存", type: "submit" } },
            ],
          },
        ])}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByLabelText(/項目/)).toHaveAttribute("aria-invalid", "true");
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe("ThemePack — prefers-reduced-motion + token discipline", () => {
  const css = readFileSync(
    join(process.cwd(), "src", "app", "globals.css"),
    "utf8",
  );

  it("stops transitions/animations under prefers-reduced-motion", () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it("raw color GATE detects a violation (negative)", () => {
    // built by concatenation so the literal does not sit in this .tsx file
    // (the GATE scans .tsx too — it must stay clean of raw color).
    const badHex = "color:" + "#" + "0d0d0d";
    const badClass = "bg-" + "blue-500";
    expect(scanColors(badHex).length).toBeGreaterThan(0);
    expect(scanColors(badClass).length).toBeGreaterThan(0);
    expect(scanColors("class='civ-button' style='color:var(--civ-text)'")).toHaveLength(0);
  });
});
