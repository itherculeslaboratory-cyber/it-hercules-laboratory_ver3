// C7 スライス2 一括保存API (V3-AIP-101 wireframes-core5 §F4/F5「まとめて記録」)。
// PROTECTED — index.ts §1.5 gates it and sets actorId. Truth is append-only:
// there is NO transaction/rollback — each item is committed independently and
// the per-item result {ok, id?|error?} reports partial failure honestly
// (部分失敗を隠さない). Every item kind reuses the SAME validation gate as its
// standalone route (extracted functions — コピペ二重化しない):
//   capture      → observation-routes.writeCaptureFromCommitBody (亜種確定禁止+value_origin)
//   life-event   → individual-routes.writeLifeEvent
//   clutch-event → clutch-routes.writeClutchEvent (recount/attrition のみ・超過ゲート込み)
//   move         → source-routes.moveOccupancy (旧placementのend(あれば)+新placementのstartを束ねる)
import { Hono } from "hono";
import { TruthStore, type R2BucketLite } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { writeCaptureFromCommitBody } from "./observation-routes";
import { writeLifeEvent } from "./individual-routes";
import { writeClutchEvent } from "./clutch-routes";
import { moveOccupancy } from "./source-routes";

export const batchCommitRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export const BATCH_MAX_ITEMS = 200;

type BatchResult = { ok: true; id: string } | { ok: false; error: string };

async function commitOne(
  bucket: R2BucketLite,
  s: TruthStore,
  actorId: string,
  item: Record<string, unknown>,
): Promise<BatchResult> {
  const kind = item.kind;
  const body = (item.body ?? {}) as Record<string, unknown>;

  if (kind === "capture") {
    const r = await writeCaptureFromCommitBody(s, actorId, body);
    return r.ok ? { ok: true, id: r.capture_id } : { ok: false, error: r.error };
  }

  if (kind === "life-event") {
    const individualId = item.individual_id;
    if (typeof individualId !== "string" || !individualId) return { ok: false, error: "INVALID_ITEM" };
    const r = await writeLifeEvent(s, actorId, individualId, body);
    return r.ok ? { ok: true, id: individualId } : { ok: false, error: r.error };
  }

  if (kind === "clutch-event") {
    const clutchId = item.clutch_id;
    if (typeof clutchId !== "string" || !clutchId) return { ok: false, error: "INVALID_ITEM" };
    const r = await writeClutchEvent(s, actorId, clutchId, body);
    return r.ok ? { ok: true, id: r.event_id } : { ok: false, error: r.error };
  }

  if (kind === "move") {
    const subjectRef = item.subject_ref;
    const toPlacementId = item.to_placement_id;
    const at = typeof item.at === "string" && item.at ? item.at : new Date().toISOString();
    if (typeof subjectRef !== "string" || !subjectRef) return { ok: false, error: "INVALID_ITEM" };
    if (typeof toPlacementId !== "string" || !toPlacementId) return { ok: false, error: "INVALID_ITEM" };
    const r = await moveOccupancy(bucket, actorId, subjectRef, toPlacementId, at);
    return { ok: true, id: r.occupancy_id };
  }

  return { ok: false, error: "UNKNOWN_KIND" };
}

// POST /observation/batch-commit — F4「まとめて記録」/F5 一括確認の保存経路。
// body: { items: [{kind, body, individual_id?, clutch_id?, subject_ref?, to_placement_id?, at?}] }
// 上限 items 200。逐次処理・per-item {ok,id}|{ok:false,error} を配列で返す。
batchCommitRoutes.post("/observation/batch-commit", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const items = Array.isArray(body?.items) ? (body!.items as Record<string, unknown>[]) : null;
  if (!items) return c.json({ error: "INVALID_BODY" }, 400);
  if (items.length > BATCH_MAX_ITEMS) return c.json({ error: "TOO_MANY_ITEMS", max: BATCH_MAX_ITEMS }, 400);

  const actorId = c.get("actorId");
  const bucket = c.env.TRUTH;
  const s = new TruthStore(bucket);
  const results: BatchResult[] = [];
  for (const item of items) {
    results.push(await commitOne(bucket, s, actorId, item));
  }
  return c.json({ results }, 200);
});
