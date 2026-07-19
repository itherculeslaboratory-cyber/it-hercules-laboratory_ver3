import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { Renderer, HeaderScopeCtx } from "./renderer";
import type { Action, ScreenDef } from "./types";

// wave1 KNW「種族の本」(R133=○○90点採用・承認mockup D:\claude\00-hq\dashboard\
// mockups\knw-species-book.html) — SpeciesBookNode, reached via list node
// props.variant:"species-book" (same in-scope trick as KnowledgeHubNode's
// props.variant:"knowledge-hub" — schema node type enum is C9-owned/out of
// scope). scope.species comes from HeaderScopeCtx (AppShellNode's global
// 観測対象 selector in the real app); here it is supplied directly via
// HeaderScopeCtx.Provider since these tests mount the node standalone
// (no app-shell ancestor).

afterEach(() => cleanup());

function screenDef(): ScreenDef {
  return {
    screen_id: "t",
    route: "/t",
    title: "t",
    nodes: [{ id: "book", type: "list", props: { variant: "species-book", source_path: "/api/v1/plaza/species" } }],
  };
}

interface MockChapter {
  topic: string;
  thread_count: number;
  post_count: number;
  latest_at: string;
  status: "verified" | "refuted" | "unresolved" | "open";
  cite_count: number;
  retry_reproduced: number;
  retry_not_reproduced: number;
  stance_total: number;
  answer: string;
  answer_verified: boolean;
  history: { diff: string; at: string }[];
}

function mockBook(speciesId: string, chapters: MockChapter[]) {
  return {
    species_id: speciesId,
    species_name: "ヘラクレス・ヘラクレス",
    chapter_count: chapters.length,
    thread_count: chapters.reduce((n, c) => n + c.thread_count, 0),
    verified_count: chapters.filter((c) => c.status === "verified").length,
    chapters,
  };
}

function renderWithScope(species: string, onAction: ReturnType<typeof vi.fn>) {
  return render(
    <HeaderScopeCtx.Provider value={{ species, lineageId: "" }}>
      <Renderer onAction={onAction} def={screenDef()} />
    </HeaderScopeCtx.Provider>,
  );
}

describe("SpeciesBookNode — wave1 KNW「種族の本」(mockup verbatim adoption)", () => {
  it("shows the honest empty state when no species is selected in scope, and never fetches", async () => {
    const onAction = vi.fn(async () => undefined);
    renderWithScope("", onAction);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("上のヘッダーで観測対象(種族)を選ぶと、その種族の本が開きます。")).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows the honest empty state when the species has zero chapters (not an error)", async () => {
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.method === "GET" && a.path === "/api/v1/plaza/species/sp-1/book") {
        return mockBook("sp-1", []);
      }
      return undefined;
    });
    renderWithScope("sp-1", onAction);
    await waitFor(() =>
      expect(
        screen.getByText("まだこの種族のスレッドがありません。困った/話したい で相談すると、ここに章が集まります。"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders chapters with the right badge label per status, and the book cover stats", async () => {
    const chapters: MockChapter[] = [
      {
        topic: "最適温度",
        thread_count: 6,
        post_count: 9,
        latest_at: "2026-07-17T00:00:00.000Z",
        status: "verified",
        cite_count: 5,
        retry_reproduced: 3,
        retry_not_reproduced: 0,
        stance_total: 0,
        answer: "22〜24℃で安定。",
        answer_verified: true,
        history: [
          { diff: "「25℃が良い」が有力だった", at: "2025-11-01T00:00:00.000Z" },
          { diff: "「23℃前後」へ(追試で再現)", at: "2026-02-01T00:00:00.000Z" },
        ],
      },
      {
        topic: "死着しない梱包",
        thread_count: 5,
        post_count: 5,
        latest_at: "2026-07-10T00:00:00.000Z",
        status: "open",
        cite_count: 0,
        retry_reproduced: 0,
        retry_not_reproduced: 0,
        stance_total: 0,
        answer: "保冷剤を直接当てない。",
        answer_verified: false,
        history: [],
      },
      {
        topic: "産卵セットの組み方",
        thread_count: 9,
        post_count: 12,
        latest_at: "2026-07-16T00:00:00.000Z",
        status: "unresolved",
        cite_count: 0,
        retry_reproduced: 0,
        retry_not_reproduced: 0,
        stance_total: 12,
        answer: "硬詰めの厚さで意見が分かれる。",
        answer_verified: false,
        history: [],
      },
      {
        topic: "「20℃以下でも平気」説",
        thread_count: 4,
        post_count: 4,
        latest_at: "2026-07-13T00:00:00.000Z",
        status: "refuted",
        cite_count: 2,
        retry_reproduced: 0,
        retry_not_reproduced: 5,
        stance_total: 0,
        answer: "低温放置での不全報告が複数。",
        answer_verified: false,
        history: [],
      },
    ];
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.method === "GET" && a.path === "/api/v1/plaza/species/sp-1/book") {
        return mockBook("sp-1", chapters);
      }
      return undefined;
    });
    renderWithScope("sp-1", onAction);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "📖 ヘラクレス・ヘラクレスの本" })).toBeInTheDocument(),
    );
    // book cover stats.
    expect(screen.getByText("4")).toBeInTheDocument(); // chapter_count
    expect(screen.getByText("24")).toBeInTheDocument(); // thread_count (6+5+9+4)
    expect(screen.getByText("1")).toBeInTheDocument(); // verified_count

    // verified chapter's badge, with the real observation/retry counts (not a
    // hardcoded percentage — decision-cards-plain-language.md). Appears twice:
    // once as the chapter-list badge, once as the featured 章をひらくと's
    // verified-badge (same chapter, same real counts).
    expect(screen.getAllByText("✔ 裏取り済み(実観測5・追試3)")).toHaveLength(2);
    expect(screen.getByText("△ まだ未検証")).toBeInTheDocument();
    expect(screen.getByText("まだ話し合い中")).toBeInTheDocument();
    expect(screen.getByText("⚠ 反証あり")).toBeInTheDocument();

    // 「章をひらくと」picks the verified chapter (answer_verified===true) as the
    // featured example, and renders its history as a timeline with "今" last.
    expect(screen.getByRole("heading", { name: "📖 章をひらくと(例: 最適温度)" })).toBeInTheDocument();
    // "answer" appears both as the chapter-list excerpt and the featured
    // conclusion's cl-text (same real chapter, same real answer).
    expect(screen.getAllByText("22〜24℃で安定。").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("「25℃が良い」が有力だった")).toBeInTheDocument();
    expect(screen.getByText("今")).toBeInTheDocument();

    // the growing tree lists every chapter topic as a chip.
    expect(screen.getByText("🌳 本は自然に厚くなる")).toBeInTheDocument();
    expect(screen.getAllByText("最適温度").length).toBeGreaterThan(1); // chapter-row + tree-chip
  });

  it("omits the timeline card entirely when the featured chapter has no history (誇張ゼロ)", async () => {
    const chapters: MockChapter[] = [
      {
        topic: "湿度",
        thread_count: 2,
        post_count: 2,
        latest_at: "2026-07-01T00:00:00.000Z",
        status: "open",
        cite_count: 0,
        retry_reproduced: 0,
        retry_not_reproduced: 0,
        stance_total: 0,
        answer: "60%前後。",
        answer_verified: false,
        history: [],
      },
    ];
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.method === "GET" && a.path === "/api/v1/plaza/species/sp-1/book") {
        return mockBook("sp-1", chapters);
      }
      return undefined;
    });
    const { container } = renderWithScope("sp-1", onAction);
    await waitFor(() => expect(screen.getByRole("heading", { name: "📖 章をひらくと(例: 湿度)" })).toBeInTheDocument());
    expect(container.querySelector(".timeline-title")).not.toBeInTheDocument();
    expect(container.querySelector(".timeline")).not.toBeInTheDocument();
  });

  it("re-fetches with the new species id when scope.species changes", async () => {
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.method === "GET" && a.path === "/api/v1/plaza/species/sp-1/book") {
        return mockBook("sp-1", []);
      }
      if (a.kind === "api" && a.method === "GET" && a.path === "/api/v1/plaza/species/sp-2/book") {
        return mockBook("sp-2", []);
      }
      return undefined;
    });
    const { rerender } = render(
      <HeaderScopeCtx.Provider value={{ species: "sp-1", lineageId: "" }}>
        <Renderer onAction={onAction} def={screenDef()} />
      </HeaderScopeCtx.Provider>,
    );
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/plaza/species/sp-1/book" }),
      ),
    );
    rerender(
      <HeaderScopeCtx.Provider value={{ species: "sp-2", lineageId: "" }}>
        <Renderer onAction={onAction} def={screenDef()} />
      </HeaderScopeCtx.Provider>,
    );
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/plaza/species/sp-2/book" }),
      ),
    );
  });
});
