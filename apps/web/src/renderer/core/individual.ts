// renderer分割Phase 2b裁定(g85-split2a-ruling §3 #6)によりここへ一本化。
// 元定義: renderer.tsx:5020-5102(型/measureValue/seriesFor/isDegenerate)・
// :5376-5403(collectAncestors/inbreedingCoefficient/inbreedingTone)・
// :5662-5691(TimelineEntry/buildTimeline)。利用元はzones/ind-profile.tsx(Z3)
// とzones/ind-screens.tsx(Z9)の両方(zone→zone importを作らないためcoreへ集約)。
// LIFE_ICON/LIFE_LABEL_JAはZ3専用表示語のためここへは移さない(Z9は自前の
// switch文で表示語を持つ)。CHART_UNITS等のgrowth-chart表示定数もZ3専用。
import { safeLabel } from "./scope";

export type ProfileMeasurement = { item: string; kind: string; value: number | string; unit?: string };
export type ProfileCapture = {
  capture_id: string;
  time: string;
  measurements?: ProfileMeasurement[];
  photo_id?: string | null;
  thumbnail_path?: string | null;
};
export type ProfileLifeEvent = { individual_id: string; kind: string; at: string; detail?: Record<string, unknown> };
export type ProfileParentRef = { individual_id: string; label: string };
export type ProfileSibling = ProfileParentRef & { dead: boolean; eclosed: boolean };
export type IndividualProfile = {
  individual_id: string;
  master: { local_label_text?: string; species?: string } | null;
  name: string | null;
  species: string | null;
  stage: string | null;
  status: "alive" | "deceased";
  thumbnail_path: string | null;
  placement_id: string | null;
  schedule: { next_observation_at: string } | null;
  parents: { sire?: ProfileParentRef; dam?: ProfileParentRef };
  siblings: ProfileSibling[];
  children: ProfileParentRef[];
  observations: ProfileCapture[];
  life_events: ProfileLifeEvent[];
  parent_observations: { sire: ProfileCapture[]; dam: ProfileCapture[] };
  cohort_observations: { individual_id: string; capture_id: string; weight_g: number | null; length_mm: number | null }[];
};
export type PedNode = {
  individual_id: string;
  known: boolean;
  parent_role?: string;
  circular?: boolean;
  truncated?: boolean;
  parents: PedNode[];
};

export function profileLabel(profile: IndividualProfile): string {
  const raw = profile.master?.local_label_text || profile.name || profile.individual_id;
  return safeLabel(raw, profile.species);
}

// Same string-tolerant coercion as latestMeasurement() below: a capture's
// measurement value is schema-typed number|string (obs-capture.schema.json),
// and template-interpolated writes (obs-register-confirm.json's static
// "{{params.weight_g}}") always produce a string. A strict typeof==="number"
// filter here would silently drop every such capture from the growth chart
// and timeline delta — coerce instead of filtering out valid string values.
export function measureValue(cap: ProfileCapture, item: string): number | null {
  const m = (cap.measurements ?? []).find((mm) => mm.item === item);
  if (!m) return null;
  const n = typeof m.value === "number" ? m.value : Number(m.value);
  return Number.isFinite(n) ? n : null;
}

// 系列(x=経過時間[日]・系列ごとに自分の初回観測を0とする・y=値)。実観測間隔
// (envelope time)を反映するので3ヶ月間隔と3日間隔が同じ幅に見えない(ユーザー
// 裁定2026-07-12)。時刻無効/値無しの行は無視。
// ponytail: E2E seed のようにループ内で連続 POST して全点が数秒未満(ミリ秒差)
// に縮退する場合だけ観測順の等間隔にフォールバックする(degenerate は呼び出し
// 側が本個体+親♂+親♀の合算レンジで判定・実運用は日〜月オーダーの間隔が付く
// ので起きない)。
export function seriesFor(
  caps: ProfileCapture[],
  item: string,
  degenerate: boolean,
): { x: number; y: number; iso: string }[] {
  const pts = caps
    .map((c) => ({ t: Date.parse(c.time), y: measureValue(c, item), iso: c.time }))
    .filter((pt): pt is { t: number; y: number; iso: string } => Number.isFinite(pt.t) && pt.y != null)
    .sort((a, b) => a.t - b.t);
  if (pts.length === 0) return [];
  const t0 = pts[0].t;
  return pts.map((pt, i) => ({ x: degenerate ? i : (pt.t - t0) / 86_400_000, y: pt.y, iso: pt.iso }));
}

// 本個体+親♂+親♀を合算した実時刻レンジが1分未満なら「ミリ秒差で縮退」とみなす
// (E2E seed 判定用の閾値。実運用の採取間隔は最短でも時間〜日オーダー)。
export function isDegenerate(seriesCaps: ProfileCapture[][]): boolean {
  const ts = seriesCaps.flat().map((c) => Date.parse(c.time)).filter((t) => Number.isFinite(t));
  return ts.length > 1 && Math.max(...ts) - Math.min(...ts) < 60_000;
}

export function collectAncestors(node: PedNode | undefined, depth: number, out: { id: string; depth: number }[]): void {
  if (!node || !node.known) return;
  out.push({ id: node.individual_id, depth });
  if (depth >= 3) return;
  for (const parent of node.parents ?? []) collectAncestors(parent, depth + 1, out);
}
export function inbreedingCoefficient(pedigree: PedNode | null): number | null {
  if (!pedigree) return null;
  const sireNode = pedigree.parents?.find((n) => n.parent_role === "sire");
  const damNode = pedigree.parents?.find((n) => n.parent_role === "dam");
  if (!sireNode?.known || !damNode?.known) return null;
  const sireAnc: { id: string; depth: number }[] = [];
  const damAnc: { id: string; depth: number }[] = [];
  collectAncestors(sireNode, 0, sireAnc);
  collectAncestors(damNode, 0, damAnc);
  let f = 0;
  for (const d of damAnc) for (const s of sireAnc) if (s.id === d.id) f += Math.pow(0.5, s.depth + d.depth + 1);
  return f;
}

export function inbreedingTone(f: number): { symbol: string; word: string } {
  if (f < 0.0625) return { symbol: "●", word: "低" };
  if (f < 0.125) return { symbol: "▲", word: "中" };
  return { symbol: "⚠", word: "高" };
}

export type TimelineEntry =
  | { kind: "capture"; at: number; atIso: string; capture: ProfileCapture }
  | { kind: "life"; at: number; atIso: string; event: ProfileLifeEvent };
export function buildTimeline(profile: IndividualProfile): TimelineEntry[] {
  const caps: TimelineEntry[] = profile.observations
    .map((c) => ({ kind: "capture" as const, at: Date.parse(c.time), atIso: c.time, capture: c }))
    .filter((e) => Number.isFinite(e.at));
  const life: TimelineEntry[] = profile.life_events
    .map((e) => ({ kind: "life" as const, at: Date.parse(e.at), atIso: e.at, event: e }))
    .filter((e) => Number.isFinite(e.at));
  return [...caps, ...life].sort((a, b) => a.at - b.at);
}

// 直近の同一項目値(訂正の「記録値 X → 訂正後」表示・Δ計算の両方に使う)。
// observations は backend で capture_id(ULID)昇順=時刻順が保証されている。
// §3の表には無いが、Z3(ind-profile.tsx)とZ9(ind-screens.tsx)の両方が
// 同一定義を複製していたため(手順0の機械照合で検出)、同じ基準で一本化した。
export function prevValueFn(observations: ProfileCapture[]) {
  return (captureId: string, item: string): number | null => {
    const idx = observations.findIndex((o) => o.capture_id === captureId);
    for (let i = idx - 1; i >= 0; i--) {
      const v = measureValue(observations[i], item);
      if (v != null) return v;
    }
    return null;
  };
}
