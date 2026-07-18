// T-66(design-individual-finder.md §1.2/§3/§5波2-3・V3-UIX-83後続波): 個体宇宙面
// (全個体星空)の純関数。IndividualUniverseNode(renderer.tsx)から呼ばれる —
// individual-finder-utils.ts と同じ切り出し方(rendering/WebGL抜きに検算するため)。
// 誇張ゼロ: 類似度(embedding/cosine)は一切使わない。配置は実測形質軸(体長・体重・
// 世代)のみの決定論配置。世代は血統エッジ(pedigree-links)から都度計算する
// (Truthに常駐フィールドは無い・不変条項①)。

export interface PedigreeLink {
  child_id: string;
  parent_id: string;
  parent_role: string;
}

/**
 * 世代(G0=既知の親を持たない個体・以後は「既知の親の最大世代+1」)を血統エッジ
 * から都度計算する。循環(自己参照/閉じた輪)は buildPedigree(バックエンド)と
 * 同じ思想で「解決不能=不明(null)」として打ち切る(無限ループしない・でっち上げ
 * 世代を出さない=誇張ゼロ)。既知の個体集合(ids)に含まれない親は「情報なし」
 * 扱いで無視する(購入個体等・血統が自分の所有物を跨ぐケース)。
 */
export function computeGenerations(ids: string[], links: PedigreeLink[]): Map<string, number | null> {
  const idSet = new Set(ids);
  const parentsOf = new Map<string, string[]>();
  for (const id of ids) parentsOf.set(id, []);
  for (const l of links) {
    if (!idSet.has(l.child_id) || !idSet.has(l.parent_id)) continue;
    parentsOf.get(l.child_id)!.push(l.parent_id);
  }

  const gen = new Map<string, number | null>();
  const resolving = new Set<string>();

  function resolve(id: string): number | null {
    if (gen.has(id)) return gen.get(id)!;
    if (resolving.has(id)) {
      gen.set(id, null); // 循環検出: この個体に戻ってきた=打ち切り(不明)
      return null;
    }
    resolving.add(id);
    const parents = parentsOf.get(id) ?? [];
    let result: number | null;
    if (parents.length === 0) {
      result = 0;
    } else {
      let maxKnown = -1;
      let anyKnown = false;
      for (const p of parents) {
        const pg = resolve(p);
        if (pg != null) {
          anyKnown = true;
          if (pg > maxKnown) maxKnown = pg;
        }
      }
      // 親は存在するが全て不明(循環に巻き込まれた等) → でっち上げの0を出さず不明のまま。
      result = anyKnown ? maxKnown + 1 : null;
    }
    resolving.delete(id);
    gen.set(id, result);
    return result;
  }

  for (const id of ids) resolve(id);
  return gen;
}

export interface LineageResult {
  ancestors: Set<string>;
  descendants: Set<string>;
  /** "parent_id->child_id" キー。先祖側/子孫側どちらのエッジかは
   *  ancestors/descendants に selected を加えた集合への包含で判定できる。 */
  edgeKeys: Set<string>;
}

/** 選択個体の先祖(親を再帰的に遡る)・子孫(子を再帰的に辿る)を求める。
 *  visited集合で循環を検出・無限ループしない(caseB7 computeLineage と同じ形)。 */
export function computeLineage(selectedId: string, links: PedigreeLink[]): LineageResult {
  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  for (const l of links) {
    (childrenOf.get(l.parent_id) ?? childrenOf.set(l.parent_id, []).get(l.parent_id)!).push(l.child_id);
    (parentsOf.get(l.child_id) ?? parentsOf.set(l.child_id, []).get(l.child_id)!).push(l.parent_id);
  }

  const ancestors = new Set<string>();
  const edgeKeys = new Set<string>();
  const visitedUp = new Set<string>([selectedId]);
  const upStack = [selectedId];
  while (upStack.length) {
    const cur = upStack.pop()!;
    for (const p of parentsOf.get(cur) ?? []) {
      edgeKeys.add(`${p}->${cur}`);
      if (!visitedUp.has(p)) {
        visitedUp.add(p);
        ancestors.add(p);
        upStack.push(p);
      }
    }
  }

  const descendants = new Set<string>();
  const visitedDown = new Set<string>([selectedId]);
  const downStack = [selectedId];
  while (downStack.length) {
    const cur = downStack.pop()!;
    for (const c of childrenOf.get(cur) ?? []) {
      edgeKeys.add(`${cur}->${c}`);
      if (!visitedDown.has(c)) {
        visitedDown.add(c);
        descendants.add(c);
        downStack.push(c);
      }
    }
  }

  return { ancestors, descendants, edgeKeys };
}

export interface AxisPoint {
  individual_id: string;
  length_mm: number | null;
  weight_g: number | null;
  generation: number | null;
}

export interface UniverseCoord {
  individual_id: string;
  x: number;
  y: number;
  z: number;
  /** いずれかの軸が欠測で中央値配置になっている(呼び出し側は減光に使う)。 */
  estimated: boolean;
}

/** 1軸を -1..1 へ min-max 正規化。欠測(null)はそのまま null で返し、
 *  既知値の中央値(同じ -1..1 スケール)も併せて返す(欠測の中央値フォールバック用)。
 *  既知値が0件はどちらもnull。既知値が1件/全同値(span=0)は0扱い(倒れない)。 */
function normalizeAxis(values: (number | null)[]): { norm: (number | null)[]; median: number | null } {
  const known = values.filter((v): v is number => v != null).sort((a, b) => a - b);
  if (known.length === 0) return { norm: values.map(() => null), median: null };
  const min = known[0];
  const max = known[known.length - 1];
  const span = max - min;
  const mid = Math.floor(known.length / 2);
  const medianRaw = known.length % 2 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
  const scale = (v: number) => (span === 0 ? 0 : ((v - min) / span) * 2 - 1);
  return { norm: values.map((v) => (v == null ? null : scale(v))), median: scale(medianRaw) };
}

/** 実測形質軸(体長・体重・世代)を fx/fy/fz(-spread..spread)へ決定論配置する。
 *  欠測軸は中央値配置(呼び出し側の「配置は実測値による近さ」注記+減光とセット)。
 *  類似度(embedding/cosine)は使わない(誇張ゼロ)。 */
export function buildUniverseCoords(points: AxisPoint[], spread = 250): UniverseCoord[] {
  const lengths = normalizeAxis(points.map((p) => p.length_mm));
  const weights = normalizeAxis(points.map((p) => p.weight_g));
  const gens = normalizeAxis(points.map((p) => p.generation));
  return points.map((p, i) => {
    const lx = lengths.norm[i];
    const wy = weights.norm[i];
    const gz = gens.norm[i];
    return {
      individual_id: p.individual_id,
      x: (lx ?? lengths.median ?? 0) * spread,
      y: (wy ?? weights.median ?? 0) * spread,
      z: (gz ?? gens.median ?? 0) * spread,
      estimated: lx == null || wy == null || gz == null,
    };
  });
}

/** 「★この個体に近い」= 形質軸空間(fx/fy/fz)のユークリッド距離が近い上位k体。
 *  同距離は individual_id 昇順(決定論タイブレーク・既存 finder sort と同じ規約)。 */
export function nearestByCoord(selectedId: string, coords: UniverseCoord[], k = 12): string[] {
  const self = coords.find((c) => c.individual_id === selectedId);
  if (!self) return [];
  return coords
    .filter((c) => c.individual_id !== selectedId)
    .map((c) => ({ id: c.individual_id, d: Math.hypot(c.x - self.x, c.y - self.y, c.z - self.z) }))
    .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
    .slice(0, k)
    .map((x) => x.id);
}

// 種族=色(テーマトークンのみ)。凡例に必ず種族名を添えるため、パレットが種族数
// より少なくても(4色循環)取り違えは起きない。血統発光時(選択あり)はこれらの
// トークンを別の意味(先祖/子孫/選択/減光)で排他的に再利用する(renderer.tsx側)。
export const SPECIES_COLOR_VARS = ["--civ-primary", "--civ-info", "--civ-caution", "--civ-danger"] as const;

/** 種族名 → パレット上のトークン変数名(決定論ハッシュ・同じ種族名は常に同じ色)。 */
export function speciesColorVar(species: string): string {
  let h = 0;
  for (let i = 0; i < species.length; i++) h = (h * 31 + species.charCodeAt(i)) >>> 0;
  return SPECIES_COLOR_VARS[h % SPECIES_COLOR_VARS.length];
}
