import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { Renderer, HeaderScopeCtx } from "./renderer";
import type { Action, ScreenDef } from "./types";

// HDR-1 slice2b(独立批評家blocking是正): 第2スライスの read 配線(?species=)には
// market/plaza/research へ species_id を書き込む producer が無く、scope選択中に
// それらの作成コンテンツが一覧から消えていた(producer-less decoration)。本ファイルは
// producer(FormNode props.header_scoped_producer・KnowledgeHubNode compose)が実際に
// 送信 body へ headerScope.species を注入することを固定する。
//
// AppShellNode 経由(GET /auth/session・/me/preferences)を待たず、HeaderScopeCtx.Provider
// で直接スコープを注入する(既存 renderer-knw-dupconfirm.test.tsx と同じ app-shell 無し
// screen def パターン — HeaderScopeCtx はモジュールデフォルト値を持つ React context なので
// 外側から供給できる)。

afterEach(() => cleanup());

const SCOPED = { species: "Dynastes hercules", lineageId: "" };

function marketCreateFormDef(headerScopedProducer: boolean): ScreenDef {
  return {
    screen_id: "t",
    route: "/t",
    title: "t",
    nodes: [
      {
        id: "create-listing-form",
        type: "form",
        props: headerScopedProducer ? { header_scoped_producer: true } : {},
        action: { kind: "api", method: "POST", path: "/api/v1/market/listings" },
        children: [
          { id: "new-title", type: "field", props: { variant: "text", name: "title", label: "出品タイトル", required: true } },
          { id: "new-submit", type: "button", props: { type: "submit", label: "下書きを作成する" } },
        ],
      },
    ],
  };
}

describe("HDR-1 slice2b: FormNode props.header_scoped_producer", () => {
  it("scope選択中の create は送信 body に species_id を自動付与する(ユーザー再入力なし)", async () => {
    const onAction = vi.fn(async () => ({ listing_id: "L1" }));
    render(
      <HeaderScopeCtx.Provider value={SCOPED}>
        <Renderer onAction={onAction} def={marketCreateFormDef(true)} onNavigate={vi.fn()} />
      </HeaderScopeCtx.Provider>,
    );
    fireEvent.change(screen.getByLabelText(/出品タイトル/), { target: { value: "ヘラクレス♂" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "下書きを作成する" }));
    });
    expect(onAction).toHaveBeenCalledWith(
      { kind: "api", method: "POST", path: "/api/v1/market/listings" },
      { title: "ヘラクレス♂", species_id: "Dynastes hercules" },
    );
  });

  it("空scope(すべて)の create は species_id を付けない(従来通り)", async () => {
    const onAction = vi.fn(async () => ({ listing_id: "L1" }));
    render(<Renderer onAction={onAction} def={marketCreateFormDef(true)} onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/出品タイトル/), { target: { value: "無タグ" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "下書きを作成する" }));
    });
    expect(onAction).toHaveBeenCalledWith({ kind: "api", method: "POST", path: "/api/v1/market/listings" }, { title: "無タグ" });
  });

  it("header_scoped_producer を持たないフォームは scope選択中でも species_id を付けない(opt-in規約)", async () => {
    const onAction = vi.fn(async () => ({ listing_id: "L1" }));
    render(
      <HeaderScopeCtx.Provider value={SCOPED}>
        <Renderer onAction={onAction} def={marketCreateFormDef(false)} onNavigate={vi.fn()} />
      </HeaderScopeCtx.Provider>,
    );
    fireEvent.change(screen.getByLabelText(/出品タイトル/), { target: { value: "未opt-in" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "下書きを作成する" }));
    });
    expect(onAction).toHaveBeenCalledWith({ kind: "api", method: "POST", path: "/api/v1/market/listings" }, { title: "未opt-in" });
  });
});

function knowledgeHubDef(): ScreenDef {
  return {
    screen_id: "t",
    route: "/t",
    title: "t",
    nodes: [{ id: "hub", type: "list", props: { variant: "knowledge-hub", source_path: "/api/v1/plaza/search" } }],
  };
}

function openCompose() {
  fireEvent.click(screen.getByText("新しく相談する"));
  return screen.getByPlaceholderText("相談したいことを入力");
}

describe("HDR-1 slice2b: KnowledgeHubNode compose producer", () => {
  it("scope選択中の新規スレ作成は POST /plaza/posts の body に species_id を自動付与する", async () => {
    const posted: Record<string, unknown>[] = [];
    const onAction = vi.fn(async (a: Action, body?: Record<string, unknown>) => {
      if (a.kind === "api" && a.method === "GET" && a.path.startsWith("/api/v1/plaza/search")) return { query: "x", matches: [] };
      if (a.kind === "api" && a.method === "POST" && a.path === "/api/v1/plaza/posts") {
        posted.push(body ?? {});
        return { post_id: "new-post", thread_id: "thr-new" };
      }
      return undefined;
    });
    render(
      <HeaderScopeCtx.Provider value={SCOPED}>
        <Renderer onAction={onAction} def={knowledgeHubDef()} onNavigate={vi.fn()} />
      </HeaderScopeCtx.Provider>,
    );
    const input = openCompose();
    fireEvent.change(input, { target: { value: "コバエ対策どうしてる" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "この内容で相談を始める" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "この内容で相談を始める" }));

    await waitFor(() =>
      expect(posted).toContainEqual({
        channel: "knowledge-board",
        board_kind: "guide",
        topic: "コバエ対策どうしてる",
        body: "コバエ対策どうしてる",
        species_id: "Dynastes hercules",
      }),
    );
  });
});
