import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { Renderer } from "./renderer";
import type { Action, ScreenDef } from "./types";

// T-70 KNW wave1(知の広場ハブ — 承認モックアップの verbatim 採用) — KnowledgeHubNode,
// reached via list node props.variant:"knowledge-hub" (same in-scope trick as
// BoardThreadsNode's props.variant:"threads" — schema node type enum is
// C9-owned/out of scope, so this rides the existing `list` type). Replaces the
// earlier "thread-search" variant test.

afterEach(() => cleanup());

function screenDef(nodes: ScreenDef["nodes"]): ScreenDef {
  return { screen_id: "t", route: "/t", title: "t", nodes };
}

function hubNode(): ScreenDef["nodes"] {
  return [{ id: "hub", type: "list", props: { variant: "knowledge-hub", source_path: "/api/v1/plaza/search" } }];
}

function mockSearch(matches: Array<{ thread_id: string; topic: string; post_count: number; latest_at: string; score: number; resolved?: boolean }>) {
  return vi.fn(async (a: Action) => {
    if (a.kind === "api" && a.path.startsWith("/api/v1/plaza/search")) {
      return { query: "コバエ", matches };
    }
    return undefined;
  });
}

describe("KnowledgeHubNode — T-70 KNW wave1 (mockup verbatim adoption)", () => {
  it("renders the 3-tab pill nav with 困った active by default, and the search box + default helper", () => {
    render(<Renderer onAction={mockSearch([])} def={screenDef(hubNode())} />);
    expect(screen.getByText("知の広場")).toBeInTheDocument();
    const komatta = screen.getByRole("button", { name: "困った" });
    const hanashitai = screen.getByRole("button", { name: "話したい" });
    const ronbun = screen.getByRole("button", { name: "論文" });
    expect(komatta).toHaveClass("active");
    expect(hanashitai).not.toHaveClass("active");
    expect(ronbun).not.toHaveClass("active");
    expect(screen.getByPlaceholderText("何に困ってる?")).toBeInTheDocument();
    expect(screen.getByText("当てはまるものがあれば、そこへ流れ着く → 情報が1か所に集まる")).toBeInTheDocument();
  });

  it("issues no fetch before the visitor types anything", async () => {
    const onAction = mockSearch([]);
    render(<Renderer onAction={onAction} def={screenDef(hubNode())} />);
    await new Promise((r) => setTimeout(r, 250));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByText(/まだ近いスレはありません/)).not.toBeInTheDocument();
  });

  it("debounces typing then fetches and shows up to 3 rows with topic + meta line", async () => {
    const onAction = mockSearch([
      { thread_id: "thr-1", topic: "コバエが大量発生した", post_count: 42, latest_at: "2026-07-16T00:00:00.000Z", score: 1010 },
      { thread_id: "thr-2", topic: "トビムシとコバエの見分け", post_count: 18, latest_at: "2026-07-13T00:00:00.000Z", score: 10 },
    ]);
    render(<Renderer onAction={onAction} def={screenDef(hubNode())} />);
    fireEvent.change(screen.getByPlaceholderText("何に困ってる?"), { target: { value: "コバエ" } });

    await waitFor(() => expect(screen.getByText("コバエが大量発生した")).toBeInTheDocument());
    expect(screen.getByText("トビムシとコバエの見分け")).toBeInTheDocument();
    expect(screen.getByText(/42件のやりとり/)).toBeInTheDocument();
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "api", method: "GET", path: "/api/v1/plaza/search?q=%E3%82%B3%E3%83%90%E3%82%A8" }),
    );
  });

  it("row anchor links to /s/knowledge-thread?thread_id=<id> with a chevron", async () => {
    const onAction = mockSearch([{ thread_id: "thr-1", topic: "コバエが大量発生した", post_count: 42, latest_at: "2026-07-16T00:00:00.000Z", score: 1010 }]);
    render(<Renderer onAction={onAction} def={screenDef(hubNode())} />);
    fireEvent.change(screen.getByPlaceholderText("何に困ってる?"), { target: { value: "コバエ" } });
    const link = (await screen.findByText("コバエが大量発生した")).closest("a");
    expect(link).toHaveAttribute("href", "/s/knowledge-thread?thread_id=thr-1");
    expect(link?.querySelector(".go")?.textContent).toBe("›");
  });

  it("shows the ✔解決済み badge only when resolved:true, not when false or absent", async () => {
    const onAction = mockSearch([
      { thread_id: "thr-1", topic: "解決済みスレ", post_count: 5, latest_at: "2026-07-16T00:00:00.000Z", score: 1000, resolved: true },
      { thread_id: "thr-2", topic: "未解決スレ", post_count: 3, latest_at: "2026-07-15T00:00:00.000Z", score: 900, resolved: false },
      { thread_id: "thr-3", topic: "資格なしスレ", post_count: 2, latest_at: "2026-07-14T00:00:00.000Z", score: 800 },
    ]);
    render(<Renderer onAction={onAction} def={screenDef(hubNode())} />);
    fireEvent.change(screen.getByPlaceholderText("何に困ってる?"), { target: { value: "コバエ" } });
    await waitFor(() => expect(screen.getByText("解決済みスレ")).toBeInTheDocument());
    const badges = screen.getAllByText("✔解決済みの答えあり");
    expect(badges).toHaveLength(1);
    expect(badges[0].closest(".suggest-row")?.textContent).toContain("解決済みスレ");
  });

  it("shows a calm honest empty state (not an error) when nothing matches", async () => {
    const onAction = mockSearch([]);
    render(<Renderer onAction={onAction} def={screenDef(hubNode())} />);
    fireEvent.change(screen.getByPlaceholderText("何に困ってる?"), { target: { value: "存在しない単語" } });
    await waitFor(() => expect(screen.getByText("まだ近いスレはありません。新しく相談できます。")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("新しく相談する reveals the compose title field instead of navigating away", () => {
    render(<Renderer onAction={mockSearch([])} def={screenDef(hubNode())} />);
    expect(screen.queryByPlaceholderText("相談したいことを入力")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("新しく相談する"));
    expect(screen.getByPlaceholderText("相談したいことを入力")).toBeInTheDocument();
  });

  it("話したい tab shows a lead line + a card linking to 公式掲示板", () => {
    render(<Renderer onAction={mockSearch([])} def={screenDef(hubNode())} />);
    fireEvent.click(screen.getByRole("button", { name: "話したい" }));
    expect(screen.getByText("同じ趣味の人と交流する。")).toBeInTheDocument();
    const link = screen.getByText("公式掲示板").closest("a");
    expect(link).toHaveAttribute("href", "/s/knowledge-board");
    expect(screen.queryByPlaceholderText("何に困ってる?")).not.toBeInTheDocument();
  });

  it("論文 tab shows a lead line + a card linking to 論文", () => {
    render(<Renderer onAction={mockSearch([])} def={screenDef(hubNode())} />);
    fireEvent.click(screen.getByRole("button", { name: "論文" }));
    expect(screen.getByText("論文を読む・書く・議論する。")).toBeInTheDocument();
    const link = screen.getByText("論文", { selector: "h2" }).closest("a");
    expect(link).toHaveAttribute("href", "/s/knowledge-paper");
  });
});
