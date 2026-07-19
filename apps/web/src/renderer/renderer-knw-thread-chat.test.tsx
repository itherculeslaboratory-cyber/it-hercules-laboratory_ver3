import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { Renderer } from "./renderer";
import type { Action, ScreenDef } from "./types";

// T-71 KNW wave1(スレッド=みんなのグループチャット — 承認モックアップ section3
// の verbatim 採用) — KnowledgeThreadChatNode, reached via list node
// props.variant:"knowledge-thread-chat" (same in-scope trick as
// BoardThreadsNode's props.variant:"threads"/KnowledgeHubNode's
// props.variant:"knowledge-hub" — schema node type enum is C9-owned/out of
// scope). Replaces the removed 賛否/Polis/解決マーク UI's renderer test
// surface for this screen (that UI + its ThreadPostsNode tests are left
// in place elsewhere — R94 proposal-based removal is scoped to the
// knowledge-thread screen-def, not the shared node/tests).

afterEach(() => cleanup());

function screenDef(): ScreenDef {
  return {
    screen_id: "t",
    route: "/t",
    title: "t",
    nodes: [{ id: "chat", type: "list", props: { variant: "knowledge-thread-chat", source_path: "/api/v1/plaza/threads" } }],
  };
}

type MockPost = {
  post_id: string;
  actor_id: string;
  channel: string;
  topic: string;
  board_kind: string;
  body: string;
  created_at: string;
  schema_version: string;
};

function mockThread(threadId: string, topic: string, posts: MockPost[]) {
  return { thread_id: threadId, channel: "knowledge-board", topic, posts, tombstones: [] };
}

function mockAction(opts: {
  threadId: string;
  view: ReturnType<typeof mockThread> | null;
  viewerId: string;
  onPost?: (body: Record<string, unknown>) => void;
}) {
  return vi.fn(async (a: Action, body?: Record<string, unknown>) => {
    if (a.kind === "api" && a.method === "GET" && a.path === `/api/v1/plaza/threads/${opts.threadId}`) {
      return opts.view;
    }
    if (a.kind === "api" && a.method === "GET" && a.path === "/api/v1/me/profile") {
      return { actor_id: opts.viewerId };
    }
    if (a.kind === "api" && a.method === "GET" && a.path.startsWith("/api/v1/users/")) {
      return { display_name: null };
    }
    if (a.kind === "api" && a.method === "POST" && a.path === "/api/v1/plaza/posts") {
      opts.onPost?.(body ?? {});
      return { post_id: "new-post", thread_id: opts.threadId };
    }
    return undefined;
  });
}

describe("KnowledgeThreadChatNode — T-71 KNW wave1 (mockup section3 verbatim adoption)", () => {
  it("renders the thread topic + each post as a chat bubble, own post gets .msg.me, others don't", async () => {
    const view = mockThread("thr-1", "最適温度は何℃?(ヘラクレス・幼虫)", [
      {
        post_id: "p1",
        actor_id: "actor-me",
        channel: "knowledge-board",
        topic: "最適温度は何℃?(ヘラクレス・幼虫)",
        board_kind: "guide",
        body: "わたしの投稿です",
        created_at: "2026-07-18T01:02:00.000Z",
        schema_version: "1",
      },
      {
        post_id: "p2",
        actor_id: "actor-other",
        channel: "knowledge-board",
        topic: "最適温度は何℃?(ヘラクレス・幼虫)",
        board_kind: "guide",
        body: "他の人の投稿です",
        created_at: "2026-07-18T01:05:00.000Z",
        schema_version: "1",
      },
    ]);
    const onAction = mockAction({ threadId: "thr-1", view, viewerId: "actor-me" });
    render(<Renderer onAction={onAction} def={screenDef()} params={{ thread_id: "thr-1" }} />);

    await waitFor(() => expect(screen.getByText("最適温度は何℃?(ヘラクレス・幼虫)")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "最適温度は何℃?(ヘラクレス・幼虫)" })).toBeInTheDocument();

    const mine = screen.getByText("わたしの投稿です").closest(".msg");
    const theirs = screen.getByText("他の人の投稿です").closest(".msg");
    expect(mine).toHaveClass("me");
    expect(theirs).not.toHaveClass("me");

    // own post shows literally "あなた" (mockup section3's .msg.me demo) — not
    // the viewer's own raw actor_id/ActorLabel lookup (owner report: ID leak).
    expect(mine?.textContent).toContain("あなた");
    expect(mine?.textContent).not.toContain("actor-me");
    expect(mine?.querySelector(".avatar")?.textContent).toBe("あ");
  });

  it("omits ctx-chips/.ctx-note entirely — no real breeding-context field exists on a plaza post (誇張ゼロ)", async () => {
    const view = mockThread("thr-1", "話題", [
      {
        post_id: "p1",
        actor_id: "actor-me",
        channel: "knowledge-board",
        topic: "話題",
        board_kind: "guide",
        body: "本文",
        created_at: "2026-07-18T01:02:00.000Z",
        schema_version: "1",
      },
    ]);
    const onAction = mockAction({ threadId: "thr-1", view, viewerId: "actor-me" });
    const { container } = render(<Renderer onAction={onAction} def={screenDef()} params={{ thread_id: "thr-1" }} />);

    await waitFor(() => expect(screen.getByText("本文")).toBeInTheDocument());
    expect(container.querySelector(".ctx-chips")).not.toBeInTheDocument();
    expect(container.querySelector(".chip")).not.toBeInTheDocument();
    expect(container.querySelector(".ctx-note")).not.toBeInTheDocument();
  });

  it("shows an honest empty state (not an error) when the thread has no posts yet", async () => {
    const view = mockThread("thr-1", "まだ誰も話していない", []);
    const onAction = mockAction({ threadId: "thr-1", view, viewerId: "actor-me" });
    render(<Renderer onAction={onAction} def={screenDef()} params={{ thread_id: "thr-1" }} />);

    await waitFor(() => expect(screen.getByText("まだ投稿がありません。最初のメッセージを送ってみましょう。")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("send button POSTs /plaza/posts with the thread's channel/topic/board_kind + typed body, then clears the input", async () => {
    const view = mockThread("thr-1", "話題", [
      {
        post_id: "p1",
        actor_id: "actor-other",
        channel: "knowledge-board",
        topic: "話題",
        board_kind: "guide",
        body: "先に一件",
        created_at: "2026-07-18T01:02:00.000Z",
        schema_version: "1",
      },
    ]);
    const posted: Record<string, unknown>[] = [];
    const onAction = mockAction({ threadId: "thr-1", view, viewerId: "actor-me", onPost: (b) => posted.push(b) });
    render(<Renderer onAction={onAction} def={screenDef()} params={{ thread_id: "thr-1" }} />);

    await waitFor(() => expect(screen.getByText("先に一件")).toBeInTheDocument());
    const input = screen.getByPlaceholderText("メッセージを送る…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "新しいメッセージ" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() =>
      expect(posted).toContainEqual(
        expect.objectContaining({
          channel: "knowledge-board",
          topic: "話題",
          board_kind: "guide",
          thread_id: "thr-1",
          body: "新しいメッセージ",
        }),
      ),
    );
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("does not allow sending an empty/whitespace-only message", async () => {
    const view = mockThread("thr-1", "話題", []);
    const onAction = mockAction({ threadId: "thr-1", view, viewerId: "actor-me" });
    render(<Renderer onAction={onAction} def={screenDef()} params={{ thread_id: "thr-1" }} />);
    await waitFor(() => expect(screen.getByText("まだ投稿がありません。最初のメッセージを送ってみましょう。")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  });
});
