import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { Renderer, titleSimilarity } from "./renderer";
import type { Action, ScreenDef } from "./types";

// T-72 KNW wave1(新規スレ重複確認 — 承認モックアップ section2 の verbatim 採用) —
// "新しく相談する" now reveals a `.compose-title-field` (KnowledgeHubNode, same
// props.variant:"knowledge-hub" in-scope trick as T-70). Debounced GET
// /plaza/search drives a deterministic (no LLM/embedding) similarity % against
// the top match's topic; >=KNW_DUP_THRESHOLD renders `.dup-banner` (open
// existing / create new), otherwise a plain create button.
//
// フォローアップ(同一定義への統一): titleSimilarity は当初、文字集合オーバー
// ラップ係数(独自定義)だったが、rankThreadSearch(plaza-routes.ts)へ文字bigram
// Dice類似度のファジー加点を追加した際、「バックエンドは一致扱いなのにフロント
// の別指標が閾値未満でバナー不発」という実バグが実機E2Eで発覚した。titleSimilarity
// を plaza-routes.ts の diceCoefficient と同一アルゴリズムへ統一し、
// KNW_DUP_THRESHOLD も 70→20 に調整(dice のスケールは文字集合オーバーラップより
// ずっと低い値を取るため)。

afterEach(() => cleanup());

function screenDef(): ScreenDef {
  return { screen_id: "t", route: "/t", title: "t", nodes: [{ id: "hub", type: "list", props: { variant: "knowledge-hub", source_path: "/api/v1/plaza/search" } }] };
}

function openCompose() {
  fireEvent.click(screen.getByText("新しく相談する"));
  return screen.getByPlaceholderText("相談したいことを入力");
}

describe("titleSimilarity — deterministic bigram-Dice % (no LLM, matches plaza-routes.ts diceCoefficient)", () => {
  it("scores the seeded コバエ demo pair (round1 例文)", () => {
    const pct = titleSimilarity("コバエがわいた", "コバエが大量発生した — 対策まとめ");
    expect(pct).toBe(29);
  });

  it("scores a non-substring realistic paraphrase (round2 例文・実測 dice=0.2308)", () => {
    const pct = titleSimilarity("コバエがわいた時どうする", "コバエが大量発生した — 対策まとめ");
    expect(pct).toBe(23);
    expect(pct).toBeGreaterThanOrEqual(20);
  });

  it("scores an unrelated pair at 0%", () => {
    const pct = titleSimilarity("梱包のコツ", "コバエが大量発生した — 対策まとめ");
    expect(pct).toBe(0);
  });

  it("is symmetric-ish and deterministic (same input -> same output)", () => {
    expect(titleSimilarity("同じ文字列", "同じ文字列")).toBe(100);
    expect(titleSimilarity("a", "a")).toBe(titleSimilarity("a", "a"));
  });
});

describe("KnowledgeHubNode dup-confirm compose — T-72 KNW wave1", () => {
  it("新しく相談する reveals the compose field with no banner until a close match appears", async () => {
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.path.startsWith("/api/v1/plaza/search")) return { query: "", matches: [] };
      return undefined;
    });
    render(<Renderer onAction={onAction} def={screenDef()} onNavigate={vi.fn()} />);
    const input = openCompose();
    fireEvent.change(input, { target: { value: "梱包のコツ" } });
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByText(/これに近い相談があります/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この内容で相談を始める" })).toBeInTheDocument();
  });

  it("shows .dup-banner with the matched TITLE (no percentage) once a close match is found", async () => {
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.path.startsWith("/api/v1/plaza/search")) {
        return {
          query: "コバエがわいた",
          matches: [
            { thread_id: "thr-1", topic: "コバエが大量発生した — 対策まとめ", post_count: 42, latest_at: "2026-07-16T00:00:00.000Z", score: 1010, resolved: false },
          ],
        };
      }
      return undefined;
    });
    render(<Renderer onAction={onAction} def={screenDef()} onNavigate={vi.fn()} />);
    const input = openCompose();
    fireEvent.change(input, { target: { value: "コバエがわいた" } });

    await waitFor(() => expect(screen.getByText(/これに近い相談があります/)).toBeInTheDocument());
    const banner = screen.getByText(/これに近い相談があります/).closest(".dup-banner") as HTMLElement;
    expect(within(banner).getByText("コバエが大量発生した — 対策まとめ").closest(".dm b")).toBeInTheDocument();
    // R94 follow-up (user ruling DUP-PCT=○): no percentage anywhere in the banner —
    // title-only confirmation, no fake-precision number.
    expect(banner.textContent).not.toMatch(/%/);
    expect(banner.textContent).not.toContain("一致度");
    expect(screen.getByRole("button", { name: "これだ・開く" })).toHaveClass("btn", "primary");
    expect(screen.getByRole("button", { name: "全然違う・新規で作る" })).toHaveClass("btn", "ghost");
  });

  it("'これだ・開く' navigates to the matched thread without posting anything", async () => {
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.path.startsWith("/api/v1/plaza/search")) {
        return { query: "x", matches: [{ thread_id: "thr-1", topic: "コバエが大量発生した — 対策まとめ", post_count: 42, latest_at: "2026-07-16T00:00:00.000Z", score: 1010 }] };
      }
      return undefined;
    });
    const onNavigate = vi.fn();
    render(<Renderer onAction={onAction} def={screenDef()} onNavigate={onNavigate} />);
    const input = openCompose();
    fireEvent.change(input, { target: { value: "コバエがわいた" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "これだ・開く" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "これだ・開く" }));

    expect(onNavigate).toHaveBeenCalledWith("knowledge-thread", { thread_id: "thr-1" });
    expect(onAction).not.toHaveBeenCalledWith(expect.objectContaining({ method: "POST" }), expect.anything());
  });

  it("'全然違う・新規で作る' POSTs a new thread with the board defaults, then navigates to it", async () => {
    const posted: Record<string, unknown>[] = [];
    const onAction = vi.fn(async (a: Action, body?: Record<string, unknown>) => {
      if (a.kind === "api" && a.method === "GET" && a.path.startsWith("/api/v1/plaza/search")) {
        return { query: "x", matches: [{ thread_id: "thr-1", topic: "コバエが大量発生した — 対策まとめ", post_count: 42, latest_at: "2026-07-16T00:00:00.000Z", score: 1010 }] };
      }
      if (a.kind === "api" && a.method === "POST" && a.path === "/api/v1/plaza/posts") {
        posted.push(body ?? {});
        return { post_id: "new-post", thread_id: "thr-new" };
      }
      return undefined;
    });
    const onNavigate = vi.fn();
    render(<Renderer onAction={onAction} def={screenDef()} onNavigate={onNavigate} />);
    const input = openCompose();
    fireEvent.change(input, { target: { value: "コバエがわいた" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "全然違う・新規で作る" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "全然違う・新規で作る" }));

    await waitFor(() =>
      expect(posted).toContainEqual({ channel: "knowledge-board", board_kind: "guide", topic: "コバエがわいた", body: "コバエがわいた" }),
    );
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("knowledge-thread", { thread_id: "thr-new" }));
  });

  it("with no close match, the plain create button POSTs + navigates (no banner ever shown)", async () => {
    const posted: Record<string, unknown>[] = [];
    const onAction = vi.fn(async (a: Action, body?: Record<string, unknown>) => {
      if (a.kind === "api" && a.method === "GET" && a.path.startsWith("/api/v1/plaza/search")) return { query: "x", matches: [] };
      if (a.kind === "api" && a.method === "POST" && a.path === "/api/v1/plaza/posts") {
        posted.push(body ?? {});
        return { post_id: "new-post", thread_id: "thr-new" };
      }
      return undefined;
    });
    const onNavigate = vi.fn();
    render(<Renderer onAction={onAction} def={screenDef()} onNavigate={onNavigate} />);
    const input = openCompose();
    fireEvent.change(input, { target: { value: "梱包のコツ" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "この内容で相談を始める" })).toBeInTheDocument());
    expect(screen.queryByText(/これに近い相談があります/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "この内容で相談を始める" }));

    await waitFor(() =>
      expect(posted).toContainEqual({ channel: "knowledge-board", board_kind: "guide", topic: "梱包のコツ", body: "梱包のコツ" }),
    );
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("knowledge-thread", { thread_id: "thr-new" }));
  });

  it("the plain create button stays disabled while the title is empty", () => {
    const onAction = vi.fn(async () => ({ query: "", matches: [] }));
    render(<Renderer onAction={onAction} def={screenDef()} onNavigate={vi.fn()} />);
    openCompose();
    expect(screen.getByRole("button", { name: "この内容で相談を始める" })).toBeDisabled();
  });
});
