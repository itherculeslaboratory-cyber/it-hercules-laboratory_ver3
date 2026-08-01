import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { Renderer } from "./renderer";
import type { Action, ScreenDef } from "./types";

// g79-bundleA(V3-UIX-59【R136/S1】確定(修正)・b2think §2-5案1/§2-6・HQ裁定G79-2):
// AppShellNode の「この画面について」パネル。段階導入 = props.page_info を持つ
// 画面だけトリガーが出る(無い画面には何も足さない)。talk_channel:true の時だけ
// 愚痴/改善の2導線を出し、channel=当該screen_id を自動刻印して POST /plaza/posts
// へ繋ぐ(手入力させない=要件原文の核)。manual/Builder 導線は本発注のスコープ外
// (G79-2裁定・structure-canon.md:64の正直表示)につき、このテストでは存在しない
// ことを確認しない(パネル内テキストで賄う設計なのでUIとして別導線は無い)。

afterEach(() => cleanup());

function shellDef(screenId: string, pageInfo?: Record<string, unknown>): ScreenDef {
  return {
    screen_id: screenId,
    route: `/s/${screenId}`,
    title: "t",
    nodes: [
      {
        id: "shell",
        type: "app-shell",
        props: pageInfo ? { page_info: pageInfo } : {},
        children: [{ id: "page", type: "page", children: [{ id: "h", type: "heading", props: { text: "本文" } }] }],
      },
    ],
  };
}

describe("g79-bundleA: PageInfoPanel(page_infoパネル)", () => {
  it("page_info が無い画面には「この画面について」トリガーが出ない", () => {
    const onAction = vi.fn(async () => undefined);
    render(<Renderer onAction={onAction} def={shellDef("no-info")} onNavigate={vi.fn()} />);
    expect(screen.queryByText("この画面について")).not.toBeInTheDocument();
  });

  it("purpose だけの page_info でもトリガー+パネルが出る(how_to/faq/talk_channel は任意)", async () => {
    const onAction = vi.fn(async () => undefined);
    render(
      <Renderer
        onAction={onAction}
        def={shellDef("obs-entry", { purpose: "観測を記録する画面です" })}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText("この画面について")).toBeInTheDocument();
    fireEvent.click(screen.getByText("この画面について"));
    await waitFor(() => expect(screen.getByText("観測を記録する画面です")).toBeInTheDocument());
    // talk_channel 未指定なので愚痴/改善は出ない。
    expect(screen.queryByText("愚痴")).not.toBeInTheDocument();
    expect(screen.queryByText("改善")).not.toBeInTheDocument();
  });

  it("how_to/faq を持つ page_info はその内容を描画する", async () => {
    const onAction = vi.fn(async () => undefined);
    render(
      <Renderer
        onAction={onAction}
        def={shellDef("obs-entry", {
          purpose: "観測を記録する画面です",
          how_to: ["写真を撮る", "種を選ぶ"],
          faq: [{ q: "保存できません", a: "必須項目を確認してください" }],
        })}
        onNavigate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("この画面について"));
    await waitFor(() => expect(screen.getByText("写真を撮る")).toBeInTheDocument());
    expect(screen.getByText("種を選ぶ")).toBeInTheDocument();
    expect(screen.getByText("保存できません")).toBeInTheDocument();
    expect(screen.getByText("必須項目を確認してください")).toBeInTheDocument();
  });

  it("talk_channel:true は愚痴/改善の2導線を出し、channel=当該screen_idを自動刻印してPOSTする(手入力させない)", async () => {
    const posted: Array<{ action: Action; body?: Record<string, unknown> }> = [];
    const onAction = vi.fn(async (a: Action, body?: Record<string, unknown>) => {
      if (a.kind === "api" && a.method === "POST" && a.path === "/api/v1/plaza/posts") {
        posted.push({ action: a, body });
        return { post_id: "p1", thread_id: "thr-1" };
      }
      return undefined;
    });
    const onNavigate = vi.fn();
    render(
      <Renderer
        onAction={onAction}
        def={shellDef("obs-entry", { purpose: "観測を記録する画面です", talk_channel: true })}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByText("この画面について"));
    await waitFor(() => expect(screen.getByText("愚痴")).toBeInTheDocument());
    expect(screen.getByText("改善")).toBeInTheDocument();

    fireEvent.click(screen.getByText("愚痴"));
    const textarea = await screen.findByLabelText("愚痴を書く");
    fireEvent.change(textarea, { target: { value: "登録が分かりにくい" } });
    fireEvent.click(screen.getByText("投稿する"));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].action).toEqual({ kind: "api", method: "POST", path: "/api/v1/plaza/posts" });
    // ★channel はユーザー入力ではなく screen_id("obs-entry")がそのまま自動刻印される。
    expect(posted[0].body).toEqual({
      channel: "obs-entry",
      board_kind: "complaint",
      topic: "登録が分かりにくい",
      body: "登録が分かりにくい",
    });
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("knowledge-thread", { thread_id: "thr-1" }));
  });

  it("改善ボタンは board_kind:improvement で投稿する", async () => {
    const posted: Array<Record<string, unknown> | undefined> = [];
    const onAction = vi.fn(async (a: Action, body?: Record<string, unknown>) => {
      if (a.kind === "api" && a.method === "POST" && a.path === "/api/v1/plaza/posts") {
        posted.push(body);
        return { post_id: "p2", thread_id: "thr-2" };
      }
      return undefined;
    });
    render(
      <Renderer
        onAction={onAction}
        def={shellDef("market-trade", { purpose: "取引する画面です", talk_channel: true })}
        onNavigate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("この画面について"));
    await waitFor(() => expect(screen.getByText("改善")).toBeInTheDocument());
    fireEvent.click(screen.getByText("改善"));
    const textarea = await screen.findByLabelText("改善を書く");
    fireEvent.change(textarea, { target: { value: "もっと絞り込みたい" } });
    await act(async () => {
      fireEvent.click(screen.getByText("投稿する"));
    });
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      channel: "market-trade",
      board_kind: "improvement",
      topic: "もっと絞り込みたい",
      body: "もっと絞り込みたい",
    });
  });
});
