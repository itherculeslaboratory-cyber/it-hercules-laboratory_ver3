// V3-MKT-34(アイデア・第19回裁定「あっています。100点」で救済)+ V3-MKT-67(制約・
// 第19回裁定ユーザー直筆「プラチナコインショップは基本私が用意します。ユーザーは
// 勝手に出品できません」)。年間最高傑作の標本/象徴(Symbol)は、プラチナ100枚での
// 『購入権』取得後にさらに現金(例1億円)で実物を購入する二段階制の文化的象徴
// (年1個限定発行)。購入権は先着1名が保持し、保持者のカルマが基準を下回ると自動
// 失効して再取得可能に戻る。
//
// スコープ境界(本波が実装するのはここまで): 購入権(PT建て・非金銭)の発行・購入・
// 自動失効。第2段階の現金決済(実物購入・例1億円)は「金銭の実行」そのものであり
// KICKOFF/自律ラン既定契約の人間ゲート(公開の実施・本番鍵/実鍵投入・金銭)に該当
// するため、本波では実装しない(第2段階の申告用エンドポイントは用意するが、実際の
// 課金・入金確認は payjp/gmo コネクタの人間ゲート(実鍵投入)まで到達不能)。
//
// 運営者限定(MKT-67): symbol の新規発行(年1個)は authz.ts requireRole("operator",
// "admin") で守る(gov-routes.ts POST /gov/flags と同型の既存ロール規約を再利用・
// 新しいロール名を発明しない)。
//
// [判断: 失効しきい値の出所] 「保持者のカルマが基準を下回ると自動失効」の『基準』は
// registry.json 本文に数値の記載が無い(未定係数・MKT-25/36と同種の状況)。新しい数値
// を推測で埋める代わりに、このシステムに既にある唯一のカルマ閾値=
// economy-constants.ts KARMA_BAN_THRESHOLD(V3-KRM-04永久BAN基準・-100)を『基準』
// として再利用した(新規の数値を発明していない・BANされる=保持資格を失う、という
// 解釈は自然で他の基準より恣意性が低い)。ここは判断が要った箇所として報告書に明記。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { requireRole } from "./authz";
import { projectLedger } from "./ledger-routes";
import { listPtEvents } from "./contribution";
import { KARMA_BAN_THRESHOLD } from "./economy-constants";

const SYMBOL_TYPE = "ihl.mkt.platinum_symbol.v1";
const SYMBOL_SCHEMA = "schemas/events/mkt-platinum-symbol.schema.json";
const RIGHT_TYPE = "ihl.mkt.platinum_symbol_right.v1";
const RIGHT_SCHEMA = "schemas/events/mkt-platinum-symbol-right.schema.json";
const SCHEMA_VERSION = "1";
const PURCHASE_RIGHT_PRICE_PT = 100; // V3-MKT-34 本文の固定額(裁定「あっています」で確定済み・係数ではない)

export const marketPlatinumSymbolRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

interface SymbolEvent {
  symbol_id: string;
  actor_id: string;
  year: number;
  name: string;
  created_at: string;
}
interface RightEvent {
  event_id: string;
  symbol_id: string;
  actor_id: string;
  kind: "acquire" | "forfeit" | "cash_purchase_declared";
  created_at: string;
}

async function listSymbols(s: TruthStore): Promise<SymbolEvent[]> {
  return (await s.listEvents(`truth/${SYMBOL_TYPE}/`)).map(dataOf) as unknown as SymbolEvent[];
}
async function listRightEvents(s: TruthStore, symbolId: string): Promise<RightEvent[]> {
  return (await s.listEvents(`truth/${RIGHT_TYPE}/${symbolId}-`)).map(dataOf) as unknown as RightEvent[];
}

/** 現在の保持者(先着1名・forfeit未発行のacquireの直近1件)。 */
function currentHolder(events: RightEvent[]): RightEvent | undefined {
  const sorted = [...events].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  let holder: RightEvent | undefined;
  for (const e of sorted) {
    if (e.kind === "acquire") holder = e;
    else if (e.kind === "forfeit" && holder?.actor_id === e.actor_id) holder = undefined;
  }
  return holder;
}

// POST /market/platinum-symbols — 運営者限定・年1個(既に同年の symbol が有れば409)。
marketPlatinumSymbolRoutes.post("/market/platinum-symbols", requireRole("operator", "admin"), async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const year = Number(body?.year);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!Number.isInteger(year) || !name) {
    return c.json({ error: "INVALID_SYMBOL", details: ["year(integer) and name required"] }, 400);
  }
  const s = store(c);
  const existing = await listSymbols(s);
  if (existing.some((sym) => sym.year === year)) {
    return c.json({ error: "DUPLICATE_YEAR", details: ["1 symbol per year"] }, 409);
  }
  const actorId = c.get("actorId");
  const id = ulid();
  const data: Record<string, unknown> = {
    symbol_id: id,
    actor_id: actorId,
    year,
    name,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  await s.putEventAt(`truth/${SYMBOL_TYPE}/${id}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: SYMBOL_TYPE,
    time: new Date().toISOString(),
    dataschema: SYMBOL_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
  return c.json({ symbol_id: id, year, name }, 201);
});

// GET /market/platinum-symbols — 一覧(保持者の read-time 自己修復込み)。
marketPlatinumSymbolRoutes.get("/market/platinum-symbols", async (c) => {
  const s = store(c);
  const symbols = await listSymbols(s);
  const out = [];
  for (const sym of symbols) {
    const events = await listRightEvents(s, sym.symbol_id);
    const holder = await settleForfeiture(s, sym.symbol_id, events);
    out.push({ symbol_id: sym.symbol_id, year: sym.year, name: sym.name, holder_actor_id: holder?.actor_id });
  }
  return c.json({ symbols: out });
});

/** 保持者のカルマが KARMA_BAN_THRESHOLD 未満なら read-time で forfeit を自己修復
 * (settleNoPayCancel と同型パターン=冪等 put-if-absent)。 */
async function settleForfeiture(s: TruthStore, symbolId: string, events: RightEvent[]): Promise<RightEvent | undefined> {
  const holder = currentHolder(events);
  if (!holder) return undefined;
  // isBanned(ledger-routes.ts)と同じ境界(<=)に揃える(BAN判定と同じ「基準」を
  // 再利用する設計判断のため、境界の向きも一致させる)。
  const ledger = await projectLedger(s, holder.actor_id);
  if (ledger.karma_value > KARMA_BAN_THRESHOLD) return holder;

  const id = ulid();
  const data: Record<string, unknown> = {
    event_id: id,
    symbol_id: symbolId,
    actor_id: holder.actor_id,
    kind: "forfeit",
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const res = await s.putEventAt(`truth/${RIGHT_TYPE}/${symbolId}-auto-forfeit-${holder.actor_id}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: RIGHT_TYPE,
    time: new Date().toISOString(),
    dataschema: RIGHT_SCHEMA,
    provenance: { generator_kind: "agent", agent_name: "platinum-symbol-forfeit" },
    data,
  });
  if (res.status !== "inserted") return holder; // 既に自己修復済み(冪等)
  return undefined;
}

// POST /market/platinum-symbols/{id}/purchase-right — 先着1名・PT>=100消費。
marketPlatinumSymbolRoutes.post("/market/platinum-symbols/:symbol_id/purchase-right", async (c) => {
  const symbolId = c.req.param("symbol_id");
  const s = store(c);
  const symbols = await listSymbols(s);
  if (!symbols.some((sym) => sym.symbol_id === symbolId)) return c.json({ error: "NOT_FOUND" }, 404);

  const events = await listRightEvents(s, symbolId);
  const holder = await settleForfeiture(s, symbolId, events);
  if (holder) return c.json({ error: "ALREADY_HELD", holder_actor_id: holder.actor_id }, 409);

  const actorId = c.get("actorId");
  const ptEvents = await listPtEvents(s, actorId);
  const balance = ptEvents.reduce((a, d) => a + (typeof d.delta === "number" ? d.delta : 0), 0);
  if (balance < PURCHASE_RIGHT_PRICE_PT) {
    return c.json({ error: "INSUFFICIENT_PT", price_pt: PURCHASE_RIGHT_PRICE_PT, balance }, 402);
  }
  // PT 消費(shop-routes.ts indulgence と同型の pt_event 追記)。
  const ptId = ulid();
  await s.putEvent({
    specversion: "1.0",
    id: ptId,
    source: "apps/api",
    type: "ihl.economy.pt_event.v1",
    time: new Date().toISOString(),
    dataschema: "schemas/events/economy-pt-event.schema.json",
    provenance: { generator_kind: "human", actor_id: actorId },
    data: {
      pt_event_id: ptId,
      actor_id: actorId,
      delta: -PURCHASE_RIGHT_PRICE_PT,
      reason_code: "manual", // economy-pt-event schema enum: indulgence_spend以外の手動消費はmanual
      created_at: new Date().toISOString(),
      schema_version: "1",
    },
  });

  const id = ulid();
  const data: Record<string, unknown> = {
    event_id: id,
    symbol_id: symbolId,
    actor_id: actorId,
    kind: "acquire",
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const res = await s.putEventAt(`truth/${RIGHT_TYPE}/${symbolId}-acquire-${actorId}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: RIGHT_TYPE,
    time: new Date().toISOString(),
    dataschema: RIGHT_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
  if (res.status === "conflict") return c.json({ error: "ALREADY_HELD" }, 409);
  return c.json({ symbol_id: symbolId, holder_actor_id: actorId, spent_pt: PURCHASE_RIGHT_PRICE_PT }, 201);
});

// GET /market/platinum-symbols/{id} — 詳細(保持者・自己修復込み)。
marketPlatinumSymbolRoutes.get("/market/platinum-symbols/:symbol_id", async (c) => {
  const symbolId = c.req.param("symbol_id");
  const s = store(c);
  const symbols = await listSymbols(s);
  const sym = symbols.find((x) => x.symbol_id === symbolId);
  if (!sym) return c.json({ error: "NOT_FOUND" }, 404);
  const events = await listRightEvents(s, symbolId);
  const holder = await settleForfeiture(s, symbolId, events);
  return c.json({ symbol_id: sym.symbol_id, year: sym.year, name: sym.name, holder_actor_id: holder?.actor_id });
});
