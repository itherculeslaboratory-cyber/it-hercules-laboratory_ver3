// マーケット骨格(design-c4 §3 / V3-MKT-01 — 出品/閲覧まで)。出品イベント
// ihl.mkt.listing.v1 を Truth append、一覧/詳細は投影で都度再計算(常駐 DB 禁止・
// 不変条項①)。全 route PROTECTED(index.ts §1.5 が gate・actorId を set)。書込は
// data.actor_id をセッション principal で強制刻印(V3-AUT-17)。取引遷移(match/
// transition)・決済連動は C4 対象外(matrix ver3_note)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import {
  reduceMarket,
  projectSettlement,
  projectOwnershipLineage,
  projectPayment,
  projectShippingLink,
  isAllowedEdge,
  isNoPayCancelDue,
  isGraceCancelWindowOpen,
  isOfferExpired,
  type MarketKind,
  type MarketState,
  type TxnEvent,
} from "./market-settlement";
import { projectPreferences } from "./settings-routes";
import { isBlockedPair } from "./market-block-routes";
import { projectSellerModeration, projectListingModeration } from "./market-flag-routes";
import {
  NO_PAY_LIMIT_COUNT,
  NO_PAY_LIMIT_WINDOW_DAYS,
  NO_PAY_RESTRICT_DAYS,
  GRACE_CANCEL_LIMIT_COUNT,
  GRACE_CANCEL_LIMIT_WINDOW_DAYS,
  GRACE_CANCEL_RESTRICT_DAYS,
} from "./economy-constants";

const LISTING_TYPE = "ihl.mkt.listing.v1";
const LISTING_SCHEMA = "schemas/events/mkt-listing.schema.json";
const SCHEMA_VERSION = 1;

// c8 UI磨き第2弾#2(受領10「画像がない」): 出品写真は既存 mkt-listing 型を破壊
// 変更せず別イベント型として追記する(obs-photo.schema.json と同型パターン)。
const LISTING_PHOTO_TYPE = "ihl.mkt.listing_photo.v1";
const LISTING_PHOTO_SCHEMA = "schemas/events/mkt-listing-photo.schema.json";

// 取引状態機械イベント(design-k3 §2.1)。schema_version は string。
const TXN_TYPE = "ihl.mkt.transaction_event.v1";
const TXN_SCHEMA = "schemas/events/mkt-transaction-event.schema.json";
const TXN_SCHEMA_VERSION = "1";

// system actor(V3-AUT-17 例外): 48h no-pay 自動キャンセルは人間操作でなく read-time
// 自己修復(batch.ts SYSTEM_ACTOR="system:cron" と同型の命名。cron でなく request 契機)。
const SYSTEM_AUTO_ACTOR = "system:auto";
const DAY_MS = 24 * 60 * 60 * 1000;

// /transition が受ける遷移 kind(offer/love_letter は POST /market/offers 専用・
// tax_debt/tax_pay/fee_unpaid 等の経済副次 kind は本 route では発行しない)。
// pay_declare/pay_confirm/cancel は round-16 決済裁定+状態機械5脚③(D節)。
const TRANSITION_KINDS = new Set<MarketKind>([
  "list_fixed", "list_auction", "list_lottery", "list_platinum",
  "bid", "match", "ship", "receive", "rate", "delist", "transfer",
  "pay_declare", "pay_confirm", "cancel", "ship_link",
]);

export const marketRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

function envelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: LISTING_TYPE,
    time: new Date().toISOString(),
    dataschema: LISTING_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

function photoEnvelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: LISTING_PHOTO_TYPE,
    time: new Date().toISOString(),
    dataschema: LISTING_PHOTO_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// observation-routes.ts/cusb-routes.ts と同型の local sha256Hex(既存の局所
// 重複パターンを踏襲・共有 export への切り出しは本タスクのスコープ外)。
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

// listing_id 前方一致の prefix scan(obs-photo の capture_id 前方一致と同型・
// O(k) not O(n) — 投影 index 不要)。ULID は生成順で単調なので配列は既にほぼ
// 昇順(listEvents がキー順を保証しない実装でも、一覧カバーの cover 選定は
// 「最初にアップロードされた1枚」であることが厳密には保証されないが、MVP
// スケールでは十分・投影の完全な決定論ソートは別波)。
async function loadListingPhotos(s: TruthStore, listingId: string): Promise<Array<{ photo_id: string }>> {
  const rows = (await s.listEvents(`truth/${LISTING_PHOTO_TYPE}/${listingId}-`)).map(dataOf);
  return rows.map((r) => ({ photo_id: String(r.photo_id) })).sort((a, b) => a.photo_id.localeCompare(b.photo_id));
}

// POST /market/listings — 出品を append(201/400/409)。title は必須。listing_id は
// client 任意 ULID(冪等キー → 二重で 409)・省略時生成。actor_id は常にセッション
// principal(V3-AUT-17)。price は任意の非負整数のみ採用。
marketRoutes.post("/market/listings", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const title = body && typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return c.json({ error: "INVALID_LISTING", details: ["title required"] }, 400);

  const actorId = c.get("actorId");
  // V3-GOV-35(round-15拡張): 非表示5件蓄積した出品者は新規出品停止(誤BAN復帰=
  // カルマ80×5人判定で解除・market-flag-routes.ts projectSellerModeration)。
  if ((await projectSellerModeration(store(c), actorId)).suspended) {
    return c.json({ error: "SELLER_SUSPENDED" }, 403);
  }
  const listingId = typeof body?.listing_id === "string" && body.listing_id ? body.listing_id : ulid();

  const data: Record<string, unknown> = {
    listing_id: listingId,
    actor_id: actorId,
    title,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (typeof body?.description === "string") data.description = body.description;
  const price = Number(body?.price);
  if (Number.isInteger(price) && price >= 0) data.price = price;

  // round-16 OQ-MKT-02: 成立方式(既定=即決・省略可)。V3-IND-35: 予約 listing 化する
  // 親個体参照+応募単位しきい値(いずれも任意)。
  if (body?.accept_mode === "instant" || body?.accept_mode === "consent") data.accept_mode = body.accept_mode;
  if (typeof body?.reservation_sire_id === "string" && body.reservation_sire_id) {
    data.reservation_sire_id = body.reservation_sire_id;
  }
  if (typeof body?.reservation_dam_id === "string" && body.reservation_dam_id) {
    data.reservation_dam_id = body.reservation_dam_id;
  }
  const minApply = Number(body?.reservation_min_apply_count);
  if (Number.isInteger(minApply) && minApply >= 1) data.reservation_min_apply_count = minApply;
  const maxApply = Number(body?.reservation_max_apply_count);
  if (Number.isInteger(maxApply) && maxApply >= 1) data.reservation_max_apply_count = maxApply;

  // I18-06 part1: UGC 原文の作者言語タグを actor の locale から刻印(翻訳はしない・
  // 常駐サーバ翻訳を持たない＝不変条項①)。未設定は projectPreferences が DEFAULT_LOCALE=ja。
  // ponytail: 出品ごとに pref 投影 O(n) 走査。MVP 量なら十分・投影 index は別波。
  data.lang = (await projectPreferences(store(c), actorId)).locale;

  const res = await store(c).putEvent(envelope(listingId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_LISTING", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_LISTING", key: res.key }, 409);
  return c.json({ listing_id: listingId }, 201);
});

// GET /market/listings — 一覧投影(全出品)。V3-GOV-35(round-15拡張): 非表示判定
// (active flag >= 閾値 or government stop)された出品は一覧から除外する(直接 ID を
// 知る当事者は GET /market/listings/{id} で参照可能・全消去はしない=safety側だが
// 当事者への説明可能性は残す)。
// ponytail: listing-type prefix scan = O(n) 全走査。MVP 量なら十分。投影 index は
// 別波(design-c2 §3.1「一覧系投影は R2 prefix scan」)。
marketRoutes.get("/market/listings", async (c) => {
  const s = store(c);
  const all = (await s.listEvents(`truth/${LISTING_TYPE}/`)).map(dataOf);
  const listings = [];
  for (const l of all) {
    const moderation = await projectListingModeration(s, String(l.listing_id), String(l.actor_id));
    if (!moderation.hidden) {
      // c8#2: browse card cover image — first uploaded photo only (full photos[]
      // rides the single-listing detail route; the list route stays a light card).
      const photos = await loadListingPhotos(s, String(l.listing_id));
      listings.push({ ...l, cover_photo_id: photos[0]?.photo_id });
    }
  }
  return c.json({ listings });
});

// GET /market/listings/{listing_id} — 詳細投影(404 or { listing, moderation, photos })。
marketRoutes.get("/market/listings/:listing_id", async (c) => {
  const listingId = c.req.param("listing_id");
  const s = store(c);
  const ev = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  if (!ev) return c.json({ error: "NOT_FOUND" }, 404);
  const listing = dataOf(ev);
  const moderation = await projectListingModeration(s, listingId, String(listing.actor_id));
  const photos = await loadListingPhotos(s, listingId);
  return c.json({ listing, moderation, photos });
});

// POST /market/listings/{listing_id}/photo — multipart(file) → sha256 → putBlob
// media/photo/<photo_id> → 写真イベント追記(出品者本人のみ・V3-AUT-17)。
// obs-photo の POST /observation/upload と同型(2段階アップロード・design-c2 §3.2)。
marketRoutes.post("/market/listings/:listing_id/photo", async (c) => {
  const listingId = c.req.param("listing_id");
  const s = store(c);
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  if (!listingEv) return c.json({ error: "NOT_FOUND" }, 404);
  const actorId = c.get("actorId");
  if (dataOf(listingEv).actor_id !== actorId) return c.json({ error: "FORBIDDEN", details: ["seller only"] }, 403);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) return c.json({ error: "INVALID_UPLOAD" }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";
  const photoId = ulid();
  const mediaKey = `media/photo/${photoId}`;
  await s.putBlob(mediaKey, bytes, contentType);

  const data = {
    photo_id: photoId,
    listing_id: listingId,
    actor_id: actorId,
    media_key: mediaKey,
    content_type: contentType,
    size_bytes: bytes.length,
    sha256: await sha256Hex(bytes),
  };
  const key = `truth/${LISTING_PHOTO_TYPE}/${listingId}-${photoId}.json`;
  const res = await s.putEventAt(key, photoEnvelope(photoId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_PHOTO", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_PHOTO", key: res.key }, 409);
  return c.json({ photo_id: photoId }, 202);
});

// GET /market/listings/{listing_id}/photo/{photo_id} — media blob(obs-photo の
// /observation/{capture_id}/image/{photo_id} と同型)。
marketRoutes.get("/market/listings/:listing_id/photo/:photo_id", async (c) => {
  const photoId = c.req.param("photo_id");
  const obj = await c.env.TRUTH.get(`media/photo/${photoId}`);
  if (!obj) return c.json({ error: "NOT_FOUND" }, 404);
  return new Response(await obj.arrayBuffer(), {
    headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream" },
  });
});

// ── 取引状態機械(MKT-01/02/03/06/29)────────────────────────────────────
// ponytail: 取引型を prefix scan + listing フィルタ = O(n) 全走査(既存 listing 投影
// と同型・投影 index は別波)。非エスクロー=資金は一切預らない(MKT-01)。
async function loadTxns(c: { env: Bindings }, listingId: string): Promise<TxnEvent[]> {
  const all = (await store(c).listEvents(`truth/${TXN_TYPE}/`)).map(dataOf) as unknown as TxnEvent[];
  return all.filter((d) => d.listing_id === listingId);
}

function txnEnvelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: TXN_TYPE,
    time: new Date().toISOString(),
    dataschema: TXN_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// batch.ts agentProvenance() と同型: read-time 自己修復(no-pay 48h 自動キャンセル等)は
// generator_kind="agent" で正直に記録する(CL-02 再現性メタ・"human" への誤表示回避)。
function systemTxnEnvelope(id: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: TXN_TYPE,
    time: new Date().toISOString(),
    dataschema: TXN_SCHEMA,
    provenance: { generator_kind: "agent", agent_name: "market-auto-cancel" },
    data,
  };
}

// 取引イベントを append(actor_id はセッション principal 強制・V3-AUT-17)。data と
// putEvent 結果を返す(投影の即時再計算に data を使う)。
async function appendTxn(
  c: { env: Bindings },
  listingId: string,
  actorId: string,
  kind: MarketKind,
  extra: Record<string, unknown>,
) {
  const id = ulid();
  const data: Record<string, unknown> = {
    transaction_event_id: id,
    listing_id: listingId,
    actor_id: actorId,
    kind,
    ...extra,
    created_at: new Date().toISOString(),
    schema_version: TXN_SCHEMA_VERSION,
  };
  const res = await store(c).putEvent(txnEnvelope(id, actorId, data));
  return { res, data: data as unknown as TxnEvent };
}

// 当事者ガード: 出品者/落札者のみが自分側のアクションを起こせる(第三者による
// 横取り match / 他人の受取申告を禁ずる)。当事者未確定(seller/buyer 不在)なら素通し。
// round-16 OQ-MKT-02: kind=match は accept_mode(既定=即決)で分岐 — listed_fixed から
// なら「買い手の自己申込=成立」を許す。承諾制/offer_pending からの受諾(オークション
// 落札含む)は従来どおり出品者のみ。kind=cancel は猶予キャンセル(成立後60分)の
// 買い手自己申告のみ(48h no-pay 自動キャンセルは内部 helper が guard を経由せず直接
// append する)。
function transitionActorGuard(
  kind: MarketKind,
  cur: MarketState,
  actorId: string,
  opts: { acceptMode?: string } = {},
): string | null {
  if (kind === "match") {
    const instantSelfApply =
      cur.state === "listed_fixed" && opts.acceptMode !== "consent" && !!cur.seller_id && actorId !== cur.seller_id;
    if (!instantSelfApply && cur.seller_id && actorId !== cur.seller_id) return "seller only";
    return null;
  }
  if (kind === "cancel") {
    if (cur.matched_with && actorId !== cur.matched_with) return "matched buyer only";
    return null;
  }
  const sellerOnly =
    kind === "ship" || kind === "delist" || kind === "transfer" || kind === "pay_confirm" || kind === "ship_link";
  const buyerOnly = kind === "receive" || kind === "rate" || kind === "pay_declare";
  if (sellerOnly && cur.seller_id && actorId !== cur.seller_id) return "seller only";
  if (buyerOnly && cur.matched_with && actorId !== cur.matched_with) return "matched buyer only";
  if (kind === "bid" && cur.seller_id === actorId) return "seller cannot bid own listing";
  return null;
}

function pickExtra(body: Record<string, unknown> | null): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (body && typeof body.counterparty === "string") extra.counterparty = body.counterparty;
  if (body && Number.isFinite(Number(body.amount))) extra.amount = Number(body.amount);
  if (body && Array.isArray(body.individual_ids)) extra.individual_ids = body.individual_ids;
  if (body && body.payload && typeof body.payload === "object") extra.payload = body.payload;
  return extra;
}

// 状態機械5脚③(批評R4)の read-time 自己修復: matched のまま48h無入金なら系統 actor
// (SYSTEM_AUTO_ACTOR)が cancel(reason=no_pay_auto・counterparty=買い手)を deterministic
// key で put-if-absent する(cron 非依存・不変条項①「都度再計算」を書込側にも適用)。
// 二重発火は key 衝突(409→無視)で自然に防げる。呼び出し側は返り値の events を以後の
// 判定に使う(自己修復後の最新状態で処理を続ける)。
async function settleNoPayCancel(
  s: TruthStore,
  listingId: string,
  events: TxnEvent[],
  now: Date,
): Promise<TxnEvent[]> {
  if (!isNoPayCancelDue(events, now)) return events;
  const cur = reduceMarket(listingId, events);
  if (!cur.matched_with) return events;
  const id = ulid();
  const data: Record<string, unknown> = {
    transaction_event_id: id,
    listing_id: listingId,
    actor_id: SYSTEM_AUTO_ACTOR,
    kind: "cancel",
    counterparty: cur.matched_with,
    payload: { cancel_reason: "no_pay_auto" },
    created_at: now.toISOString(),
    schema_version: TXN_SCHEMA_VERSION,
  };
  const res = await s.putEventAt(`truth/${TXN_TYPE}/auto-cancel-nopay-${listingId}.json`, systemTxnEnvelope(id, data));
  if (res.status !== "inserted") return events; // 既に自己修復済み(冪等)
  return [...events, data as unknown as TxnEvent];
}

// no-pay/猶予キャンセルの回数投影(round-16 OQ-MKT-03/04)。cancel イベントの
// payload.cancel_reason で判別: no_pay_auto は counterparty(=買い手)、grace は
// actor_id(=自己申告した買い手本人)が対象者。ponytail: 取引型を全走査 O(n)(既存の
// loadTxns と同型・投影 index は別波)。
async function countCancelReason(
  s: TruthStore,
  buyerId: string,
  reason: "no_pay_auto" | "grace",
  now: Date,
  windowDays: number,
): Promise<{ count: number; mostRecentAt?: string }> {
  const all = (await s.listEvents(`truth/${TXN_TYPE}/`)).map(dataOf) as unknown as TxnEvent[];
  const windowMs = windowDays * DAY_MS;
  const mine = all.filter((e) => {
    if (e.kind !== "cancel") return false;
    const p = e.payload as { cancel_reason?: string } | undefined;
    if (p?.cancel_reason !== reason) return false;
    const who = reason === "no_pay_auto" ? e.counterparty : e.actor_id;
    if (who !== buyerId) return false;
    return now.getTime() - new Date(e.created_at).getTime() <= windowMs;
  });
  const mostRecentAt = mine.map((e) => e.created_at).sort().pop();
  return { count: mine.length, mostRecentAt };
}

/** 新規申込(即決自己申込/オファー)ガード。しきい値到達 かつ 制限期間内なら拒否。
 * 制限期間は最新の該当 cancel から起算(V3-GOV-17 将来調整を見越し定数は
 * economy-constants に集約)。 */
async function applyRestrictionGuard(
  s: TruthStore,
  buyerId: string,
  now: Date,
): Promise<{ error: string; restricted_until: string } | null> {
  const noPay = await countCancelReason(s, buyerId, "no_pay_auto", now, NO_PAY_LIMIT_WINDOW_DAYS);
  if (noPay.count >= NO_PAY_LIMIT_COUNT && noPay.mostRecentAt) {
    const until = new Date(new Date(noPay.mostRecentAt).getTime() + NO_PAY_RESTRICT_DAYS * DAY_MS);
    if (until.getTime() > now.getTime()) return { error: "NO_PAY_RESTRICTED", restricted_until: until.toISOString() };
  }
  const grace = await countCancelReason(s, buyerId, "grace", now, GRACE_CANCEL_LIMIT_WINDOW_DAYS);
  if (grace.count >= GRACE_CANCEL_LIMIT_COUNT && grace.mostRecentAt) {
    const until = new Date(new Date(grace.mostRecentAt).getTime() + GRACE_CANCEL_RESTRICT_DAYS * DAY_MS);
    if (until.getTime() > now.getTime()) return { error: "GRACE_CANCEL_RESTRICTED", restricted_until: until.toISOString() };
  }
  return null;
}

// POST /market/listings/{id}/transition — 許可辺のみ(不正遷移は 409・MKT-02)。
// 最初の遷移は unlisted→list_* のみ許可(=各チャネルの出品ルール・MKT-01)。
marketRoutes.post("/market/listings/:listing_id/transition", async (c) => {
  const listingId = c.req.param("listing_id");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body?.kind as MarketKind | undefined;
  if (!kind || !TRANSITION_KINDS.has(kind)) {
    return c.json({ error: "INVALID_TRANSITION", details: ["unknown or unsupported kind"] }, 400);
  }
  const actorId = c.get("actorId");
  const s = store(c);
  const now = new Date();
  let events = await loadTxns(c, listingId);
  events = await settleNoPayCancel(s, listingId, events, now); // 状態機械5脚③(自己修復)

  const cur = reduceMarket(listingId, events);
  if (!isAllowedEdge(cur.state, kind)) {
    return c.json({ error: "ILLEGAL_TRANSITION", from: cur.state, kind }, 409);
  }
  // V3-GOV-35(round-15拡張): unlisted からの list_* は「新規出品」の実体(POST
  // /market/listings は任意メタデータのみで state を動かさない)。ここが真の出品停止
  // 判定点(誤BAN復帰=カルマ80×5人判定で解除・market-flag-routes.ts)。
  if (cur.state === "unlisted" && kind.startsWith("list_")) {
    if ((await projectSellerModeration(s, actorId)).suspended) {
      return c.json({ error: "SELLER_SUSPENDED" }, 403);
    }
  }

  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  const acceptMode = listingEv && typeof dataOf(listingEv).accept_mode === "string" ? String(dataOf(listingEv).accept_mode) : undefined;
  const guard = transitionActorGuard(kind, cur, actorId, { acceptMode });
  if (guard) return c.json({ error: "FORBIDDEN", details: [guard] }, 403);

  const extra = pickExtra(body);
  // round-16 OQ-MKT-02: listed_fixed の即決自己申込は counterparty 省略時=自分。
  if (kind === "match" && !extra.counterparty && cur.seller_id && actorId !== cur.seller_id) {
    extra.counterparty = actorId;
  }
  if ((kind === "match" || kind === "transfer") && typeof extra.counterparty !== "string") {
    return c.json({ error: "INVALID_TRANSITION", details: ["counterparty required"] }, 400);
  }

  if (kind === "match") {
    const counterpartyId = extra.counterparty as string;
    // 即決の自己申込は counterparty=自分なので、判定すべき相手方は常に出品者側
    // (buyer 視点なら seller、seller が offer_pending を受諾する視点なら counterparty=buyer)。
    const otherParty = actorId === cur.seller_id ? counterpartyId : cur.seller_id;
    if (otherParty && (await isBlockedPair(s, actorId, otherParty))) {
      return c.json({ error: "BLOCKED" }, 403);
    }
    // 状態機械5脚②: 承諾制(offer_pending からの受諾)は対象オファーの24h応答期限切れなら拒否。
    if (cur.state === "offer_pending") {
      const offerEv = events
        .filter((e) => (e.kind === "offer" || e.kind === "love_letter") && e.actor_id === counterpartyId)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      if (offerEv && isOfferExpired(offerEv.created_at, now)) {
        return c.json({ error: "OFFER_EXPIRED" }, 409);
      }
    }
    const restriction = await applyRestrictionGuard(s, counterpartyId, now);
    if (restriction) return c.json(restriction, 403);
  }
  if (kind === "bid" && cur.seller_id && (await isBlockedPair(s, actorId, cur.seller_id))) {
    return c.json({ error: "BLOCKED" }, 403);
  }
  if (kind === "cancel" && cur.state === "matched" && actorId === cur.matched_with) {
    // 猶予キャンセル(成立後60分)。窓が閉じた後の相手承認制キャンセル依頼フローは
    // 本波対象外(残課題・open_questions)。
    if (!isGraceCancelWindowOpen(events, now)) {
      return c.json({ error: "GRACE_WINDOW_CLOSED" }, 409);
    }
    extra.payload = { ...(extra.payload as Record<string, unknown> | undefined), cancel_reason: "grace" };
  }
  // V3-MKT-13(round-15裁定・金額相違自己申告): pay_confirm の payload.mismatch は
  // partial(部分入金=残債の再申告待ち)/over(過入金=クレジット記録のみ)の2値限定。
  // 自動制裁・自動充当は一切行わない(ゆる運用・route はここで append するだけ)。
  if (kind === "pay_confirm") {
    const mismatch = (extra.payload as { mismatch?: unknown } | undefined)?.mismatch;
    if (mismatch !== undefined && mismatch !== "partial" && mismatch !== "over") {
      return c.json({ error: "INVALID_TRANSITION", details: ["payload.mismatch must be 'partial' or 'over' when present"] }, 400);
    }
  }
  // V3-MKT-20(round-15裁定・匿名配送=外部URL中継): 入金確認(pay_confirm)後にのみ、
  // 売り手が外部誘導 URL を中継できる。システムは URL の適法性・到達性を検証しない
  // (郵便局側の商用利用可否は round-16 時点で裏取り未了=断定しない・誘導リンクの
  // relay に徹する)。
  if (kind === "ship_link") {
    const url = (extra.payload as { external_shipping_url?: unknown } | undefined)?.external_shipping_url;
    if (typeof url !== "string" || !url.trim()) {
      return c.json({ error: "INVALID_TRANSITION", details: ["payload.external_shipping_url required"] }, 400);
    }
    if (!events.some((e) => e.kind === "pay_confirm")) {
      return c.json({ error: "PAYMENT_NOT_CONFIRMED", details: ["ship_link requires a prior pay_confirm"] }, 409);
    }
  }

  const { res, data } = await appendTxn(c, listingId, actorId, kind, extra);
  if (res.status === "invalid") return c.json({ error: "INVALID_TRANSITION", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_TRANSITION", key: res.key }, 409);

  const next = reduceMarket(listingId, [...events, data]);
  return c.json({ listing_id: listingId, state: next.state, stage: next.stage }, 201);
});

// GET /market/listings/{id}/state — 末尾状態 + stage + 成立投影 + 決済投影(MKT-02/03・
// round-16 決済裁定)。読み取り時に状態機械5脚③の自己修復を先に適用する。
marketRoutes.get("/market/listings/:listing_id/state", async (c) => {
  const listingId = c.req.param("listing_id");
  const s = store(c);
  const now = new Date();
  let events = await loadTxns(c, listingId);
  events = await settleNoPayCancel(s, listingId, events, now);
  const cur = reduceMarket(listingId, events);
  return c.json({
    ...cur,
    settlement: projectSettlement(events, now),
    payment: projectPayment(events),
    no_pay_cancel_due: isNoPayCancelDue(events, now),
    grace_cancel_window_open: isGraceCancelWindowOpen(events, now),
  });
});

// GET /market/listings/{id}/board — 非公開ボード(matched 以降・当事者2人のみ・
// 第三者 403・MKT-03)。出品者向けに offer/love_letter を集約(値段は love_letter
// のみ非開示・MKT-06)。V3-MKT-20(round-15裁定): 外部誘導URL(住所非保持の中継のみ)は
// 当事者2人限定のこの非公開ボードでのみ公開する(公開 GET /state には出さない)。
marketRoutes.get("/market/listings/:listing_id/board", async (c) => {
  const listingId = c.req.param("listing_id");
  const actorId = c.get("actorId");
  const events = await loadTxns(c, listingId);
  const cur = reduceMarket(listingId, events);
  if (cur.stage < 2) return c.json({ error: "BOARD_NOT_OPEN" }, 404);
  const parties = [cur.seller_id, cur.matched_with].filter((x): x is string => !!x);
  if (!parties.includes(actorId)) return c.json({ error: "FORBIDDEN" }, 403);
  const offers = events
    .filter((e) => e.kind === "offer" || e.kind === "love_letter")
    .map((e) => ({
      from: e.actor_id,
      kind: e.kind,
      amount: e.kind === "love_letter" ? undefined : e.amount, // ラブレターは値段非開示
      at: e.created_at,
    }));
  return c.json({
    listing_id: listingId,
    stage: cur.stage,
    state: cur.state,
    parties,
    matched_with: cur.matched_with,
    offers,
    payment: projectPayment(events),
    shipping_link: projectShippingLink(events),
  });
});

// GET /market/listings/{id}/ownership — 所有権系譜(観測引継ぎ・MKT-29)。
marketRoutes.get("/market/listings/:listing_id/ownership", async (c) => {
  const listingId = c.req.param("listing_id");
  const events = await loadTxns(c, listingId);
  return c.json(projectOwnershipLineage(events));
});

// POST /market/offers — 直接オファー / ラブレター(MKT-06)。自分の出品には出せない
// (403)。オファーを受けないチャネル(auction/lottery/platinum)や締切済みは非許可辺
// で 409(拒否ポリシー)。値段は応答に載せない(非開示集約)。
marketRoutes.post("/market/offers", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const listingId = body && typeof body.listing_id === "string" ? body.listing_id : "";
  if (!listingId) return c.json({ error: "INVALID_OFFER", details: ["listing_id required"] }, 400);
  const kind: MarketKind = body?.love_letter === true ? "love_letter" : "offer";
  const actorId = c.get("actorId");
  const s = store(c);
  const events = await loadTxns(c, listingId);
  const cur = reduceMarket(listingId, events);
  if (cur.seller_id === actorId) return c.json({ error: "FORBIDDEN", details: ["cannot offer on own listing"] }, 403);
  if (cur.seller_id && (await isBlockedPair(s, actorId, cur.seller_id))) {
    return c.json({ error: "BLOCKED" }, 403); // V3-MKT-61: ブロック関係とは取引不可
  }
  if (!isAllowedEdge(cur.state, kind)) return c.json({ error: "OFFER_REJECTED", from: cur.state }, 409);
  const restriction = await applyRestrictionGuard(s, actorId, new Date());
  if (restriction) return c.json(restriction, 403); // round-16 OQ-MKT-03/04: no-pay/猶予キャンセル過多は新規申込制限

  const extra: Record<string, unknown> = {};
  if (cur.seller_id) extra.counterparty = cur.seller_id;
  if (Number.isFinite(Number(body?.amount))) extra.amount = Number(body?.amount);
  const { res, data } = await appendTxn(c, listingId, actorId, kind, extra);
  if (res.status === "invalid") return c.json({ error: "INVALID_OFFER", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_OFFER", key: res.key }, 409);
  return c.json({ listing_id: listingId, transaction_event_id: data.transaction_event_id, kind }, 201);
});
