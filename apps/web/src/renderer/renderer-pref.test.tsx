// g80-uibatch4 T2: 好み(pref-pairwise)ペア比較のE6ちらつき解消の回帰防止。
// R0801-10372a実測=次ペア取得(GET /match/pair)の600〜1300msの間、カード本体
// (写真・名前・選択ボタン)が消えて「読み込み中…」のみになっていた。
// 「選択→次ペア取得中」の間もカード枠(.swipe-row/.pref-card)が維持され、
// 選択直後にPrefCardが一度もアンマウントされないことを固定する。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Renderer } from "./renderer";
import type { ScreenDef } from "./types";

afterEach(() => cleanup());

function def(): ScreenDef {
  return {
    screen_id: "t",
    route: "/t",
    title: "t",
    nodes: [{ id: "pref", type: "list", props: { variant: "pref-pairwise" } }],
  } as ScreenDef;
}

function pairItem(id: string, species: string) {
  return { item_id: id, species, thumbnail_path: null, latest_size: null, feature_tags: [] };
}

describe("pref-pairwise — E6スケルトン(次ペア取得中もカード枠を維持)", () => {
  it("選択直後(次ペア取得の完了前)もPrefCardの行はDOMに残ったまま(全消えしない)", async () => {
    let resolvePair: ((v: unknown) => void) | undefined;
    const onAction = vi.fn(async (a: { path?: string; method?: string }) => {
      if (a.path === "/api/v1/match/pair" && a.method === "GET") {
        // 1回目の初期取得は即解決。2回目(choose後の再取得)は手動で遅延させる。
        if (!resolvePair) {
          return {
            pair_id: "p1",
            round: 1,
            target: 5,
            exhausted: false,
            left: pairItem("a", "個体A"),
            right: pairItem("b", "個体B"),
          };
        }
        return new Promise((resolve) => {
          resolvePair = resolve;
        });
      }
      if (a.path === "/api/v1/match/pair-choice" && a.method === "POST") return {};
      return undefined;
    });

    render(<Renderer def={def()} onAction={onAction} />);
    expect(await screen.findByText("個体A")).toBeInTheDocument();

    // 次回以降の GET /match/pair を意図的に未解決のまま保留させる(choose後の
    // 再取得が「届く前」の状態を再現するため)。
    resolvePair = () => {};

    fireEvent.click(screen.getByRole("button", { name: "左" }));

    // choose直後、次ペアがまだ届いていない間 — 旧実装は「読み込み中…」だけになり
    // カード(swipe-row/個体A/個体B)が消えていた。新実装はカードが残っているはず。
    expect(screen.getByText("個体A")).toBeInTheDocument();
    expect(screen.getByText("個体B")).toBeInTheDocument();
    expect(screen.queryByText("読み込み中…")).not.toBeInTheDocument();
  });
});
