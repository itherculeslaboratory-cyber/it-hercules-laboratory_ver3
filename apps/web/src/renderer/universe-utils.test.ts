// T-66 個体宇宙面の純関数ユニットテスト(座標正規化・血統探索・近傍距離・
// 世代計算)。rendering/WebGL抜きの検算 — individual-finder-utils.test.ts と同じ形。
import { describe, expect, it } from "vitest";
import {
  buildUniverseCoords,
  computeGenerations,
  computeLineage,
  nearestByCoord,
  speciesColorVar,
  SPECIES_COLOR_VARS,
  type PedigreeLink,
} from "./universe-utils";

describe("computeGenerations(血統エッジからの世代計算)", () => {
  it("親を持たない個体はG0、子は親の最大世代+1", () => {
    const links: PedigreeLink[] = [
      { child_id: "b", parent_id: "a", parent_role: "sire" },
      { child_id: "c", parent_id: "b", parent_role: "sire" },
    ];
    const gen = computeGenerations(["a", "b", "c"], links);
    expect(gen.get("a")).toBe(0);
    expect(gen.get("b")).toBe(1);
    expect(gen.get("c")).toBe(2);
  });

  it("両親のうち世代が深い方に+1(sire/damで世代がズレていても矛盾しない)", () => {
    const links: PedigreeLink[] = [
      { child_id: "b", parent_id: "a", parent_role: "sire" }, // a: G0
      { child_id: "d", parent_id: "b", parent_role: "sire" }, // b: G1
      { child_id: "d", parent_id: "c", parent_role: "dam" }, // c: G0(親なし)
    ];
    const gen = computeGenerations(["a", "b", "c", "d"], links);
    expect(gen.get("d")).toBe(2); // max(sire=G1, dam=G0)+1
  });

  it("循環(閉じた血統の輪)は無限ループせず不明(null)を返す", () => {
    const links: PedigreeLink[] = [
      { child_id: "x", parent_id: "y", parent_role: "sire" },
      { child_id: "y", parent_id: "x", parent_role: "sire" }, // x<->y の閉じた輪
    ];
    const gen = computeGenerations(["x", "y"], links);
    expect(gen.get("x")).toBeNull();
    expect(gen.get("y")).toBeNull();
  });

  it("所有者集合の外にいる親(購入個体等)は情報なし扱い=その個体はG0", () => {
    const links: PedigreeLink[] = [{ child_id: "c", parent_id: "outsider", parent_role: "sire" }];
    const gen = computeGenerations(["c"], links); // outsider は ids に含まれない
    expect(gen.get("c")).toBe(0);
  });
});

describe("computeLineage(先祖/子孫の再帰探索・循環検出)", () => {
  const links: PedigreeLink[] = [
    { child_id: "b", parent_id: "a", parent_role: "sire" },
    { child_id: "c", parent_id: "b", parent_role: "sire" },
    { child_id: "d", parent_id: "b", parent_role: "sire" },
  ];

  it("多世代の先祖・子孫を両方たどる", () => {
    const { ancestors, descendants } = computeLineage("b", links);
    expect(ancestors).toEqual(new Set(["a"]));
    expect(descendants).toEqual(new Set(["c", "d"]));
  });

  it("葉ノード(子なし)は子孫が空集合", () => {
    const { ancestors, descendants } = computeLineage("c", links);
    expect(ancestors).toEqual(new Set(["a", "b"]));
    expect(descendants).toEqual(new Set());
  });

  it("循環があっても無限ループせず安全に終了する", () => {
    const cyclic: PedigreeLink[] = [
      { child_id: "x", parent_id: "y", parent_role: "sire" },
      { child_id: "y", parent_id: "x", parent_role: "sire" },
    ];
    const { ancestors, descendants } = computeLineage("x", cyclic);
    expect(ancestors).toEqual(new Set(["y"]));
    expect(descendants).toEqual(new Set(["y"]));
  });
});

describe("buildUniverseCoords(実測形質軸の順位ベース決定論配置)", () => {
  it("順位を等間隔で-spread..spreadへ正規化する", () => {
    const coords = buildUniverseCoords(
      [
        { individual_id: "a", length_mm: 10, weight_g: 1, generation: 0 },
        { individual_id: "b", length_mm: 20, weight_g: 2, generation: 1 },
        { individual_id: "c", length_mm: 30, weight_g: 3, generation: 2 },
      ],
      100,
    );
    const byId = new Map(coords.map((c) => [c.individual_id, c]));
    expect(byId.get("a")!.x).toBeCloseTo(-100);
    expect(byId.get("b")!.x).toBeCloseTo(0);
    expect(byId.get("c")!.x).toBeCloseTo(100);
    expect(coords.every((c) => !c.estimated)).toBe(true);
  });

  it("外れ値1体が10倍の値でも他の母集団はつぶれない(等間隔のまま)", () => {
    // min-maxなら a〜dは-1近辺に線状につぶれ、eだけ+1へ飛ぶ。順位ベースなら
    // 5体を等間隔(-100,-50,0,50,100)に配置し、外れ値1体の影響を受けない。
    const coords = buildUniverseCoords(
      [
        { individual_id: "a", length_mm: 10, weight_g: 1, generation: 0 },
        { individual_id: "b", length_mm: 11, weight_g: 1, generation: 0 },
        { individual_id: "c", length_mm: 12, weight_g: 1, generation: 0 },
        { individual_id: "d", length_mm: 13, weight_g: 1, generation: 0 },
        { individual_id: "e", length_mm: 130, weight_g: 1, generation: 0 }, // 10倍の外れ値
      ],
      100,
    );
    const byId = new Map(coords.map((c) => [c.individual_id, c]));
    expect(byId.get("a")!.x).toBeCloseTo(-100);
    expect(byId.get("b")!.x).toBeCloseTo(-50);
    expect(byId.get("c")!.x).toBeCloseTo(0);
    expect(byId.get("d")!.x).toBeCloseTo(50);
    expect(byId.get("e")!.x).toBeCloseTo(100);
  });

  it("同値(タイ)は平均順位でまとめて並ぶ", () => {
    // 値: 10,10,30,40 → 昇順順位 0,1,2,3。10が2件タイなので平均順位0.5を共有。
    const coords = buildUniverseCoords(
      [
        { individual_id: "a", length_mm: 10, weight_g: 1, generation: 0 },
        { individual_id: "b", length_mm: 10, weight_g: 1, generation: 0 },
        { individual_id: "c", length_mm: 30, weight_g: 1, generation: 0 },
        { individual_id: "d", length_mm: 40, weight_g: 1, generation: 0 },
      ],
      100,
    );
    const byId = new Map(coords.map((c) => [c.individual_id, c]));
    expect(byId.get("a")!.x).toBeCloseTo(byId.get("b")!.x);
    expect(byId.get("a")!.x).toBeLessThan(byId.get("c")!.x);
    expect(byId.get("c")!.x).toBeLessThan(byId.get("d")!.x);
  });

  it("欠測軸は既知順位の中央値へフォールバックし estimated=true になる", () => {
    const coords = buildUniverseCoords(
      [
        { individual_id: "a", length_mm: 10, weight_g: 1, generation: 0 },
        { individual_id: "b", length_mm: null, weight_g: 2, generation: 1 }, // 体長欠測
        { individual_id: "c", length_mm: 30, weight_g: 3, generation: 2 },
      ],
      100,
    );
    const b = coords.find((c) => c.individual_id === "b")!;
    expect(b.estimated).toBe(true);
    // 既知2件(10,30)の中央値順位(0.5)相当の正規化位置(0)に配置される。
    expect(b.x).toBeCloseTo(0);
  });

  it("全個体が同一軸値でも0除算せず0扱いになる(倒れない)", () => {
    const coords = buildUniverseCoords([
      { individual_id: "a", length_mm: 10, weight_g: 5, generation: 0 },
      { individual_id: "b", length_mm: 10, weight_g: 5, generation: 0 },
    ]);
    expect(coords.every((c) => c.x === 0 && c.y === 0 && c.z === 0)).toBe(true);
  });

  it("軸データが0件(空配列)なら全個体が原点+estimatedで返る", () => {
    const coords = buildUniverseCoords([{ individual_id: "a", length_mm: null, weight_g: null, generation: null }]);
    expect(coords).toEqual([{ individual_id: "a", x: 0, y: 0, z: 0, estimated: true }]);
  });
});

describe("nearestByCoord(形質軸空間のユークリッド近傍)", () => {
  const coords = [
    { individual_id: "center", x: 0, y: 0, z: 0, estimated: false },
    { individual_id: "near", x: 1, y: 0, z: 0, estimated: false },
    { individual_id: "far", x: 100, y: 0, z: 0, estimated: false },
  ];

  it("距離が近い順に返し、自分自身は含めない", () => {
    expect(nearestByCoord("center", coords, 2)).toEqual(["near", "far"]);
  });

  it("k件で打ち切る", () => {
    expect(nearestByCoord("center", coords, 1)).toEqual(["near"]);
  });

  it("同距離は individual_id 昇順(決定論タイブレーク)", () => {
    const tied = [
      { individual_id: "center", x: 0, y: 0, z: 0, estimated: false },
      { individual_id: "z", x: 1, y: 0, z: 0, estimated: false },
      { individual_id: "a", x: 1, y: 0, z: 0, estimated: false },
    ];
    expect(nearestByCoord("center", tied, 2)).toEqual(["a", "z"]);
  });

  it("存在しないIDは空配列(壊れない)", () => {
    expect(nearestByCoord("unknown", coords, 5)).toEqual([]);
  });
});

describe("speciesColorVar(種族名→テーマトークンの決定論ハッシュ)", () => {
  it("同じ種族名は常に同じトークンを返す", () => {
    expect(speciesColorVar("Dynastes hercules")).toBe(speciesColorVar("Dynastes hercules"));
  });

  it("返り値は既定のトークン変数集合に含まれる", () => {
    expect(SPECIES_COLOR_VARS).toContain(speciesColorVar("Dorcus hopei"));
  });
});
