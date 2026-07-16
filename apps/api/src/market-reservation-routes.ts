// V3-IND-35 割り出し予約システム(round-15 新規採番・第1波S tier)。割り出し
// (クラッチ確定)前に、親個体(♂/♀)を指定した「予約 listing」(mkt-listing.v1 の
// reservation_sire_id/reservation_dam_id、任意で reservation_min/max_apply_count=
// 応募単位のしきい値)に対し、買い手が単価・匹数を append-only 宣言する
// (ihl.mkt.reservation.v1)。割り出し完了後、出品者(＝親個体の管理者)が実匹数を
// 添えて POST .../match を叩くと、単価降順で自動マッチングし match_offer を発行
// (ihl.mkt.reservation_event.v1)。買い手は確認画面で confirm(成立)/decline(未確定)
// でき、応答期限(RESERVATION_CONFIRM_WINDOW_HOURS)超過は expire として read-time
// 自己修復する。decline/expire はいずれも V3-IND-35 の裁定どおりカルマ-1(予約するなら
// 購入する責任)。OQ-ROUTE-03(round-16 ★推奨): planned だった GET /market/transfer/
// {listing_id}・POST /market/listings/{id}/match を本機能の実装先として再設計。
// 既存の singular-buyer な mkt-transaction-event 状態機械(1 listing = 1 買い手)とは
// 別イベント型で持つ(1 予約 listing に複数買い手が同時マッチしうるため)。
// 全 route PROTECTED・actor_id はセッション principal 強制刻印(V3-AUT-17)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { isBlockedPair } from "./market-block-routes";
import { grantKarmaCountIncrease } from "./ledger-routes";
import { RESERVATION_CONFIRM_WINDOW_HOURS } from "./economy-constants";

const LISTING_TYPE = "ihl.mkt.listing.v1";
const RES_TYPE = "ihl.mkt.reservation.v1";
const RES_SCHEMA = "schemas/events/mkt-reservation.schema.json";
const RES_SCHEMA_VERSION = "1";
const RES_EVENT_TYPE = "ihl.mkt.reservation_event.v1";
const RES_EVENT_SCHEMA = "schemas/events/mkt-reservation-event.schema.json";
const RES_EVENT_SCHEMA_VERSION = "1";
const SYSTEM_RESERVATION_ACTOR = "system:reservation-match";
const HOUR_MS = 60 * 60 * 1000;

export const marketReservationRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

interface Reservation {
  reservation_id: string;
  listing_id: string;
  actor_id: string;
  desired_unit_price: number;
  desired_count: number;
  created_at: string;
}
interface ReservationEvent {
  event_id: string;
  reservation_id: string;
  listing_id: string;
  kind: "match_offer" | "confirm" | "decline" | "expire";
  actor_id: string;
  offered_count?: number;
  offered_unit_price?: number;
  rank?: number;
  expires_at?: string;
  created_at: string;
}

function reservationEnvelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: RES_TYPE,
    time: new Date().toISOString(),
    dataschema: RES_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}
function reservationEventEnvelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: RES_EVENT_TYPE,
    time: new Date().toISOString(),
    dataschema: RES_EVENT_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}
// 系統 actor(自動マッチング/応答期限超過の自己修復)。batch.ts agentProvenance() と
// 同型: generator_kind="agent" で正直に記録する(CL-02 再現性メタ)。
function systemReservationEventEnvelope(id: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: RES_EVENT_TYPE,
    time: new Date().toISOString(),
    dataschema: RES_EVENT_SCHEMA,
    provenance: { generator_kind: "agent", agent_name: "market-reservation-match" },
    data,
  };
}

function isReservationListing(listing: Record<string, unknown>): boolean {
  return typeof listing.reservation_sire_id === "string" || typeof listing.reservation_dam_id === "string";
}

// ponytail: reservation/reservation_event 型を全走査 O(n)(既存 loadTxns と同型・
// MVP 量なら十分。投影 index は別波)。
async function listReservations(s: TruthStore, listingId: string): Promise<Reservation[]> {
  const all = (await s.listEvents(`truth/${RES_TYPE}/`)).map(dataOf) as unknown as Reservation[];
  return all.filter((r) => r.listing_id === listingId);
}
async function listReservationEvents(s: TruthStore, listingId: string): Promise<ReservationEvent[]> {
  const all = (await s.listEvents(`truth/${RES_EVENT_TYPE}/`)).map(dataOf) as unknown as ReservationEvent[];
  return all.filter((e) => e.listing_id === listingId);
}
async function listReservationEventsFor(s: TruthStore, reservationId: string): Promise<ReservationEvent[]> {
  return (await s.listEvents(`truth/${RES_EVENT_TYPE}/${reservationId}-`)).map(dataOf) as unknown as ReservationEvent[];
}

/** V3-IND-35: 出品側しきい値(reservation_min/max_apply_count・任意)の範囲内か。 */
function withinApplyThreshold(r: Reservation, listing: Record<string, unknown>): boolean {
  const min = Number(listing.reservation_min_apply_count);
  const max = Number(listing.reservation_max_apply_count);
  if (Number.isFinite(min) && min >= 1 && r.desired_count < min) return false;
  if (Number.isFinite(max) && max >= 1 && r.desired_count > max) return false;
  return true;
}

/** 単価降順(同額は先着=created_at 昇順・ambiguity: registry.json V3-IND-35 の
 * 「同率タイブレーク」は詳細設計で確定要とされておりここが ponytail 暫定既定)。 */
function sortReservationsForMatching(rs: Reservation[]): Reservation[] {
  return [...rs].sort((a, b) => {
    if (a.desired_unit_price !== b.desired_unit_price) return b.desired_unit_price - a.desired_unit_price;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.reservation_id.localeCompare(b.reservation_id);
  });
}

function reservationStatus(events: ReservationEvent[]): {
  status: "pending" | "offered" | "confirmed" | "declined" | "expired";
  offer?: ReservationEvent;
} {
  const offer = events.find((e) => e.kind === "match_offer");
  if (!offer) return { status: "pending" };
  if (events.some((e) => e.kind === "confirm")) return { status: "confirmed", offer };
  if (events.some((e) => e.kind === "decline")) return { status: "declined", offer };
  if (events.some((e) => e.kind === "expire")) return { status: "expired", offer };
  return { status: "offered", offer };
}

/** 確認画面の応答期限超過を read-time 判定し、未修復ならその場で expire を
 * put-if-absent(=cron 非依存の自己修復)+ カルマ-1(V3-IND-35: 予約するなら購入
 * する責任・「確認されなかった=未確定」は decline/expire いずれも対象)。 */
async function settleReservationExpiry(
  s: TruthStore,
  reservation: Reservation,
  events: ReservationEvent[],
  now: Date,
): Promise<ReservationEvent[]> {
  const { status, offer } = reservationStatus(events);
  if (status !== "offered" || !offer?.expires_at) return events;
  if (new Date(offer.expires_at).getTime() > now.getTime()) return events;

  const id = ulid();
  const data: Record<string, unknown> = {
    event_id: id,
    reservation_id: reservation.reservation_id,
    listing_id: reservation.listing_id,
    kind: "expire",
    actor_id: SYSTEM_RESERVATION_ACTOR,
    created_at: now.toISOString(),
    schema_version: RES_EVENT_SCHEMA_VERSION,
  };
  const res = await s.putEventAt(
    `truth/${RES_EVENT_TYPE}/${reservation.reservation_id}-auto-expire.json`,
    systemReservationEventEnvelope(id, data),
  );
  if (res.status !== "inserted") return events; // 既に自己修復済み(冪等)
  await grantKarmaCountIncrease(s, reservation.actor_id, 1, "other");
  return [...events, data as unknown as ReservationEvent];
}

// POST /market/reservations — 割り出し前予約の作成(買い手)。予約 listing でない/
// 自分の listing/ブロック関係/マッチング済み(締切)は拒否。
marketReservationRoutes.post("/market/reservations", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const listingId = body && typeof body.listing_id === "string" ? body.listing_id : "";
  if (!listingId) return c.json({ error: "INVALID_RESERVATION", details: ["listing_id required"] }, 400);

  const actorId = c.get("actorId");
  const s = store(c);
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  if (!listingEv) return c.json({ error: "NOT_FOUND" }, 404);
  const listing = dataOf(listingEv);
  if (!isReservationListing(listing)) return c.json({ error: "NOT_A_RESERVATION_LISTING" }, 400);
  if (listing.actor_id === actorId) {
    return c.json({ error: "FORBIDDEN", details: ["cannot reserve own listing"] }, 403);
  }
  if (typeof listing.actor_id === "string" && (await isBlockedPair(s, actorId, listing.actor_id))) {
    return c.json({ error: "BLOCKED" }, 403); // V3-MKT-61
  }
  const resEvents = await listReservationEvents(s, listingId);
  if (resEvents.some((e) => e.kind === "match_offer")) {
    return c.json({ error: "RESERVATION_CLOSED", details: ["harvest matching already ran"] }, 409);
  }

  const price = Number(body?.desired_unit_price);
  if (!Number.isInteger(price) || price < 0) return c.json({ error: "INVALID_UNIT_PRICE" }, 400);
  const count = Number(body?.desired_count);
  if (!Number.isInteger(count) || count < 1) return c.json({ error: "INVALID_COUNT" }, 400);

  const reservationId = typeof body?.reservation_id === "string" && body.reservation_id ? body.reservation_id : ulid();
  const data: Record<string, unknown> = {
    reservation_id: reservationId,
    listing_id: listingId,
    actor_id: actorId,
    desired_unit_price: price,
    desired_count: count,
    created_at: new Date().toISOString(),
    schema_version: RES_SCHEMA_VERSION,
  };
  if (typeof body?.note === "string") data.note = body.note;

  const res = await s.putEvent(reservationEnvelope(reservationId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_RESERVATION", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_RESERVATION", key: res.key }, 409);
  return c.json({ reservation_id: reservationId }, 201);
});

// GET /market/reservations — 本人(買い手)の予約一覧 + 都度投影の状態。
marketReservationRoutes.get("/market/reservations", async (c) => {
  const actorId = c.get("actorId");
  const s = store(c);
  const now = new Date();
  const all = (await s.listEvents(`truth/${RES_TYPE}/`)).map(dataOf) as unknown as Reservation[];
  const mine = all.filter((r) => r.actor_id === actorId);
  const out: Record<string, unknown>[] = [];
  for (const r of mine) {
    let events = await listReservationEventsFor(s, r.reservation_id);
    events = await settleReservationExpiry(s, r, events, now);
    const { status, offer } = reservationStatus(events);
    out.push({
      ...r,
      status,
      offered_count: offer?.offered_count,
      offered_unit_price: offer?.offered_unit_price,
      expires_at: offer?.expires_at,
    });
  }
  return c.json({ reservations: out });
});

// POST /market/listings/{listing_id}/match — 割り出し完了後の自動マッチング
// (OQ-ROUTE-03 実装先)。出品者(=親個体の管理者)のみ・実匹数(harvested_count)を
// 添えて1回だけ実行できる(ALREADY_MATCHED で再実行を拒否)。単価降順・出品側
// しきい値・ブロック関係を適用し、収まる分だけ match_offer を発行する。
marketReservationRoutes.post("/market/listings/:listing_id/match", async (c) => {
  const listingId = c.req.param("listing_id");
  const actorId = c.get("actorId");
  const s = store(c);
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  if (!listingEv) return c.json({ error: "NOT_FOUND" }, 404);
  const listing = dataOf(listingEv);
  if (!isReservationListing(listing)) return c.json({ error: "NOT_A_RESERVATION_LISTING" }, 400);
  if (listing.actor_id !== actorId) return c.json({ error: "FORBIDDEN", details: ["listing owner only"] }, 403);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const harvestedCount = Number(body?.harvested_count);
  if (!Number.isInteger(harvestedCount) || harvestedCount < 0) {
    return c.json({ error: "INVALID_HARVESTED_COUNT" }, 400);
  }

  const [reservations, resEvents] = await Promise.all([
    listReservations(s, listingId),
    listReservationEvents(s, listingId),
  ]);
  if (resEvents.some((e) => e.kind === "match_offer")) {
    return c.json({ error: "ALREADY_MATCHED" }, 409);
  }

  const candidates: Reservation[] = [];
  const excluded: string[] = [];
  for (const r of reservations) {
    const blocked = await isBlockedPair(s, actorId, r.actor_id); // V3-MKT-61
    if (!withinApplyThreshold(r, listing) || blocked) {
      excluded.push(r.reservation_id);
      continue;
    }
    candidates.push(r);
  }

  const now = new Date();
  let remaining = harvestedCount;
  const matched: string[] = [];
  const unmatched: string[] = [];
  let rank = 0;
  for (const r of sortReservationsForMatching(candidates)) {
    if (r.desired_count > remaining) {
      unmatched.push(r.reservation_id);
      continue;
    }
    const id = ulid();
    const data: Record<string, unknown> = {
      event_id: id,
      reservation_id: r.reservation_id,
      listing_id: listingId,
      kind: "match_offer",
      actor_id: SYSTEM_RESERVATION_ACTOR,
      offered_count: r.desired_count,
      offered_unit_price: r.desired_unit_price,
      rank,
      expires_at: new Date(now.getTime() + RESERVATION_CONFIRM_WINDOW_HOURS * HOUR_MS).toISOString(),
      created_at: now.toISOString(),
      schema_version: RES_EVENT_SCHEMA_VERSION,
    };
    await s.putEventAt(`truth/${RES_EVENT_TYPE}/${r.reservation_id}-match-offer.json`, systemReservationEventEnvelope(id, data));
    matched.push(r.reservation_id);
    remaining -= r.desired_count;
    rank += 1;
  }

  return c.json(
    {
      listing_id: listingId,
      harvested_count: harvestedCount,
      remaining_count: remaining,
      matched,
      unmatched: [...unmatched, ...excluded],
    },
    201,
  );
});

// GET /market/transfer/{listing_id} — マッチング結果の確認画面(OQ-ROUTE-03 実装先)。
// 出品者は全件、買い手は自分の予約のみ閲覧可。読み取り時に応答期限超過の自己修復
// (expire+カルマ-1)を適用する。
marketReservationRoutes.get("/market/transfer/:listing_id", async (c) => {
  const listingId = c.req.param("listing_id");
  const actorId = c.get("actorId");
  const s = store(c);
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  if (!listingEv) return c.json({ error: "NOT_FOUND" }, 404);
  const listing = dataOf(listingEv);
  if (!isReservationListing(listing)) return c.json({ error: "NOT_A_RESERVATION_LISTING" }, 400);

  const reservations = await listReservations(s, listingId);
  const isOwner = listing.actor_id === actorId;
  const mine = reservations.find((r) => r.actor_id === actorId);
  if (!isOwner && !mine) return c.json({ error: "FORBIDDEN" }, 403);

  const now = new Date();
  const rows: Record<string, unknown>[] = [];
  for (const r of reservations) {
    let events = await listReservationEventsFor(s, r.reservation_id);
    events = await settleReservationExpiry(s, r, events, now);
    const { status, offer } = reservationStatus(events);
    rows.push({
      reservation_id: r.reservation_id,
      actor_id: r.actor_id,
      desired_unit_price: r.desired_unit_price,
      desired_count: r.desired_count,
      status,
      offered_count: offer?.offered_count,
      offered_unit_price: offer?.offered_unit_price,
      rank: offer?.rank,
      expires_at: offer?.expires_at,
    });
  }

  const visible = isOwner ? rows : rows.filter((row) => row.reservation_id === mine?.reservation_id);
  return c.json({ listing_id: listingId, reservations: visible });
});

// POST /market/reservations/{reservation_id}/confirm — 買い手が確認画面で成立させる。
marketReservationRoutes.post("/market/reservations/:reservation_id/confirm", async (c) => {
  const reservationId = c.req.param("reservation_id");
  const actorId = c.get("actorId");
  const s = store(c);
  const resEv = await s.readEvent(`truth/${RES_TYPE}/${reservationId}.json`);
  if (!resEv) return c.json({ error: "NOT_FOUND" }, 404);
  const reservation = dataOf(resEv) as unknown as Reservation;
  if (reservation.actor_id !== actorId) return c.json({ error: "FORBIDDEN" }, 403);

  const now = new Date();
  let events = await listReservationEventsFor(s, reservationId);
  events = await settleReservationExpiry(s, reservation, events, now);
  const { status, offer } = reservationStatus(events);
  if (status === "expired") return c.json({ error: "EXPIRED" }, 409);
  if (status !== "offered" || !offer) return c.json({ error: "NOT_OFFERED", status }, 409);

  const id = ulid();
  const data: Record<string, unknown> = {
    event_id: id,
    reservation_id: reservationId,
    listing_id: reservation.listing_id,
    kind: "confirm",
    actor_id: actorId,
    created_at: now.toISOString(),
    schema_version: RES_EVENT_SCHEMA_VERSION,
  };
  const res = await s.putEventAt(`truth/${RES_EVENT_TYPE}/${reservationId}-confirm.json`, reservationEventEnvelope(id, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_CONFIRM", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "ALREADY_RESOLVED" }, 409);
  return c.json({ reservation_id: reservationId, status: "confirmed" }, 201);
});

// POST /market/reservations/{reservation_id}/decline — 買い手が明示辞退(未確定=
// V3-IND-35 のカルマ-1 対象。「買わないくせに予約するな」)。
marketReservationRoutes.post("/market/reservations/:reservation_id/decline", async (c) => {
  const reservationId = c.req.param("reservation_id");
  const actorId = c.get("actorId");
  const s = store(c);
  const resEv = await s.readEvent(`truth/${RES_TYPE}/${reservationId}.json`);
  if (!resEv) return c.json({ error: "NOT_FOUND" }, 404);
  const reservation = dataOf(resEv) as unknown as Reservation;
  if (reservation.actor_id !== actorId) return c.json({ error: "FORBIDDEN" }, 403);

  const now = new Date();
  let events = await listReservationEventsFor(s, reservationId);
  events = await settleReservationExpiry(s, reservation, events, now);
  const { status, offer } = reservationStatus(events);
  if (status === "expired") return c.json({ error: "EXPIRED" }, 409);
  if (status !== "offered" || !offer) return c.json({ error: "NOT_OFFERED", status }, 409);

  const id = ulid();
  const data: Record<string, unknown> = {
    event_id: id,
    reservation_id: reservationId,
    listing_id: reservation.listing_id,
    kind: "decline",
    actor_id: actorId,
    created_at: now.toISOString(),
    schema_version: RES_EVENT_SCHEMA_VERSION,
  };
  const res = await s.putEventAt(`truth/${RES_EVENT_TYPE}/${reservationId}-decline.json`, reservationEventEnvelope(id, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_DECLINE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "ALREADY_RESOLVED" }, 409);

  await grantKarmaCountIncrease(s, actorId, 1, "other"); // V3-IND-35: 未確定=カルマ-1
  return c.json({ reservation_id: reservationId, status: "declined" }, 201);
});
