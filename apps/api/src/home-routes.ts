// C5 K1 ホーム/insight + 観測スケジュール API (design-k1 §1.1/§1.4 / V3-OBS-21/43).
// PROTECTED (index.ts §1.5 gate). schedule は append-only ihl.obs.schedule.v1;
// next_observation_at は computeNextObservationAt(SCHEDULE_STAGE_INTERVAL_DAYS) から。
// home/summary と insights は Truth を都度 list して再計算する純投影(常駐 DB 禁止・
// 不変条項①)。cron 常駐ポーリング(OBS-28)は人間ゲート — ここは config/schedule
// イベントのみで、Cron 起動はしない。envelope/store/dataOf は projectLedger 前例に
// 倣いインライン(批評家#3)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { SCHEDULE_STAGE_INTERVAL_DAYS } from "./observation-constants";
import { projectJudicialInboxPreview } from "./gov-routes";

export const homeRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const SCHEDULE_TYPE = "ihl.obs.schedule.v1";
const SCHEDULE_SCHEMA = "schemas/events/obs-schedule.schema.json";
const MASTER_TYPE = "ihl.ind.master.v1";
const CAPTURE_TYPE = "ihl.obs.capture.v1";

// 近接(近い将来に観測が来る)の窓。now..now+3日 を「近接」、それより先を「観測中」と
// する分類の閾値。ponytail: 家庭運用の調整ノブ。運用実績で伸縮するなら定数化を昇格。
const HOME_NEAR_WINDOW_DAYS = 3;
const DAY_MS = 86_400_000;

// V3-GOV-11: ホームの司法インボックスプレビュー(最大5件)・環境IoT due予定プレビュー
// (最大3件)。審理・投票本体は司法FeatureNode(/gov/disputes/*)へ委譲し、ホームは
// プレビューのみを持つ(重複実装しない)。
const HOME_JUDICIAL_INBOX_LIMIT = 5;
const HOME_IOT_DUE_LIMIT = 3;

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
    type: SCHEDULE_TYPE,
    time: new Date().toISOString(),
    dataschema: SCHEDULE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

/**
 * 次回観測時刻を算出(純関数・決定論)。間隔は template.stage_interval_days[stage] が
 * あれば優先、無ければ frozen 定数 SCHEDULE_STAGE_INTERVAL_DAYS[stage]。stage が
 * どちらにも無い / from が不正なら null(呼び出し側で 400)。cron ではなく単発計算。
 */
export function computeNextObservationAt(
  template: { stage_interval_days?: Record<string, number> } | null | undefined,
  stage: string,
  from: Date | string,
): string | null {
  const days =
    template?.stage_interval_days?.[stage] ??
    (SCHEDULE_STAGE_INTERVAL_DAYS as Record<string, number>)[stage];
  if (typeof days !== "number" || !Number.isFinite(days)) return null;
  const base = typeof from === "string" ? new Date(from) : from;
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + days * DAY_MS).toISOString();
}

// 個体ごとの「現在の」スケジュール = 最新の schedule イベント(created_at→schedule_id
// で決定論 tie-break)。append-only なので過去分は保持しつつ最新のみを状態とみなす。
function latestSchedulePerIndividual(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const sorted = rows.slice().sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
    String(a.schedule_id ?? "").localeCompare(String(b.schedule_id ?? "")),
  );
  const latest = new Map<string, Record<string, unknown>>();
  for (const d of sorted) latest.set(String(d.individual_id), d); // 後勝ち = 最新
  return latest;
}

function scheduleView(d: Record<string, unknown>) {
  return {
    individual_id: d.individual_id,
    schedule_id: d.schedule_id,
    next_observation_at: d.next_observation_at,
    stage: d.stage ?? null,
    template_id: d.template_id ?? null,
  };
}

/**
 * ホーム今日の要約(OBS-21): 本人の最新スケジュールを now 基準で分類。
 *  - overdue(超過): next < now
 *  - near(近接):   now ≤ next ≤ now + HOME_NEAR_WINDOW_DAYS
 *  - observing(観測中): next がそれより先(予定済みだが今は差し迫っていない)
 * 都度再計算・決定論(next_observation_at→individual_id で安定ソート)。
 */
export async function projectHomeSummary(
  s: TruthStore,
  actorId: string,
  now: Date = new Date(),
): Promise<{
  overdue: ReturnType<typeof scheduleView>[];
  near: ReturnType<typeof scheduleView>[];
  observing: ReturnType<typeof scheduleView>[];
}> {
  const rows = (await s.listEvents(`truth/${SCHEDULE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId); // 本人スコープ
  const latest = latestSchedulePerIndividual(rows);
  const nowMs = now.getTime();
  const nearMs = nowMs + HOME_NEAR_WINDOW_DAYS * DAY_MS;
  const overdue: Record<string, unknown>[] = [];
  const near: Record<string, unknown>[] = [];
  const observing: Record<string, unknown>[] = [];
  for (const d of latest.values()) {
    const t = Date.parse(String(d.next_observation_at));
    if (Number.isNaN(t)) continue;
    if (t < nowMs) overdue.push(d);
    else if (t <= nearMs) near.push(d);
    else observing.push(d);
  }
  const byNext = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    String(a.next_observation_at).localeCompare(String(b.next_observation_at)) ||
    String(a.individual_id).localeCompare(String(b.individual_id));
  return {
    overdue: overdue.sort(byNext).map(scheduleView),
    near: near.sort(byNext).map(scheduleView),
    observing: observing.sort(byNext).map(scheduleView),
  };
}

/**
 * 決定論の空白検出(OBS-43): 仮説生成/引用ネットワーク(LLM 依存)は後波。ここでは
 *  - overdue: 最新スケジュールの next < now の個体
 *  - missing_observation: master はあるが capture(subject_ref=individual/<id>)が 0 件の個体
 * のみを列挙する。Truth を都度 list して再計算(常駐 index なし)。
 */
export async function projectInsightGaps(
  s: TruthStore,
  now: Date = new Date(),
): Promise<{
  overdue: { individual_id: string; next_observation_at: unknown; schedule_id: unknown }[];
  missing_observation: { individual_id: string }[];
}> {
  const nowMs = now.getTime();
  const schedules = (await s.listEvents(`truth/${SCHEDULE_TYPE}/`)).map(dataOf);
  const latest = latestSchedulePerIndividual(schedules);
  const overdue = [...latest.values()]
    .filter((d) => {
      const t = Date.parse(String(d.next_observation_at));
      return !Number.isNaN(t) && t < nowMs;
    })
    .map((d) => ({
      individual_id: String(d.individual_id),
      next_observation_at: d.next_observation_at,
      schedule_id: d.schedule_id,
    }))
    .sort((a, b) => a.individual_id.localeCompare(b.individual_id));

  // 観測欠落: master を列挙し、capture に一度も現れない個体。capture は全走査 1 回で
  // subject_ref 集合を作る(個体数×capture の二重走査を避ける)。
  const masters = (await s.listEvents(`truth/${MASTER_TYPE}/`)).map(dataOf);
  const observed = new Set(
    (await s.listEvents(`truth/${CAPTURE_TYPE}/`))
      .map(dataOf)
      .map((d) => String(d.subject_ref ?? "")),
  );
  const missing_observation = masters
    .map((m) => String(m.individual_id))
    .filter((id) => id && !observed.has(`individual/${id}`))
    .sort((a, b) => a.localeCompare(b))
    .map((individual_id) => ({ individual_id }));

  return { overdue, missing_observation };
}

// ── routes ─────────────────────────────────────────────────────────────────────

// POST /observation/schedule — INSERT one observation schedule (OBS-21). The next
// time is computed by computeNextObservationAt(template, stage, from); an unknown
// stage (no interval in template nor the frozen constant) → 400. actor_id is the
// session principal (V3-AUT-17). Cron 起動はしない(人間ゲート・停止報告)。
homeRoutes.post("/observation/schedule", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.individual_id !== "string" || !body.individual_id) {
    return c.json({ error: "INVALID_BODY" }, 400);
  }
  const stage = typeof body.stage === "string" ? body.stage : "";
  const from = typeof body.from === "string" ? body.from : new Date().toISOString();
  const template = (typeof body.template === "object" && body.template) as
    | { stage_interval_days?: Record<string, number> }
    | null;
  const nextAt = computeNextObservationAt(template, stage, from);
  if (nextAt === null) return c.json({ error: "INVALID_STAGE" }, 400);

  const actorId = c.get("actorId");
  const scheduleId = ulid();
  const data: Record<string, unknown> = {
    schedule_id: scheduleId,
    individual_id: body.individual_id,
    next_observation_at: nextAt,
    actor_id: actorId,
    created_at: new Date().toISOString(),
  };
  if (stage) data.stage = stage;
  if (typeof body.template_id === "string") data.template_id = body.template_id;

  const key = `truth/${SCHEDULE_TYPE}/${body.individual_id}-${scheduleId}.json`;
  const res = await store(c).putEventAt(key, envelope(actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_SCHEDULE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_SCHEDULE", key: res.key }, 409);
  return c.json({ schedule_id: scheduleId, next_observation_at: nextAt }, 201);
});

// GET /home/summary — today's summary (OBS-21): near / overdue / observing。V3-GOV-11:
// 司法インボックスのプレビュー(最大5件)+ 環境IoT due予定のプレビュー(最大3件・既存の
// overdue→near 順で切り詰め=環境観測スケジュールの再利用・二重実装しない)を追加。
homeRoutes.get("/home/summary", async (c) => {
  const s = store(c);
  const actorId = c.get("actorId");
  const [summary, judicial_inbox] = await Promise.all([
    projectHomeSummary(s, actorId),
    projectJudicialInboxPreview(s, actorId, HOME_JUDICIAL_INBOX_LIMIT),
  ]);
  const iot_due = [...summary.overdue, ...summary.near].slice(0, HOME_IOT_DUE_LIMIT);
  return c.json({ ...summary, judicial_inbox, iot_due });
});

// GET /observation/insights — deterministic gap detection (OBS-43): overdue
// individuals + individuals with a master record but zero observations. LLM-driven
// hypothesis/citation generation is a later 波 (design §5).
homeRoutes.get("/observation/insights", async (c) => {
  const gaps = await projectInsightGaps(store(c));
  return c.json(gaps);
});
