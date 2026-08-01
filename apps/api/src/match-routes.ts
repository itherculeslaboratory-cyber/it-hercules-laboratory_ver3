// C5 K1 マチアプ嗜好学習 API (design-k1 §1.1/§1.4 / V3-IND-07). PROTECTED. A single
// append-only preference_event carries kind∈{swipe,pass,valuecheck}, y∈{+1,-1} and
// a feature vector x. The preference weight is the online-learning reduce
// w ← w + α·y·x (α=LEARNING_RATE); ranking is inner-product descending and the
// score is NEVER exposed in the response. envelope()/store()/dataOf() inlined per
// the projectLedger precedent (批評家#3).
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import {
  LEARNING_RATE,
  MATCH_AUC_VALID_THRESHOLD,
  IND09_PAIRWISE_QUESTION_TARGET,
  MATCH_FEATURE_TAG_VOCAB,
  MATCH_FEATURE_SIZE_NORM_MM,
  MATCH_FEATURES_VERSION,
} from "./observation-constants";
import { projectBioCard } from "./individual-routes";

export const matchRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const MATCH_TYPE = "ihl.match.preference.v1";
const MATCH_SCHEMA = "schemas/events/match-preference.schema.json";
// individual-routes.ts の MASTER_TYPE はモジュール private のため再宣言する
// (envelope()/store()/dataOf() と同じ精度=批評家#3の先例に倣う)。
const MASTER_TYPE = "ihl.ind.master.v1";

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function envelope(actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: MATCH_TYPE,
    time: new Date().toISOString(),
    dataschema: MATCH_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

const numArray = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];

/**
 * Preference weight vector for one actor: reduce the actor's own preference_events
 * with w ← w + α·y·x (α=LEARNING_RATE). Deterministic — created_at asc, pref_id
 * tie-break. The vector grows to the longest feature length seen. Pure fn of Truth.
 */
export async function projectPreferenceWeights(s: TruthStore, actorId: string): Promise<number[]> {
  const rows = (await s.listEvents(`truth/${MATCH_TYPE}/${actorId}-`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId)
    .sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.pref_id).localeCompare(String(b.pref_id)),
    );
  const w: number[] = [];
  for (const d of rows) {
    const x = numArray(d.features);
    const y = typeof d.y === "number" ? d.y : 0;
    for (let i = 0; i < x.length; i++) w[i] = (w[i] ?? 0) + LEARNING_RATE * y * x[i];
  }
  return w;
}

// exported for V3-UIX-21 (obs-search rerank personalization): the same
// deterministic dot product the ranking above uses, reused rather than
// re-implemented at the call site.
export const dot = (w: number[], x: number[]): number => {
  let s = 0;
  for (let i = 0; i < Math.min(w.length, x.length); i++) s += w[i] * x[i];
  return s;
};

/**
 * Rank candidates by inner product w·x descending. The score is computed for
 * ordering but STRIPPED from the returned objects (IND-07: score must not leak).
 * Stable for equal scores (original order preserved).
 */
export function rankByPreference<T extends { features?: unknown }>(w: number[], candidates: T[]): Omit<T, "features">[] {
  return candidates
    .map((cand, i) => ({ cand, i, score: dot(w, numArray(cand.features)) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ cand }) => {
      const { features: _f, ...rest } = cand as T & { features?: unknown };
      return rest as Omit<T, "features">;
    });
}

/**
 * 個体 → features(number[])(HQ裁定G79-1・uib02think §5-2②)。feature_tags の固定
 * 語彙(MATCH_FEATURE_TAG_VOCAB) one-hot(語彙外タグは末尾の「その他」バケツへ写像 —
 * 情報を捨てず決定論を保つ)+末尾1次元に正規化サイズ(latest_size/MATCH_FEATURE_SIZE_NORM_MM、
 * サイズ無しは0)。同一入力→同一出力の純関数(features決定論性はE4テストで担保)。
 */
export function computeMatchFeatures(featureTags: string[], latestSizeMm: number | null): number[] {
  const vocabLen = MATCH_FEATURE_TAG_VOCAB.length;
  const vec = new Array<number>(vocabLen + 2).fill(0); // [...vocab, その他, 正規化サイズ]
  for (const tag of featureTags) {
    const idx = (MATCH_FEATURE_TAG_VOCAB as readonly string[]).indexOf(tag);
    vec[idx >= 0 ? idx : vocabLen] = 1;
  }
  vec[vocabLen + 1] = latestSizeMm == null ? 0 : latestSizeMm / MATCH_FEATURE_SIZE_NORM_MM;
  return vec;
}

// distinct items the actor has weighed in on → latest feature vector per item.
async function candidatePool(s: TruthStore, actorId: string): Promise<{ item_id: string; features: number[] }[]> {
  const rows = (await s.listEvents(`truth/${MATCH_TYPE}/${actorId}-`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId)
    .sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.pref_id).localeCompare(String(b.pref_id)),
    );
  const byItem = new Map<string, number[]>();
  for (const d of rows) byItem.set(String(d.item_id), numArray(d.features)); // last write = latest features
  return [...byItem.entries()].map(([item_id, features]) => ({ item_id, features }));
}

// ── V3-IND-08 convergence evaluation ────────────────────────────────────────────
// The formula engine itself is already O(events)·no GPU·no black-box model (the
// w<-w+alpha*y*x reduce above); IND-08 additionally requires an append-only
// EVALUATION LOG that judges convergence (Precision@K/AUC/score separation/vector
// change/learning stability) and can be fully reconstructed from history even
// after LEARNING_RATE or the formula changes. Nothing here is resident state —
// every number below is recomputed from the same preference_event history that
// projectPreferenceWeights already reduces (不変条項①・"評価ログはDELETE禁止"
// is automatic: preference_event is Truth-store append-only, so re-deriving with
// a different learning rate/formula just re-runs this function over the SAME
// untouched events).

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// distinct items with their LATEST (features, true label y) — same reduction
// rule as candidatePool (last write wins) but also keeps y for evaluation.
async function labeledItems(s: TruthStore, actorId: string): Promise<{ item_id: string; features: number[]; y: number }[]> {
  const rows = (await s.listEvents(`truth/${MATCH_TYPE}/${actorId}-`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId)
    .sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.pref_id).localeCompare(String(b.pref_id)),
    );
  const byItem = new Map<string, { features: number[]; y: number }>();
  for (const d of rows) {
    byItem.set(String(d.item_id), { features: numArray(d.features), y: typeof d.y === "number" ? d.y : 0 });
  }
  return [...byItem.entries()].map(([item_id, v]) => ({ item_id, ...v }));
}

// raw event stream in learning order (features/y per event, NOT deduped by item —
// this feeds vector_change/learning_stability which are about the update STEPS).
async function orderedPreferenceEvents(s: TruthStore, actorId: string): Promise<{ features: number[]; y: number }[]> {
  const rows = (await s.listEvents(`truth/${MATCH_TYPE}/${actorId}-`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId)
    .sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.pref_id).localeCompare(String(b.pref_id)),
    );
  return rows.map((d) => ({ features: numArray(d.features), y: typeof d.y === "number" ? d.y : 0 }));
}

/**
 * AUC via the Mann-Whitney rank-sum formula (average rank on ties) — the
 * standard closed-form equivalent of "probability a random positive outranks a
 * random negative". null when one class is absent (undefined AUC).
 */
function auc(scored: { score: number; y: number }[]): number | null {
  const pos = scored.filter((s) => s.y > 0).length;
  const neg = scored.filter((s) => s.y < 0).length;
  if (!pos || !neg) return null;
  const sorted = scored.slice().sort((a, b) => a.score - b.score);
  const ranks: number[] = new Array(sorted.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j++;
    const avgRank = (i + 1 + (j + 1)) / 2; // 1-based, averaged over the tied block
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    i = j + 1;
  }
  let rankSumPos = 0;
  for (let k = 0; k < sorted.length; k++) if (sorted[k].y > 0) rankSumPos += ranks[k];
  return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Precision@K: of the top-K by score, the fraction whose true label is +1. */
function precisionAtK(scored: { score: number; y: number }[], k: number): number | null {
  if (!scored.length) return null;
  const kk = Math.min(k, scored.length);
  const top = scored.slice().sort((a, b) => b.score - a.score).slice(0, kk);
  return top.filter((s) => s.y > 0).length / kk;
}

/** Score separation度: mean(score|y=+1) - mean(score|y=-1). null if one class absent. */
function scoreSeparation(scored: { score: number; y: number }[]): number | null {
  const pos = avg(scored.filter((s) => s.y > 0).map((s) => s.score));
  const neg = avg(scored.filter((s) => s.y < 0).map((s) => s.score));
  return pos === null || neg === null ? null : pos - neg;
}

export interface ConvergenceReport {
  actor_id: string;
  n_events: number;
  auc: number | null;
  precision_at_k: { k: number; value: number | null };
  score_separation: number | null;
  vector_change: number;
  learning_stability_index: number | null;
  converged: boolean; // AUC >= MATCH_AUC_VALID_THRESHOLD (IND-08: "0.7以上で有効")
}

/**
 * Convergence evaluation (IND-08). vector_change = magnitude of the LAST update
 * step (alpha*|y|*||x||); learning_stability_index = 1 - coefficient_of_variation
 * of all update-step magnitudes (1=perfectly uniform steps, 0=high variance),
 * null when fewer than 2 events (undefined variance). Deterministic pure fn of
 * Truth — no resident evaluation state, no GPU, O(events + distinct items).
 */
export async function projectMatchConvergence(s: TruthStore, actorId: string, k = 5): Promise<ConvergenceReport> {
  const events = await orderedPreferenceEvents(s, actorId);
  const w = await projectPreferenceWeights(s, actorId);
  const items = await labeledItems(s, actorId);
  // precision@K是正(uib02think §4-2 D2「壊れるもの③」): y=0(pairwiseのneither)は正例でも
  // 負例でもないため Precision@K の分母Kから除外する(除外しないとneither多用ユーザーの
  // 数値が不当に下がる)。auc()/scoreSeparation は元々 y>0/y<0 のみを見て y=0 を無視するため、
  // ここで scored からy=0を落としても両者の出力は変わらない(壊れない)。
  const scored = items.filter((it) => it.y !== 0).map((it) => ({ score: dot(w, it.features), y: it.y }));

  const stepMagnitudes = events.map((e) => LEARNING_RATE * Math.abs(e.y) * Math.sqrt(e.features.reduce((s2, v) => s2 + v * v, 0)));
  const vectorChange = stepMagnitudes.length ? stepMagnitudes[stepMagnitudes.length - 1] : 0;
  let stability: number | null = null;
  if (stepMagnitudes.length >= 2) {
    const m = avg(stepMagnitudes)!;
    const variance = stepMagnitudes.reduce((s2, x) => s2 + (x - m) ** 2, 0) / stepMagnitudes.length;
    stability = m > 0 ? Math.max(0, 1 - Math.sqrt(variance) / m) : 1;
  }

  const aucValue = auc(scored);
  return {
    actor_id: actorId,
    n_events: events.length,
    auc: aucValue,
    precision_at_k: { k: Math.min(k, scored.length), value: precisionAtK(scored, k) },
    score_separation: scoreSeparation(scored),
    vector_change: vectorChange,
    learning_stability_index: stability,
    converged: aucValue !== null && aucValue >= MATCH_AUC_VALID_THRESHOLD,
  };
}

// ── routes ─────────────────────────────────────────────────────────────────────

// POST /match/preference — append one preference_event (IND-07). kind/y/features
// shape is enforced by match-preference schema (kind enum, y∈{1,-1,0}, number[]).
matchRoutes.post("/match/preference", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const data: Record<string, unknown> = {
    pref_id: ulid(),
    actor_id: actorId,
    item_id: body.item_id,
    kind: body.kind,
    y: body.y,
    features: body.features,
    created_at: typeof body.created_at === "string" ? body.created_at : new Date().toISOString(),
  };
  // D2拡張(uib02think §4-2): pair_id は任意(過去イベント互換のため required に入れない)。
  // body に無ければ data にも含めない(既存 swipe/pass/valuecheck の形をそのまま維持)。
  if (typeof body.pair_id === "string") data.pair_id = body.pair_id;
  const key = `truth/${MATCH_TYPE}/${actorId}-${String(data.pref_id)}.json`;
  const res = await store(c).putEventAt(key, envelope(actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_PREFERENCE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_PREFERENCE", key: res.key }, 409);
  return c.json({ pref_id: data.pref_id, kind: data.kind }, 201);
});

// GET /match/ranking — actor's candidate pool ranked by learned preference weights
// (IND-07). Inner-product descending; score is NOT part of the response.
// ★V3-IND-09①(design35実測: match-routes.ts が実装先の再配属先=このレーンの担当。
// 実装先は既にこのルートが担う「価値観に近いおすすめ個体が並ぶ」画面のデータ源)。
// UX要件の「進捗チップ」「空状態時の②誘導」に必要な最小限の投影だけを追加する
// (画面のレイアウト/導線自体はscreen-defs側=本レーンglob外)。
matchRoutes.get("/match/ranking", async (c) => {
  const actorId = c.get("actorId");
  const s = store(c);
  const w = await projectPreferenceWeights(s, actorId);
  const pool = await candidatePool(s, actorId);
  const ranking = rankByPreference(w, pool);
  // IND-09「進捗チップ」= valuecheck数(※pairwiseとは別物・ADR-H-02。pairwiseラウンド数は
  // pair_id distinctで数える) / 打ち切り目安N。
  // 「空状態時の②誘導」= 候補0件ならUIが②(Pairwise比較)へ誘導する判断材料。
  const answeredValuecheck = (await s.listEvents(`truth/${MATCH_TYPE}/${actorId}-`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId && d.kind === "valuecheck").length;
  return c.json({
    actor_id: actorId,
    ranking,
    progress: { answered: answeredValuecheck, target: IND09_PAIRWISE_QUESTION_TARGET },
    suggest_pairwise: ranking.length === 0,
  });
});

// GET /match/convergence — evaluation log (Precision@K/AUC/score separation/
// vector change/learning stability), reconstructed from the append-only
// preference_event history (IND-08). ?k= overrides the Precision@K cutoff.
matchRoutes.get("/match/convergence", async (c) => {
  const actorId = c.get("actorId");
  const kParam = Number(c.req.query("k"));
  const k = Number.isInteger(kParam) && kParam > 0 ? kParam : 5;
  return c.json(await projectMatchConvergence(store(c), actorId, k));
});

// ── V3-UIX-22/23/79 pairwise 入力(uib02think §5-2) ──────────────────────────

// distinct pair_id among this actor's kind="pairwise" events = 回答済みラウンド数
// (V3-UIX-79「preference_eventから決定論的に再構築できる」)。/match/ranking の
// progress.answered(=valuecheck数)とは別物(ADR-H-02)なので混ぜない。
async function pairwiseRoundsAnswered(s: TruthStore, actorId: string): Promise<number> {
  const rows = (await s.listEvents(`truth/${MATCH_TYPE}/${actorId}-`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId && d.kind === "pairwise" && typeof d.pair_id === "string");
  return new Set(rows.map((d) => d.pair_id)).size;
}

// GET /match/pair — 次に出す2個体を返す(uib02think §5-2①)。features はクライアント
// に渡さない(既存 /match/ranking が features を伏せているのと同じ理由・IND-07)。
// ペア選択は第1版=決定論的順送り: 個体マスタをID(ULID=作成時刻順)昇順に並べ、
// round n → items[2n], items[2n+1]。情報量最大化(active learning)は次の波。
// ★既存 candidatePool(actorが既に評価済みのitemのみ返す)を流用してはいけない
// — 新規ユーザーでは常に0件になり入口として機能しない(uib02think §5-2①指示)。
matchRoutes.get("/match/pair", async (c) => {
  const actorId = c.get("actorId");
  const s = store(c);
  const round = await pairwiseRoundsAnswered(s, actorId);
  const target = IND09_PAIRWISE_QUESTION_TARGET;
  const masterIds = (await s.listEvents(`truth/${MASTER_TYPE}/`))
    .map((e) => String(dataOf(e).individual_id ?? ""))
    .filter(Boolean)
    .sort();
  const leftId = masterIds[round * 2];
  const rightId = masterIds[round * 2 + 1];
  if (!leftId || !rightId) {
    return c.json({ round, target, exhausted: true });
  }
  const [leftCard, rightCard] = await Promise.all([projectBioCard(s, leftId), projectBioCard(s, rightId)]);
  const toPairItem = (itemId: string, card: Awaited<ReturnType<typeof projectBioCard>>) => ({
    item_id: itemId,
    species: card?.species ?? null,
    feature_tags: card?.feature_tags ?? [],
    latest_size: card?.latest_size ?? null,
    thumbnail_path: card?.thumbnail_path ?? null,
    photo_conditions: card?.photo_conditions ?? null,
  });
  return c.json({
    pair_id: ulid(),
    round,
    target,
    left: toPairItem(leftId, leftCard),
    right: toPairItem(rightId, rightCard),
    exhausted: false,
  });
});

// POST /match/pair-choice — 1ラウンドを記録する(uib02think §5-2②)。features は
// クライアントに送らせず、サーバが projectBioCard から computeMatchFeatures で
// 自分で組み立てる。同一 pair_id を持つ preference_event を2件 append する(D2拡張・
// G79-1)。neither(y=0)の個体は候補プールから除外しない(uib02think §7-3裁定 —
// 「甲乙つけがたい」であって「嫌い」ではないため。GET /match/pair は毎回マスタ全体
// から機械的に順送りするので、この判断はそもそも候補プール絞り込みを行わない設計
// (§5-2①)と整合する)。
// 冪等性: 書き込みキーを pair_id から決定論的に導出するため、同一 pair_id の二重
// 送信は2件目が TruthStore の put-if-absent により自然に409で弾かれる。
matchRoutes.post("/match/pair-choice", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const s = store(c);
  const pairId = typeof body.pair_id === "string" ? body.pair_id : "";
  const leftItemId = typeof body.left_item_id === "string" ? body.left_item_id : "";
  const rightItemId = typeof body.right_item_id === "string" ? body.right_item_id : "";
  const choice = body.choice;
  if (
    !pairId ||
    !leftItemId ||
    !rightItemId ||
    (choice !== "left" && choice !== "right" && choice !== "neither")
  ) {
    return c.json({ error: "INVALID_PAIR_CHOICE" }, 400);
  }
  const [leftY, rightY]: [number, number] =
    choice === "left" ? [1, -1] : choice === "right" ? [-1, 1] : [0, 0];
  const [leftCard, rightCard] = await Promise.all([projectBioCard(s, leftItemId), projectBioCard(s, rightItemId)]);
  const now = new Date().toISOString();
  const sides: { side: "left" | "right"; itemId: string; y: number; card: Awaited<ReturnType<typeof projectBioCard>> }[] = [
    { side: "left", itemId: leftItemId, y: leftY, card: leftCard },
    { side: "right", itemId: rightItemId, y: rightY, card: rightCard },
  ];
  for (const w of sides) {
    const prefId = `${pairId}-${w.side}`;
    const features = computeMatchFeatures(w.card?.feature_tags ?? [], w.card?.latest_size ?? null);
    const data: Record<string, unknown> = {
      pref_id: prefId,
      actor_id: actorId,
      item_id: w.itemId,
      kind: "pairwise",
      y: w.y,
      features,
      features_version: MATCH_FEATURES_VERSION,
      pair_id: pairId,
      created_at: now,
    };
    const key = `truth/${MATCH_TYPE}/${actorId}-${prefId}.json`;
    const res = await s.putEventAt(key, envelope(actorId, data));
    if (res.status === "invalid") return c.json({ error: "INVALID_PAIR_CHOICE", details: res.errors }, 400);
    if (res.status === "conflict") return c.json({ error: "DUPLICATE_PAIR_CHOICE", key: res.key }, 409);
  }
  return c.json({ pair_id: pairId, recorded: true }, 201);
});
