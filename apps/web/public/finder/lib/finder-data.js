// finder-data.js — shared pure functions for finder.html / universe.html
// (caseB7実物採用・R52). Vanilla-JS port of apps/web/src/renderer/
// universe-utils.ts + individual-finder-utils.ts (same algorithms, same
// tie-break/null rules) so both static pages and the renderer screen agree
// on "世代" / lineage / nearest-neighbour semantics. Kept dependency-free
// (ES module, no bundler — these pages are served raw from public/).
// ponytail: no dedicated vitest file for this port (vitest's include glob is
// src/**/*.test.{ts,tsx} only, and duplicating a public/ import path there
// would be a scope-creep config change). apps/web/e2e/finder-pro.spec.ts
// exercises every branch below against real data — that is this file's
// runnable check (generation calc, missing-axis dimming, nearest-by-coord).

/**
 * 世代(G0=既知の親を持たない個体・以後は「既知の親の最大世代+1」)を血統エッジ
 * から都度計算する。循環/未知の親は「不明(null)」— でっち上げ世代を出さない。
 * (apps/web/src/renderer/universe-utils.ts computeGenerations と同一ロジック)
 */
export function computeGenerations(ids, links) {
  const idSet = new Set(ids);
  const parentsOf = new Map(ids.map((id) => [id, []]));
  for (const l of links) {
    if (!idSet.has(l.child_id) || !idSet.has(l.parent_id)) continue;
    parentsOf.get(l.child_id).push(l.parent_id);
  }
  const gen = new Map();
  const resolving = new Set();
  function resolve(id) {
    if (gen.has(id)) return gen.get(id);
    if (resolving.has(id)) {
      gen.set(id, null);
      return null;
    }
    resolving.add(id);
    const parents = parentsOf.get(id) ?? [];
    let result;
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
      result = anyKnown ? maxKnown + 1 : null;
    }
    resolving.delete(id);
    gen.set(id, result);
    return result;
  }
  for (const id of ids) resolve(id);
  return gen;
}

/** 選択個体の先祖(親を再帰的に遡る)・子孫(子を再帰的に辿る) + 経路エッジキー。
 *  循環は visited 集合で打ち切り(無限ループしない)。 */
export function computeLineage(selectedId, links) {
  const childrenOf = new Map();
  const parentsOf = new Map();
  for (const l of links) {
    (childrenOf.get(l.parent_id) ?? childrenOf.set(l.parent_id, []).get(l.parent_id)).push(l.child_id);
    (parentsOf.get(l.child_id) ?? parentsOf.set(l.child_id, []).get(l.child_id)).push(l.parent_id);
  }
  const ancestors = new Set();
  const edgeKeys = new Set();
  const visitedUp = new Set([selectedId]);
  const upStack = [selectedId];
  while (upStack.length) {
    const cur = upStack.pop();
    for (const p of parentsOf.get(cur) ?? []) {
      edgeKeys.add(`${p}->${cur}`);
      if (!visitedUp.has(p)) {
        visitedUp.add(p);
        ancestors.add(p);
        upStack.push(p);
      }
    }
  }
  const descendants = new Set();
  const visitedDown = new Set([selectedId]);
  const downStack = [selectedId];
  while (downStack.length) {
    const cur = downStack.pop();
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

// 1軸を rank(-1..1)へ変換。既知値なし=null列。1件のみ/同順位はセンター(0)。
function rankAxis(values) {
  const withIdx = values.map((v, i) => ({ v, i })).filter((o) => o.v != null);
  withIdx.sort((a, b) => a.v - b.v || a.i - b.i);
  const k = withIdx.length;
  const rank = new Array(values.length).fill(null);
  withIdx.forEach((o, pos) => {
    rank[o.i] = k > 1 ? (pos / (k - 1)) * 2 - 1 : 0;
  });
  return rank;
}

/** R52 CREED③: 実測値の「順位」ベース座標(x=体長rank・y=体重rank・z=世代)。
 *  欠測軸はセンター(0)配置+呼び出し側が estimated フラグで減光する。
 *  類似度(embedding/cosine)は使わない(誇張ゼロ)。 */
export function buildRankCoords(points, spread = 250) {
  const lengths = rankAxis(points.map((p) => p.length_mm));
  const weights = rankAxis(points.map((p) => p.weight_g));
  const gens = rankAxis(points.map((p) => p.generation));
  return points.map((p, i) => {
    const lx = lengths[i];
    const wy = weights[i];
    const gz = gens[i];
    return {
      individual_id: p.individual_id,
      x: (lx ?? 0) * spread,
      y: (wy ?? 0) * spread,
      z: (gz ?? 0) * spread,
      estimated: lx == null || wy == null || gz == null,
    };
  });
}

/** 「★この個体に近い」= 座標空間のユークリッド距離が近い上位k体。
 *  同距離は individual_id 昇順(決定論タイブレーク)。 */
export function nearestByCoord(selectedId, coords, k = 12) {
  const self = coords.find((c) => c.individual_id === selectedId);
  if (!self) return [];
  return coords
    .filter((c) => c.individual_id !== selectedId)
    .map((c) => ({ id: c.individual_id, d: Math.hypot(c.x - self.x, c.y - self.y, c.z - self.z) }))
    .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
    .slice(0, k)
    .map((x) => x.id);
}

/** p 分位点(0-100、線形補間)。実データの値配列から都度計算する(閾値ハード
 *  コードなし)。null/NaN は無視、値0件はnull。
 *  (apps/web/src/renderer/individual-finder-utils.ts percentileThreshold と同一) */
export function percentileThreshold(values, p) {
  const xs = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const idx = (p / 100) * (xs.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
}

// 種族名(自由記述)→ 固定パレットの決定論割当(同じ種族名は常に同じ色)。
const SPECIES_PALETTE = ["#ff7a1a", "#5b8cff", "#46c39a", "#c983ff", "#ff6fa8", "#e0c34a"];
export function speciesColor(species) {
  let h = 0;
  for (let i = 0; i < species.length; i++) h = (h * 31 + species.charCodeAt(i)) >>> 0;
  return SPECIES_PALETTE[h % SPECIES_PALETTE.length];
}

/** 認証ゲート(finder.html/universe.htmlの両方が使う共通処理)。middleware.tsは
 *  ドット付きパス(*.html)を素通しする(next.config.mjsのAPI rewriteと同じ同一
 *  オリジンだが、matcherが `.*\..*` を除外するため静的publicファイルには効かない)
 *  ので、このページ自身がセッションを確認して未認証なら /s/login へ送る。 */
export async function requireSession() {
  const res = await fetch("/api/v1/auth/session", { credentials: "include" }).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  if (!body || body.authenticated !== true) {
    location.href = "/s/login";
    return false;
  }
  return true;
}

/** HDR-1(c9-structure-canon.md §1/§1c/R112/R115)ヘッダー観測対象セレクタ:
 *  GET /me/preferences の scope_species/scope_lineage_id を読んで返す(両方
 *  未選択="すべて"はどちらも"")。取得失敗(未認証/ネットワーク)は空スコープ
 *  (全件表示)にフォールバックする — 静的publicページがヘッダー選好を読めなく
 *  ても、finder自体の閲覧は壊さない。 */
export async function fetchHeaderScope() {
  const res = await fetch("/api/v1/me/preferences", { credentials: "include" }).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  return {
    species: typeof body?.scope_species === "string" ? body.scope_species : "",
    lineageId: typeof body?.scope_lineage_id === "string" ? body.scope_lineage_id : "",
  };
}

/** scope({species,lineageId})を individual-routes.ts の ?species=/?lineage_id=
 *  クエリへ足した URLSearchParams を作る(未選択の軸は付けない=フィルタなし)。 */
export function withScopeParams(scope, extra = {}) {
  const params = new URLSearchParams(extra);
  if (scope.species) params.set("species", scope.species);
  if (scope.lineageId) params.set("lineage_id", scope.lineageId);
  return params;
}
