import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Renderer } from "./renderer";
import type { ScreenDef } from "./types";

// V3-BBS-03: every screen template gets the 3 boards (説明/愚痴/改善) without
// per-screen-def wiring — Renderer itself appends <ScreenBoardsFooter>, keyed
// on channel = `screen-${screen_id}` (plaza-routes.ts projectChannelThreads /
// plaza-constants.ts BOARD_KINDS reused verbatim, no new Truth type/route).

afterEach(() => cleanup());

function screenDef(screenId: string): ScreenDef {
  return { screen_id: screenId, route: `/${screenId}`, title: screenId, nodes: [] };
}

describe("ScreenBoardsFooter (V3-BBS-03 全画面テンプレート必須付与)", () => {
  it("renders collapsed by default and makes zero API calls until opened", () => {
    const onAction = vi.fn(async () => undefined);
    render(<Renderer def={screenDef("t")} onAction={onAction} />);
    expect(screen.getByRole("button", { name: "このページの掲示板を開く(説明・愚痴・改善)" })).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("fetches channel=screen-<id> threads and shows 3 board groups with counts", async () => {
    const onAction = vi.fn(async (action: { path: string }) => {
      if (action.path === "/api/v1/plaza/channels/screen-t/threads") {
        return {
          channel: "screen-t",
          threads: [{ thread_id: "th1", topic: "使い方が分からない", board_kind: "guide", post_count: 2 }],
          boards: {
            guide: [{ thread_id: "th1", topic: "使い方が分からない", board_kind: "guide", post_count: 2 }],
            complaint: [],
            improvement: [],
          },
        };
      }
      return undefined;
    });
    render(<Renderer def={screenDef("t")} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "このページの掲示板を開く(説明・愚痴・改善)" }));
    expect(await screen.findByText("説明（1）")).toBeInTheDocument();
    expect(screen.getByText("愚痴（0）")).toBeInTheDocument();
    expect(screen.getByText("改善（0）")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "使い方が分からない（2）" })).toHaveAttribute(
      "href",
      "/s/knowledge-thread?thread_id=th1",
    );
  });

  it("posts a new thread with channel=screen-<id> and the selected board_kind", async () => {
    const onAction = vi.fn(async (action: { path: string; method?: string }, body?: unknown) => {
      if (action.method === "POST" && action.path === "/api/v1/plaza/posts") return { post_id: "p1", thread_id: "p1" };
      return undefined;
    });
    render(<Renderer def={screenDef("t")} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "このページの掲示板を開く(説明・愚痴・改善)" }));
    fireEvent.change(screen.getByLabelText("話題"), { target: { value: "不便な点" } });
    fireEvent.change(screen.getByLabelText("本文"), { target: { value: "ここが分かりにくい" } });
    fireEvent.click(screen.getByRole("button", { name: "投稿する" }));
    await vi.waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(
        { kind: "api", method: "POST", path: "/api/v1/plaza/posts" },
        { channel: "screen-t", board_kind: "complaint", topic: "不便な点", body: "ここが分かりにくい" },
      );
    });
  });
});
