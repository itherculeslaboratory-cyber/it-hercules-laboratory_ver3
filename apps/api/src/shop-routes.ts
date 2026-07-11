// KRM-05 プラチナコインショップ（免罪符）。免罪符購入＝カルマカウント -1。value/Fib は
// 逆操作しない（既に引かれた値は戻さない・累犯段のみ 1 つ和らげる）。価格 PT = fib(stage)、
// stage は購入ごと +1 / UTC 暦月経過ごと -1（indulgenceStage）。カルマカウント 0 は購入不可
// （赦す罪が無い）・PT 残高不足も購入不可。全て PROTECTED・本人スコープ（V3-AUT-17）。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { appendKarma, fib, projectLedger } from "./ledger-routes";
import { PT_TYPE, indulgenceStage, listPtEvents } from "./contribution";

const PT_SCHEMA = "schemas/events/economy-pt-event.schema.json";
const SHOP_LABEL = "プラチナコインショップ"; // 用語統一（KRM-05）

export const shopRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}

function ptEnvelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: PT_TYPE,
    time: new Date().toISOString(),
    dataschema: PT_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// GET /shop/indulgence/price — 現ステージと価格（fib(stage) PT）。
shopRoutes.get("/shop/indulgence/price", async (c) => {
  const actorId = c.get("actorId");
  const stage = indulgenceStage(await listPtEvents(store(c), actorId), actorId, new Date());
  return c.json({ label: SHOP_LABEL, stage, price_pt: fib(stage), currency: "PT" });
});

// POST /shop/indulgence — 免罪符購入。カウント>0 かつ PT>=価格 のとき、PT を消費し
// カルマカウントを 1 赦す（value 層は不変）。
shopRoutes.post("/shop/indulgence", async (c) => {
  const actorId = c.get("actorId");
  const s = store(c);

  const before = await projectLedger(s, actorId);
  if (before.karma_count <= 0) {
    return c.json({ error: "NO_KARMA_TO_FORGIVE" }, 409); // 赦す罪が無い
  }

  const ptEvents = await listPtEvents(s, actorId);
  const stage = indulgenceStage(ptEvents, actorId, new Date());
  const price = fib(stage);
  const balance = ptEvents.reduce(
    (a, d) => a + (typeof d.delta === "number" ? d.delta : 0),
    0,
  );
  if (balance < price) {
    return c.json({ error: "INSUFFICIENT_PT", price_pt: price, balance }, 402);
  }

  // 1) PT 消費イベント append（-price）。
  const ptId = ulid();
  const ptRes = await s.putEvent(
    ptEnvelope(ptId, actorId, {
      pt_event_id: ptId,
      actor_id: actorId,
      delta: -price,
      reason_code: "indulgence_spend",
      created_at: new Date().toISOString(),
      schema_version: "1",
    }),
  );
  if (ptRes.status === "invalid") {
    return c.json({ error: "INVALID_PT", details: ptRes.errors }, 400);
  }

  // 2) カルマカウント -1（reason 'other'＝frozen ledger-entry enum。value 層は触らない）。
  await appendKarma(s, actorId, "count", -1, "other");

  const after = await projectLedger(s, actorId);
  return c.json(
    { ok: true, spent_pt: price, stage, karma_count: after.karma_count, karma_value: after.karma_value },
    201,
  );
});
