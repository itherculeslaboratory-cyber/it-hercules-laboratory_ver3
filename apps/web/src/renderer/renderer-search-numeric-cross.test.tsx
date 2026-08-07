import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { Renderer } from "./renderer";
import type { Action, ScreenDef } from "./types";

// g80-uibatch3 T2(E1横断検索UI導線・R0801-d5e912=GET /api/v1/search完成済みAPI)+
// T4(V3-UIX-37是正・R0801-95b347=UIB05A-1○85点「このほうが綺麗」: 数値フィルタの
// 操作方式を「中心値±幅」固定から「以上/以下/付近」常時表示クリック選択へ)。
// SearchNavigatorNode(obs-search画面の実体)を直接renderして検証する。

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function searchDef(): ScreenDef {
  return {
    screen_id: "obs-search",
    route: "/observe/search",
    title: "検索",
    nodes: [
      {
        id: "shell",
        type: "app-shell",
        children: [
          {
            id: "page",
            type: "page",
            children: [{ id: "nav", type: "search-navigator", props: {} }],
          },
        ],
      },
    ],
  };
}

const INDIVIDUALS = [
  {
    individual_id: "ind-1",
    label: "個体A",
    species: "オオクワガタ",
    stage: "adult",
    placement_id: null,
    last_care_at: null,
    latest_weight_g: 30,
    latest_length_mm: 70,
    capture_count: 1,
    eclosion_at: null,
    thumbnail_path: null,
  },
  {
    individual_id: "ind-2",
    label: "個体B",
    species: "オオクワガタ",
    stage: "adult",
    placement_id: null,
    last_care_at: null,
    latest_weight_g: 10,
    latest_length_mm: 40,
    capture_count: 1,
    eclosion_at: null,
    thumbnail_path: null,
  },
];

function makeOnAction(crossResponse?: unknown) {
  return vi.fn(async (action: Action) => {
    if (action.kind !== "api") return undefined;
    if (action.path.startsWith("/api/v1/individuals")) return { individuals: INDIVIDUALS };
    if (action.path.startsWith("/api/v1/placements")) return { placements: [] };
    if (action.path.startsWith("/api/v1/search")) return crossResponse;
    return undefined;
  });
}

describe("T4: NumericFilterRow — 以上/以下/付近の3ボタン常時表示クリック選択", () => {
  it("既定は「付近」で中心値/幅の入力が出る", async () => {
    const onAction = makeOnAction();
    render(<Renderer def={searchDef()} onAction={onAction} onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText(/個体 \//).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(/絞り込み/)[0]);
    expect(screen.getAllByText("体長(mm)").length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText("中心値").length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText("幅").length).toBeGreaterThan(0);
  });

  it("「以上」を選ぶと単一値入力に切り替わり、体長70以上だけに絞られる", async () => {
    const onAction = makeOnAction();
    render(<Renderer def={searchDef()} onAction={onAction} onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText(/個体 \//).length).toBeGreaterThan(0));

    const filterToggle = screen.getAllByText(/絞り込み/)[0];
    fireEvent.click(filterToggle);

    const lengthRow = screen.getAllByText("体長(mm)")[0].closest(".civ-picker-row") as HTMLElement;
    const gteRadio = within(lengthRow).getByRole("radio", { name: "以上" });
    fireEvent.click(gteRadio);

    expect(within(lengthRow).queryByPlaceholderText("中心値")).not.toBeInTheDocument();
    const valueInput = within(lengthRow).getByPlaceholderText("以上の値");
    fireEvent.change(valueInput, { target: { value: "50" } });
    fireEvent.blur(valueInput);

    await waitFor(() => expect(screen.getAllByText("1個体 / 1枚")[0]).toBeInTheDocument());
  });

  it("体重(g)の行も同じ3ボタンで動く(共通部品なので両方に効くことの確認)", async () => {
    const onAction = makeOnAction();
    render(<Renderer def={searchDef()} onAction={onAction} onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText(/個体 \//).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(/絞り込み/)[0]);

    const weightRow = screen.getAllByText("体重(g)")[0].closest(".civ-picker-row") as HTMLElement;
    const lteRadio = within(weightRow).getByRole("radio", { name: "以下" });
    fireEvent.click(lteRadio);
    const valueInput = within(weightRow).getByPlaceholderText("以下の値");
    fireEvent.change(valueInput, { target: { value: "15" } });
    fireEvent.blur(valueInput);

    await waitFor(() => expect(screen.getAllByText("1個体 / 1枚")[0]).toBeInTheDocument());
  });
});

describe("T1(ORDER-2026-08-07-release-fixes): 中心値/幅/単一値入力がgetByLabelで発見できる", () => {
  it("体長・体重の中心値/幅/以上値/以下値がaria-labelで取得できる", async () => {
    const onAction = makeOnAction();
    render(<Renderer def={searchDef()} onAction={onAction} onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText(/個体 \//).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(/絞り込み/)[0]);

    expect(screen.getByLabelText("体長の中心値")).toBeInTheDocument();
    expect(screen.getByLabelText("体長の幅")).toBeInTheDocument();
    expect(screen.getByLabelText("体重の中心値")).toBeInTheDocument();
    expect(screen.getByLabelText("体重の幅")).toBeInTheDocument();

    const lengthRow = screen.getAllByText("体長(mm)")[0].closest(".civ-picker-row") as HTMLElement;
    fireEvent.click(within(lengthRow).getByRole("radio", { name: "以上" }));
    expect(screen.getByLabelText("体長の値")).toBeInTheDocument();
  });
});

describe("T2: 横断検索UI導線(GET /api/v1/search)", () => {
  it("打ち切りありの応答を正直に表示する", async () => {
    const crossResponse = {
      query: { q: "産卵", type: null, subject: null, actor_id: null, from: "2026-07-26", to: "2026-08-01" },
      count: 1,
      results: [
        {
          event_id: "e-1",
          type: "observation",
          subject: "ind-1",
          actor_id: "a1",
          received_at: "2026-08-01T00:00:00.000Z",
          payload_key: "k",
          text_repr: "産卵を確認した",
        },
      ],
      truncated: true,
      truncated_dates: ["2026-08-01"],
      unknown_type_note: "note",
      dedup_note: "note",
    };
    const onAction = makeOnAction(crossResponse);
    render(<Renderer def={searchDef()} onAction={onAction} onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText(/個体 \//).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText(/横断検索/));
    fireEvent.change(screen.getByLabelText("キーワード"), { target: { value: "産卵" } });
    fireEvent.click(screen.getByText("横断検索する"));

    await waitFor(() => expect(screen.getByText("産卵を確認した")).toBeInTheDocument());
    expect(screen.getByText(/打ち切りあり/)).toBeInTheDocument();
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "api", method: "GET", path: "/api/v1/search?q=%E7%94%A3%E5%8D%B5" }),
    );
  });

  it("0件応答は「該当する記録がありません」を表示し、打ち切り表示は出さない", async () => {
    const crossResponse = {
      query: { q: null, type: null, subject: null, actor_id: null, from: "2026-07-26", to: "2026-08-01" },
      count: 0,
      results: [],
      truncated: false,
      truncated_dates: [],
      unknown_type_note: "note",
      dedup_note: "note",
    };
    const onAction = makeOnAction(crossResponse);
    render(<Renderer def={searchDef()} onAction={onAction} onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText(/個体 \//).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText(/横断検索/));
    fireEvent.click(screen.getByText("横断検索する"));

    await waitFor(() => expect(screen.getByText("該当する記録がありません。")).toBeInTheDocument());
    expect(screen.queryByText(/打ち切りあり/)).not.toBeInTheDocument();
  });
});
