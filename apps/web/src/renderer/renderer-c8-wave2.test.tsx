import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { Renderer } from "./renderer";
import type { Action, ScreenDef } from "./types";

// c8 UI磨き第2弾(受領10「60点評価」7項目) — this file covers the renderer
// primitives added for that wave: `when`(role出し分け・#1)/actor 表示プリミティブ
// (#5, table "actor" cell + list item_actor_field)/data-label markup contract
// for the <=560px table card-mode CSS(#7)/image-grid item_href+placeholder
// (#2)/KebabMenu(#3)/per-post stance vote buttons(#6, ThreadPostsNode 側は
// renderer-c8.test.tsx の隣接ファイル)。#7 の実際の <=560px 折返しは CSS のみ
// (globals.css)なので jsdom の viewport 非依存テストでは検証していない
// (markup 側の data-label 属性の存在のみ確認)。

afterEach(() => cleanup());

function screenDef(nodes: ScreenDef["nodes"]): ScreenDef {
  return { screen_id: "t", route: "/t", title: "t", nodes };
}

describe("`when` primitive (c8磨き第2弾#1 — 受領10「買い手/売り手のみ表示」)", () => {
  it("renders a node when eq matches, hides it when it doesn't", () => {
    render(
      <Renderer
        onAction={vi.fn()}
        def={screenDef([
          { id: "shown", type: "text", props: { text: "match", when: { eq: ["a", "a"] } } },
          { id: "hidden", type: "text", props: { text: "no-match", when: { eq: ["a", "b"] } } },
        ])}
      />,
    );
    expect(screen.getByText("match")).toBeInTheDocument();
    expect(screen.queryByText("no-match")).not.toBeInTheDocument();
  });

  it("two templates that BOTH resolve empty do not count as a match (viewer not yet fetched)", () => {
    render(
      <Renderer
        onAction={vi.fn()}
        def={screenDef([{ id: "n", type: "text", props: { text: "x", when: { eq: ["{{viewer.actor_id}}", "{{data.nothing.here}}"] } } }])}
      />,
    );
    expect(screen.queryByText("x")).not.toBeInTheDocument();
  });

  it("fetches /api/v1/me/profile only when a node on screen carries `when`, and compares against it", async () => {
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.path === "/api/v1/me/profile") return { actor_id: "buyer-1" };
      return undefined;
    });
    render(
      <Renderer
        onAction={onAction}
        def={screenDef([
          { id: "buyer-only", type: "text", props: { text: "buyer view", when: { eq: ["{{viewer.actor_id}}", "buyer-1"] } } },
          { id: "seller-only", type: "text", props: { text: "seller view", when: { eq: ["{{viewer.actor_id}}", "seller-1"] } } },
        ])}
      />,
    );
    await waitFor(() => expect(screen.getByText("buyer view")).toBeInTheDocument());
    expect(screen.queryByText("seller view")).not.toBeInTheDocument();
    expect(onAction).toHaveBeenCalledWith({ kind: "api", method: "GET", path: "/api/v1/me/profile" });
  });

  it("a screen with no `when` anywhere never fetches /me/profile", () => {
    const onAction = vi.fn(async () => ({}));
    render(<Renderer onAction={onAction} def={screenDef([{ id: "n", type: "text", props: { text: "plain" } }])} />);
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe("actor 表示プリミティブ(c8磨き第2弾#5 — actor_id 生ハッシュ露出の解消)", () => {
  it("table cell:'actor' shows display_name when GET /users/{id}/profile returns one", async () => {
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.path === "/api/v1/x") return { bids: [{ bidder: "actor-abcdefghijklmnop", amount: 100 }] };
      if (a.kind === "api" && a.path === "/api/v1/users/actor-abcdefghijklmnop/profile") return { display_name: "カブトの人" };
      return undefined;
    });
    render(
      <Renderer
        onAction={onAction}
        def={screenDef([
          {
            id: "bids",
            type: "table",
            props: {
              source_path: "/api/v1/x",
              bind_items: "data.bids.bids",
              columns: [{ key: "bidder", label: "入札者", cell: "actor" }, { key: "amount", label: "金額" }],
            },
          },
        ])}
      />,
    );
    await waitFor(() => expect(screen.getByText("カブトの人")).toBeInTheDocument());
    expect(screen.queryByText(/actor-abcdefghij/)).not.toBeInTheDocument();
  });

  it("falls back to a short hash when no display_name is set", async () => {
    // A distinct actor_id from the previous test — ActorLabel's cache is
    // module-level (by design, §comment on actorNameCache) and would
    // otherwise still hold the previous test's resolved "カブトの人".
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.path === "/api/v1/x") return { bids: [{ bidder: "actor-zyxwvutsrqponml", amount: 100 }] };
      if (a.kind === "api" && a.path === "/api/v1/users/actor-zyxwvutsrqponml/profile") return { display_name: null };
      return undefined;
    });
    render(
      <Renderer
        onAction={onAction}
        def={screenDef([
          {
            id: "bids",
            type: "table",
            props: {
              source_path: "/api/v1/x",
              bind_items: "data.bids.bids",
              columns: [{ key: "bidder", label: "入札者", cell: "actor" }],
            },
          },
        ])}
      />,
    );
    // shortActorId truncates a >12-char id to its first 10 chars + "…".
    await waitFor(() => expect(screen.getByText("actor-zyxw…")).toBeInTheDocument());
  });

  it("list item_actor_field renders the actor label ahead of item_text (dispute messages / market board)", async () => {
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.path === "/api/v1/x") return { messages: [{ actor_id: "actor-zzz", body: "hello" }] };
      if (a.kind === "api" && a.path === "/api/v1/users/actor-zzz/profile") return { display_name: null };
      return undefined;
    });
    render(
      <Renderer
        onAction={onAction}
        def={screenDef([
          {
            id: "messages",
            type: "list",
            props: { source_path: "/api/v1/x", bind_items: "data.messages.messages", item_actor_field: "actor_id", item_text: "{{body}}" },
          },
        ])}
      />,
    );
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
    expect(screen.getByText("actor-zzz")).toBeInTheDocument(); // <=12 chars: shown in full
  });
});

describe("TableNode data-label (c8磨き第2弾#7 — <=560px カード化のCSSが読む属性)", () => {
  it("every <td> carries its own column's data-label (the ::before content the responsive CSS renders)", async () => {
    const onAction = vi.fn(async () => ({ rows: [{ title: "x", price: 100 }] }));
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
              columns: [{ key: "title", label: "タイトル" }, { key: "price", label: "価格" }],
            },
          },
        ])}
      />,
    );
    await waitFor(() => expect(screen.getByText("x")).toBeInTheDocument());
    expect(screen.getByText("x").closest("td")).toHaveAttribute("data-label", "タイトル");
    expect(screen.getByText("100").closest("td")).toHaveAttribute("data-label", "価格");
    // The <=560px breakpoint itself (table -> stacked cards) is CSS-only
    // (globals.css) and not exercised by jsdom (no real viewport/media-query
    // layout) — this test verifies the markup contract the CSS depends on.
  });
});

describe("ImageGridNode item_href + missing-photo placeholder(c8磨き第2弾#2 — 受領10「画像を押せば詳細が出る」)", () => {
  it("renders the whole card as a clickable <a> when item_href is set", async () => {
    const onAction = vi.fn(async () => ({ listings: [{ listing_id: "L1", title: "カブト", cover_photo_id: "P1" }] }));
    render(
      <Renderer
        onAction={onAction}
        def={screenDef([
          {
            id: "grid",
            type: "image-grid",
            props: {
              source_path: "/api/v1/x",
              bind_items: "data.grid.listings",
              item_image: "/api/v1/market/listings/{{listing_id}}/photo/{{cover_photo_id}}",
              item_label: "{{title}}",
              item_href: "/s/market-trade?listing_id={{listing_id}}",
            },
          },
        ])}
      />,
    );
    await waitFor(() => expect(screen.getByText("カブト")).toBeInTheDocument());
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/s/market-trade?listing_id=L1");
    expect(link).toHaveClass("civ-thumb-card");
  });

  it("shows a placeholder glyph instead of a broken <img> when the photo field is unset", async () => {
    const onAction = vi.fn(async () => ({ listings: [{ listing_id: "L2", title: "no photo yet" }] }));
    render(
      <Renderer
        onAction={onAction}
        def={screenDef([
          {
            id: "grid",
            type: "image-grid",
            props: {
              source_path: "/api/v1/x",
              bind_items: "data.grid.listings",
              item_image: "/api/v1/market/listings/{{listing_id}}/photo/{{cover_photo_id}}",
              item_label: "{{title}}",
            },
          },
        ])}
      />,
    );
    await waitFor(() => expect(screen.getByText("no photo yet")).toBeInTheDocument());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("📷")).toBeInTheDocument();
  });
});

// KebabMenu has exactly one call site this wave (ThreadPostsNode's per-post
// "この投稿を相談室へ") — exercised directly below rather than in isolation,
// since a standalone KebabMenu screen-def node doesn't exist (it's a renderer
// primitive/component, not a declarative NodeType — see its own code comment).
describe("ThreadPostsNode — c8磨き第2弾#3/#6 additions", () => {
  function mockThread() {
    return vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.path === "/api/v1/plaza/threads/thr-1") {
        return {
          thread_id: "thr-1",
          channel: "knowledge-board",
          topic: "T",
          posts: [
            { post_id: "p1", actor_id: "root-user", channel: "knowledge-board", topic: "T", board_kind: "improvement", body: "本文", created_at: "2026-07-17T00:00:00.000Z" },
          ],
        };
      }
      if (a.kind === "api" && a.path === "/api/v1/me/profile") return { actor_id: "root-user" };
      if (a.kind === "api" && a.path === "/api/v1/users/root-user/profile") return { display_name: null };
      if (a.kind === "api" && a.path === "/api/v1/plaza/stances") return { stance_id: "s1" };
      return undefined;
    });
  }

  it("#3: 「この投稿を相談室へ」 is hidden until the kebab (⋮) trigger opens the menu", async () => {
    render(<Renderer onAction={mockThread()} params={{ thread_id: "thr-1" }} def={screenDef([{ id: "posts", type: "thread-posts", props: {} }])} />);
    await screen.findByText("本文");
    expect(screen.queryByRole("button", { name: "この投稿を相談室へ" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "この投稿の操作" }));
    expect(screen.getByRole("button", { name: "この投稿を相談室へ" })).toBeInTheDocument();
  });

  it("#6: per-post 賛成/反対/保留 buttons post statement_id=post_id (no manual post-id field anywhere)", async () => {
    const onAction = mockThread();
    render(<Renderer onAction={onAction} params={{ thread_id: "thr-1" }} def={screenDef([{ id: "posts", type: "thread-posts", props: {} }])} />);
    await screen.findByText("本文");
    expect(screen.queryByLabelText(/投稿 ID/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "賛成" }));
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith(
        { kind: "api", method: "POST", path: "/api/v1/plaza/stances" },
        { statement_id: "p1", value: "agree" },
      ),
    );
  });
});
