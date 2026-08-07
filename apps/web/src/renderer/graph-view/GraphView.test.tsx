import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { GraphView, type GraphViewIndividual, type PedigreeLink } from "./GraphView";

afterEach(() => cleanup());

// jsdomにはWebGLコンテキストが無い(3d-force-graphのForceGraph3D()呼び出しが
// 例外を投げる)ため、これらのテストは universe.js の try/catch webglOk 分岐と
// 同じく「honest fallback」経路を自然に踏む — WebGLを別途モックしない。

const INDIVIDUALS: GraphViewIndividual[] = [
  {
    individual_id: "sire-1",
    label: "父トノサマ",
    species: "トノサマバッタ",
    latest_length_mm: 70,
    latest_weight_g: 40,
    thumbnail_path: null,
  },
  {
    individual_id: "dam-1",
    label: "母トノサマ",
    species: "トノサマバッタ",
    latest_length_mm: 50,
    latest_weight_g: 20,
    thumbnail_path: null,
  },
  {
    individual_id: "child-1",
    label: "子トノサマ",
    species: "トノサマバッタ",
    latest_length_mm: 80,
    latest_weight_g: 45,
    thumbnail_path: "/api/v1/observation/c1/thumbnail/p1",
  },
];
const LINKS: PedigreeLink[] = [
  { child_id: "child-1", parent_id: "sire-1", parent_role: "sire" },
  { child_id: "child-1", parent_id: "dam-1", parent_role: "dam" },
];

describe("GraphView — 0件(正直な空状態)", () => {
  it("個体が1体も無い時はグラフを描かず、渡されたリンク先を案内する", () => {
    render(<GraphView individuals={[]} links={[]} emptyHref="/finder/finder.html" emptyLabel="ファインダーの一覧" />);
    expect(screen.getByTestId("graph-view-empty")).toHaveTextContent("まだ個体がいません。");
    expect(screen.getByRole("link", { name: "ファインダーの一覧" })).toHaveAttribute(
      "href",
      "/finder/finder.html",
    );
  });
});

describe("GraphView — ?focus相当のディープリンク(g81-bundleD T1)", () => {
  it("focusIdが個体一覧に存在すれば、WebGL成否に関係なく個体詳細パネルが開き血統(親/子)が出る", async () => {
    render(<GraphView individuals={INDIVIDUALS} links={LINKS} focusId="child-1" />);
    const detail = await screen.findByTestId("graph-view-detail");
    expect(detail).toHaveTextContent("子トノサマ");
    expect(detail).toHaveTextContent("父トノサマ");
    expect(detail).toHaveTextContent("母トノサマ");
    // 先祖2(sire+dam)・子孫0。
    expect(screen.getByText(/血統ハイライト 先祖2 ・ 子孫0/)).toBeInTheDocument();
  });

  it("focusIdが存在しない個体IDなら選択されない(誤爆しない)", () => {
    render(<GraphView individuals={INDIVIDUALS} links={LINKS} focusId="not-a-real-id" />);
    expect(screen.queryByTestId("graph-view-detail")).not.toBeInTheDocument();
  });
});

describe("GraphView — WebGL非対応環境のhonest fallback", () => {
  it("jsdomにWebGLが無いため、3d-force-graphの初期化に失敗しfallback文言を出す", async () => {
    render(
      <GraphView
        individuals={INDIVIDUALS}
        links={LINKS}
        emptyHref="/finder/finder.html"
        emptyLabel="ファインダーの一覧"
      />,
    );
    expect(await screen.findByTestId("graph-view-fallback", {}, { timeout: 5000 })).toHaveTextContent(
      "この端末ではWebGL宇宙面を表示できませんでした。",
    );
  });
});

describe("GraphView — 種族チップ・個体クリックでの選択(g81-bundleD T1)", () => {
  it("個体詳細パネルのCTAでonOpenDetailが選択中の個体IDで呼ばれる", async () => {
    let opened: string | null = null;
    render(
      <GraphView
        individuals={INDIVIDUALS}
        links={LINKS}
        focusId="child-1"
        onOpenDetail={(id) => {
          opened = id;
        }}
      />,
    );
    await screen.findByTestId("graph-view-detail");
    fireEvent.click(screen.getByRole("button", { name: "詳細画面を開く" }));
    expect(opened).toBe("child-1");
  });

  it("種族チップが実データの種族(重複無し)ぶんだけ描画される", () => {
    render(<GraphView individuals={INDIVIDUALS} links={LINKS} />);
    // 3体とも同じ種族なので「すべて」+その種族チップの2つだけ。
    expect(screen.getAllByRole("button", { name: "トノサマバッタ" })).toHaveLength(1);
  });
});

// jsdomはWebGLが無く3d-force-graphの実初期化が常に失敗する(=honest fallback)ため、
// カメラフレーミングの検証だけは "3d-force-graph" をモックする。ファイル全体を
// モックすると上のfallbackテスト(意図的な初期化失敗を検証)が壊れるため、
// vi.doMock + 動的import + vi.resetModules でこの describe 内だけ隔離する
// (g82-camerafit T2)。
describe("GraphView — カメラ初期フレーミング(g82-camerafit T2・zoomToFit相当)", () => {
  afterEach(() => {
    vi.doUnmock("3d-force-graph");
    vi.resetModules();
  });

  function mockForceGraph3D() {
    const zoomToFit = vi.fn();
    const cameraPosition = vi.fn();
    vi.doMock("3d-force-graph", () => ({
      default: () => () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g: any = {};
        [
          "backgroundColor",
          "nodeId",
          "nodeLabel",
          "nodeVal",
          "nodeResolution",
          "enableNodeDrag",
          "showNavInfo",
          "onNodeClick",
          "graphData",
          "nodeColor",
          "nodeVisibility",
          "linkVisibility",
          "linkColor",
          "linkWidth",
          "linkDirectionalParticles",
        ].forEach((m) => {
          g[m] = vi.fn(() => g);
        });
        g.cameraPosition = cameraPosition.mockImplementation(() => g);
        g.zoomToFit = zoomToFit.mockImplementation(() => g);
        g.camera = vi.fn(() => ({ position: { x: 0, y: 0, z: 0 } }));
        g.graph2ScreenCoords = vi.fn(() => ({ x: 0, y: 0 }));
        g.controls = vi.fn(() => ({}));
        return g;
      },
    }));
    return { zoomToFit, cameraPosition };
  }

  it("focusId無しでデータ投入後にzoomToFit(3d-force-graph標準API)が呼ばれる", async () => {
    const { zoomToFit } = mockForceGraph3D();
    const { GraphView: MockedGraphView } = await import("./GraphView");
    render(<MockedGraphView individuals={INDIVIDUALS} links={LINKS} />);
    await waitFor(() => expect(zoomToFit).toHaveBeenCalled());
    expect(zoomToFit).toHaveBeenCalledWith(900, 80);
  });

  it("focusIdがある時はzoomToFitではなく選択個体近傍へcameraPositionで寄る(旧universe.js踏襲)", async () => {
    const { zoomToFit, cameraPosition } = mockForceGraph3D();
    const { GraphView: MockedGraphView } = await import("./GraphView");
    render(<MockedGraphView individuals={INDIVIDUALS} links={LINKS} focusId="child-1" />);
    await waitFor(() => expect(cameraPosition.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(zoomToFit).not.toHaveBeenCalled();
    const [pos, lookAt, ms] = cameraPosition.mock.calls[cameraPosition.mock.calls.length - 1];
    expect(ms).toBe(900);
    expect(pos.x).toBeCloseTo(lookAt.x);
    expect(pos.y).toBeCloseTo(lookAt.y + 18);
    expect(pos.z).toBeCloseTo(lookAt.z + 90);
  });
});
