import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { Renderer } from "./renderer";
import type { Action, ScreenDef } from "./types";

// T-69 KNW wave1 Stage1(知の広場「これ?」重複防止検索) — ThreadSearchNode, reached
// via list node props.variant:"thread-search" (same in-scope trick as
// BoardThreadsNode's props.variant:"threads" — schema node type enum is
// C9-owned/out of scope, so this rides the existing `list` type).

afterEach(() => cleanup());

function screenDef(nodes: ScreenDef["nodes"]): ScreenDef {
  return { screen_id: "t", route: "/t", title: "t", nodes };
}

function searchNode(): ScreenDef["nodes"] {
  return [{ id: "search", type: "list", props: { variant: "thread-search", source_path: "/api/v1/plaza/search" } }];
}

function mockSearch(matches: Array<{ thread_id: string; topic: string; post_count: number; latest_at: string; score: number }>) {
  return vi.fn(async (a: Action) => {
    if (a.kind === "api" && a.path.startsWith("/api/v1/plaza/search")) {
      return { query: "コバエ", matches };
    }
    return undefined;
  });
}

describe("ThreadSearchNode — T-69 KNW wave1 Stage1", () => {
  it("shows no results and issues no fetch before the visitor types anything", async () => {
    const onAction = mockSearch([]);
    render(<Renderer onAction={onAction} def={screenDef(searchNode())} />);
    expect(screen.getByPlaceholderText("何に困ってる?")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 250));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByText(/まだ近いスレはありません/)).not.toBeInTheDocument();
  });

  it("debounces typing then fetches and shows up to 3 rows with topic, count, and last-updated", async () => {
    const onAction = mockSearch([
      { thread_id: "thr-1", topic: "コバエが大量発生した", post_count: 42, latest_at: "2026-07-16T00:00:00.000Z", score: 1010 },
      { thread_id: "thr-2", topic: "トビムシとコバエの見分け", post_count: 18, latest_at: "2026-07-13T00:00:00.000Z", score: 10 },
    ]);
    render(<Renderer onAction={onAction} def={screenDef(searchNode())} />);
    fireEvent.change(screen.getByPlaceholderText("何に困ってる?"), { target: { value: "コバエ" } });

    await waitFor(() => expect(screen.getByText("コバエが大量発生した")).toBeInTheDocument());
    expect(screen.getByText("トビムシとコバエの見分け")).toBeInTheDocument();
    expect(screen.getByText("42件のやりとり")).toBeInTheDocument();
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "api", method: "GET", path: "/api/v1/plaza/search?q=%E3%82%B3%E3%83%90%E3%82%A8" }),
    );
  });

  it("row anchor links to /s/knowledge-thread?thread_id=<id>", async () => {
    const onAction = mockSearch([{ thread_id: "thr-1", topic: "コバエが大量発生した", post_count: 42, latest_at: "2026-07-16T00:00:00.000Z", score: 1010 }]);
    render(<Renderer onAction={onAction} def={screenDef(searchNode())} />);
    fireEvent.change(screen.getByPlaceholderText("何に困ってる?"), { target: { value: "コバエ" } });
    const link = (await screen.findByText("コバエが大量発生した")).closest("a");
    expect(link).toHaveAttribute("href", "/s/knowledge-thread?thread_id=thr-1");
  });

  it("shows a calm honest empty state (not an error) when nothing matches", async () => {
    const onAction = mockSearch([]);
    render(<Renderer onAction={onAction} def={screenDef(searchNode())} />);
    fireEvent.change(screen.getByPlaceholderText("何に困ってる?"), { target: { value: "存在しない単語" } });
    await waitFor(() => expect(screen.getByText("まだ近いスレはありません。新しく相談できます。")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("always offers a new-post link to /s/knowledge-board", () => {
    render(<Renderer onAction={mockSearch([])} def={screenDef(searchNode())} />);
    const link = screen.getByText(/新しく相談する/).closest("a");
    expect(link).toHaveAttribute("href", "/s/knowledge-board");
  });
});
