import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { Renderer } from "./renderer";
import type { Action, ScreenDef } from "./types";

// c9 wave1 KNW Slice1(公式掲示板を探せる板にする) — BoardThreadsNode, reached
// via list node props.variant:"threads" (schemas/ node type enum is C9-owned/
// out of scope, so this rides the existing `list` type instead of adding one —
// same convention as FieldNode's props.variant). Replaces the old generic
// `list` item_text ("{{topic}}（{{board_kind}} / {{post_count}}）" — raw
// English board_kind, unlabeled count) + the always-empty "スレッドを開く" link.

afterEach(() => cleanup());

function screenDef(nodes: ScreenDef["nodes"]): ScreenDef {
  return { screen_id: "t", route: "/t", title: "t", nodes };
}

function mockThreads() {
  return vi.fn(async (a: Action) => {
    if (a.kind === "api" && a.path === "/api/v1/plaza/channels/knowledge-board/threads") {
      return {
        channel: "knowledge-board",
        threads: [
          { thread_id: "thr-1", topic: "改善スレ", board_kind: "improvement", post_count: 3, latest_at: "2026-07-17T00:00:00.000Z" },
          { thread_id: "thr-2", topic: "説明スレ", board_kind: "guide", post_count: 1, latest_at: "2026-07-16T00:00:00.000Z" },
        ],
        boards: {},
      };
    }
    return undefined;
  });
}

describe("BoardThreadsNode — c9 wave1 KNW Slice1", () => {
  it("renders one row per thread with topic, post count, and last-updated", async () => {
    render(<Renderer onAction={mockThreads()} def={screenDef([{ id: "threads", type: "list", props: { variant: "threads" } }])} />);
    expect(await screen.findByText("改善スレ")).toBeInTheDocument();
    expect(screen.getByText("説明スレ")).toBeInTheDocument();
    expect(screen.getByText("3件の投稿")).toBeInTheDocument();
    expect(screen.getByText("1件の投稿")).toBeInTheDocument();
    expect(screen.getAllByText(/^最終更新 /).length).toBe(2);
  });

  it("renders board_kind in Japanese, never the raw English kind", async () => {
    render(<Renderer onAction={mockThreads()} def={screenDef([{ id: "threads", type: "list", props: { variant: "threads" } }])} />);
    await screen.findByText("改善スレ");
    // "改善"/"説明" each appear twice: once as a filter chip, once as the row's board tag.
    expect(screen.getAllByText("改善").length).toBe(2);
    expect(screen.getAllByText("説明").length).toBe(2);
    expect(screen.queryByText("improvement")).not.toBeInTheDocument();
    expect(screen.queryByText("guide")).not.toBeInTheDocument();
  });

  it("row anchor links to /s/knowledge-thread?thread_id=<id>", async () => {
    render(<Renderer onAction={mockThreads()} def={screenDef([{ id: "threads", type: "list", props: { variant: "threads" } }])} />);
    const link = (await screen.findByText("改善スレ")).closest("a");
    expect(link).toHaveAttribute("href", "/s/knowledge-thread?thread_id=thr-1");
  });

  it("clicking a filter chip narrows the list to that board_kind", async () => {
    render(<Renderer onAction={mockThreads()} def={screenDef([{ id: "threads", type: "list", props: { variant: "threads" } }])} />);
    await screen.findByText("改善スレ");
    fireEvent.click(screen.getByRole("button", { name: "説明" }));
    expect(screen.getByText("説明スレ")).toBeInTheDocument();
    expect(screen.queryByText("改善スレ")).not.toBeInTheDocument();
  });

  it("shows an honest empty state when the active filter matches nothing", async () => {
    render(<Renderer onAction={mockThreads()} def={screenDef([{ id: "threads", type: "list", props: { variant: "threads" } }])} />);
    await screen.findByText("改善スレ");
    fireEvent.click(screen.getByRole("button", { name: "愚痴" }));
    await waitFor(() => expect(screen.getByText("この板にはまだスレッドがありません。")).toBeInTheDocument());
  });
});
