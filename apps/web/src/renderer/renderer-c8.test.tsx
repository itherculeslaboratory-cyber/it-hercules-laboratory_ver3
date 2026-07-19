import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { Renderer } from "./renderer";
import type { Action, ScreenDef } from "./types";
import { loadScreenDef } from "@/lib/screendefs";

// c8 market-trade / knowledge-thread rebuild — renderer.test.tsx also covers
// this file's ground but currently fails to even load in this worktree (an
// unrelated ../../../../scripts/check-ui-tokens.mjs import SyntaxError —
// pre-existing environment issue, not touched by this change; see task
// report). This file is a standalone check with no .mjs import, so it can
// actually run: it exercises the 4 renderer primitives this round-16 rebuild
// added/changed (field textarea, table boolean-badge true/false labels,
// stepper current_from/current_map, tabs reactive default_tab) plus the new
// thread-posts dedicated node, plus a structural smoke render of the 3
// screen-defs this task touched.

afterEach(() => cleanup());

function screenDef(nodes: ScreenDef["nodes"]): ScreenDef {
  return { screen_id: "t", route: "/t", title: "t", nodes };
}

describe("FieldNode — textarea variant (c8 knowledge-thread reply/dispute bodies)", () => {
  it("renders a <textarea> sharing the .civ-input class, labelled and required", () => {
    render(
      <Renderer
        onAction={vi.fn()}
        def={screenDef([
          {
            id: "f",
            type: "form",
            action: { kind: "api", method: "POST", path: "/api/v1/x" },
            children: [
              { id: "body", type: "field", props: { name: "body", label: "本文", variant: "textarea", required: true } },
            ],
          },
        ])}
      />,
    );
    const el = screen.getByLabelText("本文 *") as HTMLTextAreaElement; // required field label appends " *"
    expect(el.tagName).toBe("TEXTAREA");
    expect(el).toHaveClass("civ-input");
    expect(el).toHaveAttribute("data-required", "true");
  });
});

describe("TableNode — badge cell boolean true_label/false_label (c8 Polis consensus/divisive)", () => {
  it("shows Japanese copy instead of the raw true/false string", () => {
    const onAction = vi.fn(async () => ({
      statements: [{ statement_id: "p1", agree: 4, disagree: 1, pass: 0, consensus: true, divisive: false }],
    }));
    render(
      <Renderer
        onAction={onAction}
        def={screenDef([
          {
            id: "consensus-table",
            type: "table",
            props: {
              source_path: "/api/v1/x",
              bind_items: "data.consensus-table.statements",
              columns: [
                { key: "consensus", label: "合意", cell: "badge", tone: "success", true_label: "✔ 合意", false_label: "—" },
                { key: "divisive", label: "対立", cell: "badge", tone: "caution", true_label: "⚠ 対立", false_label: "—" },
              ],
            },
          },
        ])}
      />,
    );
    return waitFor(() => {
      expect(screen.getByText("✔ 合意")).toBeInTheDocument();
      // divisive:false renders the false_label, not the literal string "false".
      expect(screen.queryByText("false")).not.toBeInTheDocument();
    });
  });
});

describe("StepperNode — current_from/current_map (c8 market-trade 4-stage over N backend states)", () => {
  it("derives the visible step from a raw fetched state string via the map", async () => {
    const onAction = vi.fn(async () => ({ state: "shipped", stage: 2 }));
    render(
      <Renderer
        onAction={onAction}
        def={screenDef([
          { id: "state", type: "card", props: { source_path: "/api/v1/x", bind_text: "{{state}}" } },
          {
            id: "stepper",
            type: "stepper",
            props: {
              steps: [{ id: 0, label: "出品" }, { id: 1, label: "成立" }, { id: 2, label: "発送・受取" }, { id: 3, label: "完了" }],
              current_from: "{{data.state.state}}",
              current_map: { unlisted: 0, matched: 1, shipped: 2, received: 2, sold: 3 },
            },
          },
        ])}
      />,
    );
    await waitFor(() => expect(screen.getByText("発送・受取").closest("li")).toHaveAttribute("data-state", "current"));
    expect(screen.getByText("成立").closest("li")).toHaveAttribute("data-state", "done");
    expect(screen.getByText("完了").closest("li")).toHaveAttribute("data-state", "upcoming");
  });
});

describe("TabsNode — default_tab scope template + reactive re-sync (c8)", () => {
  it("auto-selects the tab matching async-fetched data once it arrives, without hiding the other tab", async () => {
    const onAction = vi.fn(async () => ({ stage: 2 }));
    render(
      <Renderer
        onAction={onAction}
        def={screenDef([
          { id: "state", type: "card", props: { source_path: "/api/v1/x", bind_text: "{{stage}}" } },
          {
            id: "tabs",
            type: "tabs",
            props: { tabs: [{ id: "1", label: "公開情報" }, { id: "2", label: "取引ボード" }], default_tab: "{{data.state.stage}}" },
            children: [
              { id: "pane1", type: "text", props: { tab_id: "1", text: "公開情報の中身" } },
              { id: "pane2", type: "text", props: { tab_id: "2", text: "取引ボードの中身" } },
            ],
          },
        ])}
      />,
    );
    // pre-fetch: falls back to tabs[0] ("1")
    expect(screen.getByText("公開情報の中身")).toBeInTheDocument();
    // once stage:2 resolves, the panel re-syncs to "2" — but the tab button
    // for "1" is still present (switching, not hiding, per the c8 "when"-gap note).
    await waitFor(() => expect(screen.getByText("取引ボードの中身")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "公開情報" })).toBeInTheDocument();
  });
});

describe("ThreadPostsNode — c8 knowledge-thread dedicated node", () => {
  function mockThread(overrides?: Partial<{ tags: string[] }>) {
    return vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.path === "/api/v1/plaza/threads/thr-1") {
        return {
          thread_id: "thr-1",
          channel: "knowledge-board",
          topic: "T",
          posts: [
            {
              post_id: "p1",
              actor_id: "root-user",
              channel: "knowledge-board",
              topic: "T",
              board_kind: "improvement",
              body: "根投稿の本文",
              created_at: "2026-07-17T00:00:00.000Z",
              cite_refs: [{ type: "observation", id: "obs-1" }],
              tags: overrides?.tags ?? [],
            },
            {
              post_id: "p2",
              actor_id: "zed-user",
              channel: "knowledge-board",
              topic: "T",
              board_kind: "improvement",
              body: "返信の本文",
              created_at: "2026-07-17T01:00:00.000Z",
              reply_to: "p1",
            },
          ],
          tombstones: [{ ref: { type: "observation", id: "obs-1" }, reason: "target_missing" }],
        };
      }
      if (a.kind === "api" && a.path === "/api/v1/me/profile") return { actor_id: "root-user" };
      return undefined;
    });
  }

  it("renders both post bodies, an avatar monogram, and a tombstoned cite badge as invalid", async () => {
    render(
      <Renderer onAction={mockThread()} params={{ thread_id: "thr-1" }} def={screenDef([{ id: "posts", type: "thread-posts", props: {} }])} />,
    );
    expect(await screen.findByText("根投稿の本文")).toBeInTheDocument();
    expect(screen.getByText("返信の本文")).toBeInTheDocument();
    // c9 wave1 KNW Slice2: reply_to renders the parent post's own body excerpt,
    // never the raw post_id ULID.
    expect(screen.getByText("↩ 「根投稿の本文」への返信")).toBeInTheDocument();
    expect(screen.queryByText(">>p1")).not.toBeInTheDocument();
    expect(screen.getByText("R")).toBeInTheDocument(); // monogram of "root-user"
    expect(screen.getByText("Z")).toBeInTheDocument(); // monogram of "zed-user"
    expect(screen.getByText(/observation: obs-1（無効）/)).toBeInTheDocument();
  });

  it("shows the resolve toggle only when the viewer IS the thread starter (round-16 OQ-PLZ-03)", async () => {
    render(
      <Renderer onAction={mockThread()} params={{ thread_id: "thr-1" }} def={screenDef([{ id: "posts", type: "thread-posts", props: {} }])} />,
    );
    expect(await screen.findByText("根投稿の本文")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "✔ 解決済みにする" })).toBeInTheDocument();
  });

  it("hides the resolve toggle for a non-starter viewer", async () => {
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.path === "/api/v1/plaza/threads/thr-1") {
        return {
          thread_id: "thr-1",
          channel: "c",
          topic: "T",
          posts: [{ post_id: "p1", actor_id: "root-user", channel: "c", topic: "T", board_kind: "guide", body: "本文", created_at: "2026-07-17T00:00:00.000Z" }],
        };
      }
      if (a.kind === "api" && a.path === "/api/v1/me/profile") return { actor_id: "actor-someone-else" };
      return undefined;
    });
    render(<Renderer onAction={onAction} params={{ thread_id: "thr-1" }} def={screenDef([{ id: "posts", type: "thread-posts", props: {} }])} />);
    expect(await screen.findByText("本文")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "✔ 解決済みにする" })).not.toBeInTheDocument();
  });

  it("new thread with no resolve-tagged post shows 未解決", async () => {
    render(<Renderer onAction={mockThread()} params={{ thread_id: "thr-1" }} def={screenDef([{ id: "posts", type: "thread-posts", props: {} }])} />);
    await screen.findByText("根投稿の本文");
    expect(screen.getByText("未解決")).toBeInTheDocument();
  });

  it("a thread with a resolved-tagged post shows ✔ 解決済み and the revert action for the starter", async () => {
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.path === "/api/v1/plaza/threads/thr-1") {
        return {
          thread_id: "thr-1",
          channel: "c",
          topic: "T",
          posts: [
            { post_id: "p1", actor_id: "root-user", channel: "c", topic: "T", board_kind: "guide", body: "根投稿", created_at: "2026-07-17T00:00:00.000Z" },
            { post_id: "p2", actor_id: "root-user", channel: "c", topic: "T", board_kind: "guide", body: "解決済みにしました", created_at: "2026-07-17T02:00:00.000Z", tags: ["resolved"] },
          ],
        };
      }
      if (a.kind === "api" && a.path === "/api/v1/me/profile") return { actor_id: "root-user" };
      return undefined;
    });
    render(<Renderer onAction={onAction} params={{ thread_id: "thr-1" }} def={screenDef([{ id: "posts", type: "thread-posts", props: {} }])} />);
    await screen.findByText("根投稿");
    expect(screen.getByText("✔ 解決済み")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "解決を取り消す" })).toBeInTheDocument();
  });
});

describe("c8 screen-defs — structural smoke (renderer.test.tsx's whole-catalog sweep cannot load in this worktree; see file header)", () => {
  it("renders market-trade.json, knowledge-thread.json, dispute.json without throwing", () => {
    const onAction = vi.fn(async () => ({}));
    for (const id of ["market-trade", "knowledge-thread", "dispute"]) {
      const { unmount } = render(<Renderer def={loadScreenDef(id)} onAction={onAction} />);
      expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
      unmount();
    }
  });
});
