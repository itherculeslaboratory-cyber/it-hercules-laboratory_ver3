// C7 スライス2 クラッチ(匿名プール・count層)API (V3-AIP-101 wireframes-core5
// §F3/F4). All routes PROTECTED — index.ts §1.5 gates them and sets actorId.
// Every write stamps data.actor_id from the session principal (V3-AUT-17): a
// body-supplied actor_id is ignored, never trusted. Truth is INSERT ONLY
// (put-if-absent 409). current_count has NO resident counter — it is
// recomputed from clutch.initial_count + clutch-event history on every read
// (不変条項①・projectClutchCurrentCount below).
//
// クラッチ=匿名プール: 5mmの初令にQRは貼れない。個体IDは個別容器分割
// (promote)の瞬間に初めて発生する(F3設計注記)。
import { Hono } from "hono";
import { TruthStore, ulid, type R2BucketLite } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { subspeciesGateError } from "./observation-routes";
import { createIndividualMaster, linkParent } from "./individual-routes";

export const clutchRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const CLUTCH_TYPE = "ihl.ind.clutch.v1";
const CLUTCH_EVENT_TYPE = "ihl.ind.clutch_event.v1";
const SCHEMA = {
  clutch: "schemas/events/ind-clutch.schema.json",
  event: "schemas/events/ind-clutch-event.schema.json",
};

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function envelope(type: string, dataschema: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}
const nowIso = () => new Date().toISOString();

// ── projection: current_count (pure · recomputed on read · D7) ─────────────

/**
 * current_count = initial_count → 最新 recount を基点に、以降の attrition/
 * promote の death_count を差し引いた値(design 注記「count層を次の昇格
 * イベントまでズレたままにしない」)。ponytail: O(events) full prefix scan per
 * read, no resident counter — fine for MVP clutch volumes (同じ縮退が
 * individual/observation projection 全般に既にある)。
 */
export async function projectClutchCurrentCount(s: TruthStore, clutchId: string): Promise<number | null> {
  const clutch = await s.readEvent(`truth/${CLUTCH_TYPE}/${clutchId}.json`);
  if (!clutch) return null;
  const cd = dataOf(clutch);
  const events = (await s.listEvents(`truth/${CLUTCH_EVENT_TYPE}/${clutchId}-`))
    .map(dataOf)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.event_id).localeCompare(String(b.event_id)));

  let base = Number(cd.initial_count ?? 0);
  let startIdx = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].kind === "recount") {
      base = Number(events[i].counted ?? base);
      startIdx = i + 1; // 最新 recount 以降だけ適用(直前までの attrition/promote は基点に吸収済み)
    }
  }
  let count = base;
  for (let i = startIdx; i < events.length; i++) {
    const e = events[i];
    if (e.kind === "attrition") count -= Number(e.death_count ?? 0);
    // promote removes BOTH the promoted individuals (count層→individual層への
    // 移動そのもの) AND any death_count照合済みの差分 from the pool.
    if (e.kind === "promote") {
      const promotedCount = Array.isArray(e.promoted_individual_ids) ? e.promoted_individual_ids.length : 0;
      count -= promotedCount + Number(e.death_count ?? 0);
    }
  }
  return count;
}

/**
 * V3-IND-36 attrition 照合ビュー: count層の減少(recount/attrition)と
 * individual層の増加(promote)を突合し、水増し(discrepancy>0)・行方不明
 * (discrepancy<0)を検出する。各 recount イベントが書込時点で計算済みの
 * expected_before/discrepancy をそのまま集約するだけ(都度再計算・不変条項①・
 * 常駐カウンタなし)。
 */
export async function projectClutchReconciliation(
  s: TruthStore,
  clutchId: string,
): Promise<Record<string, unknown> | null> {
  const clutch = await s.readEvent(`truth/${CLUTCH_TYPE}/${clutchId}.json`);
  if (!clutch) return null;
  const cd = dataOf(clutch);
  const events = (await s.listEvents(`truth/${CLUTCH_EVENT_TYPE}/${clutchId}-`))
    .map(dataOf)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.event_id).localeCompare(String(b.event_id)));

  let totalPromoted = 0;
  let totalAttritionDeath = 0;
  const recountDiscrepancies: Record<string, unknown>[] = [];
  for (const e of events) {
    if (e.kind === "attrition") totalAttritionDeath += Number(e.death_count ?? 0);
    if (e.kind === "promote") {
      totalPromoted += Array.isArray(e.promoted_individual_ids) ? e.promoted_individual_ids.length : 0;
      totalAttritionDeath += Number(e.death_count ?? 0);
    }
    if (e.kind === "recount" && typeof e.discrepancy === "number") {
      recountDiscrepancies.push({
        event_id: e.event_id,
        at: e.at,
        counted: e.counted,
        expected_before: e.expected_before,
        discrepancy: e.discrepancy,
      });
    }
  }

  return {
    clutch_id: clutchId,
    initial_count: cd.initial_count,
    current_count: await projectClutchCurrentCount(s, clutchId),
    total_promoted: totalPromoted,
    total_attrition_death: totalAttritionDeath,
    recount_discrepancies: recountDiscrepancies,
    has_shortfall: recountDiscrepancies.some((r) => Number(r.discrepancy) < 0), // 行方不明疑い
    has_surplus: recountDiscrepancies.some((r) => Number(r.discrepancy) > 0), // 水増し疑い
  };
}

async function clutchView(s: TruthStore, clutchId: string): Promise<Record<string, unknown> | null> {
  const clutch = await s.readEvent(`truth/${CLUTCH_TYPE}/${clutchId}.json`);
  if (!clutch) return null;
  const currentCount = await projectClutchCurrentCount(s, clutchId);
  return { ...dataOf(clutch), current_count: currentCount };
}

// ── routes ───────────────────────────────────────────────────────────────

// POST /clutches — 割り出しで新しいクラッチを作成(F3)。亜種は candidate のまま
// 可(自動確定禁止ゲートは capture/individual と同じ規律 — subspecies_confirmed_by
// は "user" のみ)。
clutchRoutes.post("/clutches", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");

  const gateErr = subspeciesGateError(body);
  if (gateErr) return c.json({ error: gateErr }, 400);

  const initialCount = body.initial_count;
  if (typeof initialCount !== "number" || !Number.isInteger(initialCount) || initialCount < 0) {
    return c.json({ error: "INVALID_INITIAL_COUNT" }, 400);
  }
  if (typeof body.harvested_at !== "string" || !body.harvested_at) {
    return c.json({ error: "INVALID_HARVESTED_AT" }, 400);
  }

  const clutchId = typeof body.clutch_id === "string" && body.clutch_id ? body.clutch_id : ulid();
  const data: Record<string, unknown> = {
    clutch_id: clutchId,
    actor_id: actorId,
    harvested_at: body.harvested_at,
    initial_count: initialCount,
    created_at: nowIso(),
  };
  for (const k of [
    "sire_id",
    "dam_id",
    "species",
    "subspecies_candidate",
    "subspecies_confirmed_by",
    "container_label",
    "placement_id",
    "lineage_id", // V3-IND-34 複数系統並行管理タグ(promote で子個体へ継承)
  ] as const) {
    if (body[k] !== undefined) data[k] = body[k];
  }

  const res = await store(c).putEventAt(
    `truth/${CLUTCH_TYPE}/${clutchId}.json`,
    envelope(CLUTCH_TYPE, SCHEMA.clutch, actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_CLUTCH", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_CLUTCH", key: res.key }, 409);
  return c.json({ clutch_id: clutchId, initial_count: initialCount, current_count: initialCount }, 201);
});

// GET /clutches — 本人一覧。current_count は都度再計算(§1 参照)。?lineage_id=
// で複数系統並行管理(V3-IND-34)の完全一致フィルタ。
clutchRoutes.get("/clutches", async (c) => {
  const actorId = c.get("actorId");
  const lineageFilter = c.req.query("lineage_id") ?? "";
  const s = store(c);
  const rows = (await s.listEvents(`truth/${CLUTCH_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId)
    .filter((d) => !lineageFilter || d.lineage_id === lineageFilter);
  const clutches: Record<string, unknown>[] = [];
  for (const d of rows) {
    const id = String(d.clutch_id ?? "");
    if (!id) continue;
    clutches.push({ ...d, current_count: await projectClutchCurrentCount(s, id) });
  }
  clutches.sort((a, b) => String(a.clutch_id).localeCompare(String(b.clutch_id)));
  return c.json({ clutches });
});

// GET /clutches/{id} — 1件 + current_count。
clutchRoutes.get("/clutches/:id", async (c) => {
  const view = await clutchView(store(c), c.req.param("id"));
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(view);
});

// GET /clutches/{id}/reconciliation — count層⇔individual層の attrition 照合
// (水増し/行方不明検出・V3-IND-36)。
clutchRoutes.get("/clutches/:id/reconciliation", async (c) => {
  const view = await projectClutchReconciliation(store(c), c.req.param("id"));
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(view);
});

// Shared clutch-event append (recount/attrition), reused by
// POST /clutches/:id/events AND batch-commit kind:"clutch-event"
// (コピペ二重化しない — F4 行メニュー「匹数を照合」も一括保存も同じ経路)。
export async function writeClutchEvent(
  s: TruthStore,
  actorId: string,
  clutchId: string,
  body: Record<string, unknown>,
): Promise<
  { ok: true; event_id: string; discrepancy?: number } | { ok: false; error: string; details?: string[] }
> {
  const clutch = await s.readEvent(`truth/${CLUTCH_TYPE}/${clutchId}.json`);
  if (!clutch) return { ok: false, error: "NOT_FOUND" };

  const kind = body.kind;
  if (kind !== "recount" && kind !== "attrition") {
    return { ok: false, error: "INVALID_KIND" }; // promote has its own dedicated route
  }
  let expectedBefore: number | null = null;
  if (kind === "recount") {
    if (typeof body.counted !== "number" || !Number.isInteger(body.counted) || body.counted < 0) {
      return { ok: false, error: "INVALID_COUNTED" };
    }
    // V3-IND-36 attrition 照合: この recount 適用前の投影値と counted を突合し、
    // 差分を記録する(正=水増し疑い/負=行方不明疑い)。検出のみ・書込はブロックしない
    // (現場の recount は基点を自由にリセットできる運用のまま — F4)。
    expectedBefore = await projectClutchCurrentCount(s, clutchId);
  }
  if (kind === "attrition") {
    if (typeof body.death_count !== "number" || !Number.isInteger(body.death_count) || body.death_count < 0) {
      return { ok: false, error: "INVALID_DEATH_COUNT" };
    }
    const current = await projectClutchCurrentCount(s, clutchId);
    if (current !== null && body.death_count > current) return { ok: false, error: "ATTRITION_EXCEEDS_COUNT" };
  }
  if (typeof body.at !== "string" || !body.at) return { ok: false, error: "INVALID_AT" };

  const eventId = ulid();
  const data: Record<string, unknown> = {
    event_id: eventId,
    clutch_id: clutchId,
    kind,
    at: body.at,
    actor_id: actorId,
    created_at: nowIso(),
  };
  if (kind === "recount") {
    data.counted = body.counted;
    if (expectedBefore !== null) {
      data.expected_before = expectedBefore;
      data.discrepancy = Number(body.counted) - expectedBefore; // body.counted already validated as an integer above
    }
  }
  if (kind === "attrition") data.death_count = body.death_count;
  if (typeof body.note === "string") data.note = body.note;

  const res = await s.putEventAt(
    `truth/${CLUTCH_EVENT_TYPE}/${clutchId}-${eventId}.json`,
    envelope(CLUTCH_EVENT_TYPE, SCHEMA.event, actorId, data),
  );
  if (res.status === "invalid") return { ok: false, error: "INVALID_CLUTCH_EVENT", details: res.errors };
  if (res.status === "conflict") return { ok: false, error: "DUPLICATE_CLUTCH_EVENT" };
  return typeof data.discrepancy === "number"
    ? { ok: true, event_id: eventId, discrepancy: data.discrepancy }
    : { ok: true, event_id: eventId };
}

// POST /clutches/{id}/events — recount(匹数照合) / attrition(減耗照合)。
clutchRoutes.post("/clutches/:id/events", async (c) => {
  const clutchId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const r = await writeClutchEvent(store(c), actorId, clutchId, body);
  if (!r.ok) {
    const status = r.error === "NOT_FOUND" ? 404 : r.error === "DUPLICATE_CLUTCH_EVENT" ? 409 : 400;
    return c.json({ error: r.error, details: r.details }, status);
  }
  return c.json(
    { event_id: r.event_id, clutch_id: clutchId, kind: body.kind, ...(r.discrepancy !== undefined ? { discrepancy: r.discrepancy } : {}) },
    201,
  );
});

// Shared promote (個別容器へ分割・昇格) logic, reused by POST
// /clutches/:id/promote AND batch-commit kind:"promote" (コピペ二重化しない —
// F4 の即時操作も一括保存も同じ経路)。count 体の個体を individual-routes
// 相当のロジックで生成し(species/sire_id/dam_id/hatch系日付をクラッチから
// 継承)、promote イベントに promoted_individual_ids を記録する。count +
// death_count が current_count を超えるなら失敗を返す(F4 昇格ダイアログ)。
export async function promoteClutch(
  bucket: R2BucketLite,
  actorId: string,
  clutchId: string,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; individual_ids: string[]; current_count: number | null }
  | { ok: false; error: string; details?: string[]; current_count?: number | null }
> {
  const s = new TruthStore(bucket);

  const clutch = await s.readEvent(`truth/${CLUTCH_TYPE}/${clutchId}.json`);
  if (!clutch) return { ok: false, error: "NOT_FOUND" };
  const cd = dataOf(clutch);

  const count = body.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    return { ok: false, error: "INVALID_COUNT" };
  }
  const deathCount = body.death_count === undefined ? 0 : body.death_count;
  if (typeof deathCount !== "number" || !Number.isInteger(deathCount) || deathCount < 0) {
    return { ok: false, error: "INVALID_DEATH_COUNT" };
  }
  if (typeof body.at !== "string" || !body.at) return { ok: false, error: "INVALID_AT" };

  const currentCount = await projectClutchCurrentCount(s, clutchId);
  if (currentCount === null || count + deathCount > currentCount) {
    return { ok: false, error: "PROMOTE_EXCEEDS_COUNT", current_count: currentCount };
  }

  const individualIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const { individualId, res } = await createIndividualMaster(s, actorId, {
      species: typeof cd.species === "string" ? cd.species : undefined,
      birth_or_hatch_date: typeof cd.harvested_at === "string" ? cd.harvested_at : undefined,
      // V3-IND-34: 子個体は既定でクラッチの lineage_id を継承する。系統合流
      // (異なる系統の親を交配)の場合はクラッチ作成時に新しい lineage_id
      // (例 "AC")をユーザーが選んで指定する運用 — 継承ロジック自体は単純な
      // コピーのまま(合流の判断はユーザー、システムは自動判定しない)。
      lineage_id: typeof cd.lineage_id === "string" ? cd.lineage_id : undefined,
    });
    if (res.status !== "inserted") continue; // ULID衝突は事実上不到達(128bit)
    individualIds.push(individualId);
    if (typeof cd.sire_id === "string") await linkParent(s, actorId, individualId, cd.sire_id, "sire");
    if (typeof cd.dam_id === "string") await linkParent(s, actorId, individualId, cd.dam_id, "dam");
  }

  const eventId = ulid();
  const eventData: Record<string, unknown> = {
    event_id: eventId,
    clutch_id: clutchId,
    kind: "promote",
    at: body.at,
    death_count: deathCount,
    promoted_individual_ids: individualIds,
    actor_id: actorId,
    created_at: nowIso(),
  };
  const evRes = await s.putEventAt(
    `truth/${CLUTCH_EVENT_TYPE}/${clutchId}-${eventId}.json`,
    envelope(CLUTCH_EVENT_TYPE, SCHEMA.event, actorId, eventData),
  );
  if (evRes.status === "invalid") return { ok: false, error: "INVALID_CLUTCH_EVENT", details: evRes.errors };
  if (evRes.status === "conflict") return { ok: false, error: "DUPLICATE_CLUTCH_EVENT" };

  const newCount = await projectClutchCurrentCount(s, clutchId);
  return { ok: true, individual_ids: individualIds, current_count: newCount };
}

// POST /clutches/{id}/promote — 個別容器へ分割(昇格)。単発操作用の薄いルート
// (ロジック本体は promoteClutch — batch-commit と共有)。
clutchRoutes.post("/clutches/:id/promote", async (c) => {
  const clutchId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");

  const r = await promoteClutch(c.env.TRUTH, actorId, clutchId, body);
  if (!r.ok) {
    const status = r.error === "NOT_FOUND" ? 404 : r.error === "DUPLICATE_CLUTCH_EVENT" ? 409 : 400;
    const payload: Record<string, unknown> = { error: r.error };
    if (r.details !== undefined) payload.details = r.details;
    if (r.error === "PROMOTE_EXCEEDS_COUNT") payload.current_count = r.current_count;
    return c.json(payload, status);
  }
  return c.json({ individual_ids: r.individual_ids, current_count: r.current_count }, 201);
});
