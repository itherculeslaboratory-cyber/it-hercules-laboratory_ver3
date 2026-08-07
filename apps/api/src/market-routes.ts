// マーケット骨格(design-c4 §3 / V3-MKT-01 — 出品/閲覧まで)。出品イベント
// ihl.mkt.listing.v1 を Truth append、一覧/詳細は投影で都度再計算(常駐 DB 禁止・
// 不変条項①)。全 route PROTECTED(index.ts §1.5 が gate・actorId を set)。書込は
// data.actor_id をセッション principal で強制刻印(V3-AUT-17)。取引遷移(match/
// transition)・決済連動は C4 対象外(matrix ver3_note)。
import { Hono } from "hono";
import { TruthStore, ulid, deriveTransferCode, type PutEventResult } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import {
  reduceMarket,
  projectSettlement,
  projectOwnershipLineage,
  projectPayment,
  projectShippingLink,
  projectCancelRequest,
  isAllowedEdge,
  isNoPayCancelDue,
  isGraceCancelWindowOpen,
  isOfferExpired,
  isAuctionSettleDue,
  highestBid,
  bidStepFor,
  isLotteryDrawDue,
  isPlatinumPriorityDue,
  pickLotteryWinner,
  rankPlatinumPriority,
  nextRelistPrice,
  computePreferenceScore,
  preferenceHighlights,
  type PreferenceTagSpec,
  type RelistDiscountMode,
  type MarketKind,
  type MarketState,
  type TxnEvent,
} from "./market-settlement";
import {
  IN_PROGRESS_STATES,
  roleOf,
  stateLabel,
  turnOf,
  actionKindOf,
  stepper,
  flagsOf,
} from "./market-transactions-view";
import { projectPreferences } from "./settings-routes";
import { isBlockedPair } from "./market-block-routes";
import { projectSellerModeration, projectListingModeration } from "./market-flag-routes";
import { OBLIGATION_TYPE, safeKeyPart } from "./gmo-routes";
// V3-MKT-27(w1-01実装): 低評価フィルタは market-rating-routes.ts の判定関数をそのまま
// 再利用する(判定ロジックの二重定義は禁止=発注書固有の地雷)。projectLedger は
// market-rating-routes.ts と同じ karma 値の読み方(ledger-routes.ts)。
import { lowRatingFlag, projectRating } from "./market-rating-routes";
import { projectLedger } from "./ledger-routes";
import {
  NO_PAY_LIMIT_COUNT,
  NO_PAY_LIMIT_WINDOW_DAYS,
  NO_PAY_RESTRICT_DAYS,
  GRACE_CANCEL_LIMIT_COUNT,
  GRACE_CANCEL_LIMIT_WINDOW_DAYS,
  GRACE_CANCEL_RESTRICT_DAYS,
  FEE_MAINTENANCE_TAX_RATE,
  TAX_GRACE_DAYS,
} from "./economy-constants";

const LISTING_TYPE = "ihl.mkt.listing.v1";
const LISTING_SCHEMA = "schemas/events/mkt-listing.schema.json";
const SCHEMA_VERSION = 1;

// c8 UI磨き第2弾#2(受領10「画像がない」): 出品写真は既存 mkt-listing 型を破壊
// 変更せず別イベント型として追記する(obs-photo.schema.json と同型パターン)。
const LISTING_PHOTO_TYPE = "ihl.mkt.listing_photo.v1";
const LISTING_PHOTO_SCHEMA = "schemas/events/mkt-listing-photo.schema.json";

// 取引状態機械イベント(design-k3 §2.1)。schema_version は string。
// export: fee-routes.ts(V3-MKT-62/63 PAY.JP Platform charge 結線)が同じ取引イベント型へ
// system-generated pay_confirm を append するために再利用する(型リネーム禁止・新規型を
// 増やさない=payload は schemas/events/mkt-transaction-event.schema.json 上 additionalProperties
// 無しの自由オブジェクトのため、method/charge_id を additive に載せられる)。
export const TXN_TYPE = "ihl.mkt.transaction_event.v1";
export const TXN_SCHEMA = "schemas/events/mkt-transaction-event.schema.json";
export const TXN_SCHEMA_VERSION = "1";

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
  "cancel_request", "cancel_approve", "cancel_decline",
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
async function loadListingPhotos(s: TruthStore, listingId: string): Promise<Array<{ photo_id: string; listing_id: string }>> {
  const rows = (await s.listEvents(`truth/${LISTING_PHOTO_TYPE}/${listingId}-`)).map(dataOf);
  return rows
    .map((r) => ({ photo_id: String(r.photo_id), listing_id: listingId }))
    .sort((a, b) => a.photo_id.localeCompare(b.photo_id));
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
  // HDR-1(c9-structure-canon.md §1c・A1#4): ヘッダー観測対象の任意タグ(plaza-post
  // species_id/SW-1と同型パススルー・ユーザー再入力なし)。
  if (typeof body?.species_id === "string" && body.species_id) data.species_id = body.species_id;
  // V3-MKT-52(w-mkt2): 出品者所在国(任意・bridge2追加フィールド)。
  if (typeof body?.country === "string" && body.country.trim()) data.country = body.country.trim();

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

  // V3-MKT-05: オークション締切(任意)。経過後は settleDueAuctions が read-time 自動決着。
  if (typeof body?.ends_at === "string" && !Number.isNaN(Date.parse(body.ends_at))) {
    data.ends_at = body.ends_at;
  }

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
// 当事者への説明可能性は残す)。?species= は個体一覧(individual-routes.ts
// listIndividualsFor)と同じ完全一致(大小無視)フィルタ(HDR-1・A1#4)。
// V3-MKT-52(w2-mkt): ?lang= 文化タグの配列検索(完全一致)+ ?cursor=/?limit=(既定50)
// の cursor-based ページネーション(listing_id=ULID は生成順で単調増加するため、
// listing_id 自体を並べ替えキー兼カーソルとして使う=複合インデックスの GUI 管理は
// 別波・R2 に真の複合 index は無いため in-memory フィルタ→ID順ソート→スライス)。
// ponytail: listing-type prefix scan = O(n) 全走査。MVP 量なら十分。R2 側の真の
// 複合 index(投影 index)は別波(design-c2 §3.1「一覧系投影は R2 prefix scan」)。
marketRoutes.get("/market/listings", async (c) => {
  const speciesFilter = (c.req.query("species") ?? "").trim().toLowerCase();
  const langFilter = (c.req.query("lang") ?? "").trim().toLowerCase();
  // V3-MKT-52(w-mkt2): country は bridge2 が mkt-listing.schema.json へ追加した任意
  // フィールド(検索用複合インデックスの唯一の欠落フィールドだった=schema comment参照)。
  // lang/species と同じ完全一致(大小無視)フィルタで足りる(既存in-memoryフィルタ→
  // ID順ソート→スライスの複合インデックスに country 軸を1本追加するだけ)。
  const countryFilter = (c.req.query("country") ?? "").trim().toLowerCase();
  // V3-MKT-27(w1-01実装): 低評価出品者の除外はオプトイン(既定=除外しない)。要件文が
  // 「除外できる」であって「常に除外する」ではないため、既定で全件から出品者を
  // 黙って消す挙動は不可逆な影響が大きいと判断した(判断が要った箇所・報告書に明記)。
  const excludeLowRating = (c.req.query("exclude_low_rating") ?? "").trim() === "true";
  const cursor = (c.req.query("cursor") ?? "").trim();
  const limitRaw = Number(c.req.query("limit"));
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;
  const s = store(c);
  const all = (await s.listEvents(`truth/${LISTING_TYPE}/`))
    .map(dataOf)
    .filter((l) => !speciesFilter || (typeof l.species_id === "string" && l.species_id.toLowerCase() === speciesFilter))
    .filter((l) => !langFilter || (typeof l.lang === "string" && l.lang.toLowerCase() === langFilter))
    .filter((l) => !countryFilter || (typeof l.country === "string" && l.country.toLowerCase() === countryFilter))
    .sort((a, b) => String(a.listing_id).localeCompare(String(b.listing_id)))
    .filter((l) => !cursor || String(l.listing_id) > cursor);
  const page = all.slice(0, limit);
  const listings = [];
  for (const l of page) {
    const moderation = await projectListingModeration(s, String(l.listing_id), String(l.actor_id));
    if (moderation.hidden) continue;
    // V3-MKT-27(w1-01実装): lowRatingFlag をそのまま import して使う(二重定義しない)。
    if (excludeLowRating) {
      const summary = await projectRating(s, String(l.actor_id));
      const { karma_value } = await projectLedger(s, String(l.actor_id));
      if (lowRatingFlag(summary, karma_value)) continue;
    }
    // c8#2: browse card cover image — first uploaded photo only (full photos[]
    // rides the single-listing detail route; the list route stays a light card).
    const photos = await loadListingPhotos(s, String(l.listing_id));
    listings.push({ ...l, cover_photo_id: photos[0]?.photo_id });
  }
  const nextCursor = page.length === limit ? String(page[page.length - 1].listing_id) : undefined;
  return c.json({ listings, next_cursor: nextCursor });
});

// POST /market/listings/preference-sort — V3-MKT-09「好みスコアで並べ替え」。
// design35実測: 純関数(computePreferenceScore/preferenceHighlights)は
// market-settlement.ts に実装済みで、HTTPルートに配線されていないだけだった
// (設計不要・配線のみ)。重み(specs)は決め打ちにせず呼び出し側(将来のGUI/フォーク)
// が渡す(market-settlement.ts のコメント「係数は決め打ちしない」判断を踏襲)。
// タグの生値(raw_values)も呼び出し側が渡す — listing 自体は price 以外の任意タグを
// 保持しないため(現行スキーマは title/description/price/lang/species_id/country のみ)。
marketRoutes.post("/market/listings/preference-sort", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const specs = body && typeof body.specs === "object" && body.specs !== null
    ? (body.specs as Record<string, PreferenceTagSpec>)
    : null;
  const items = Array.isArray(body?.items)
    ? (body.items as unknown[]).filter(
        (it): it is { listing_id: string; raw_values?: Record<string, number> } =>
          typeof it === "object" && it !== null && typeof (it as { listing_id?: unknown }).listing_id === "string",
      )
    : [];
  if (!specs || items.length === 0) {
    return c.json({ error: "INVALID_PREFERENCE_SORT", details: ["specs (object) and items[] (listing_id required) required"] }, 400);
  }
  const results = items
    .map((it) => {
      const { score, matchPercent, tagContributions } = computePreferenceScore(specs, it.raw_values ?? {});
      const { strongestTag, weakestTag } = preferenceHighlights(tagContributions);
      return {
        listing_id: it.listing_id,
        score,
        match_percent: matchPercent,
        strongest_tag: strongestTag,
        weakest_tag: weakestTag,
      };
    })
    .sort((a, b) => b.score - a.score);
  return c.json({ results });
});

// GET /market/transactions/mine — 観測者が当事者の「取引中」一覧(round-16裁定②=取引中は
// 独立画面・当事者スコープ=観測対象で絞らない例外画面)。全 listing を prefix-scan して
// reduceMarket し、in-progress(matched〜rated)かつ観測者が売り手/買い手のものだけを返す。
// 誰の番か(turn)・今どの段階か(stepper)・急ぎ色フラグ(実タイムスタンプ+経済定数)を
// market-transactions-view.ts の純関数で派生付与する(実データ配線は当ビューモデル1本に集約)。
// ponytail: O(listings × txns) 全走査=既存 /market/listings と同型の MVP 投影(index は別波)。
// read-only: /state と違い自己修復(settleNoPayCancel 等)の書込は発行しない(一覧表示で副作用
// を出さない)。フラグは read-time 算出で「まもなく自動キャンセル」等を予告するだけ。
marketRoutes.get("/market/transactions/mine", async (c) => {
  const actorId = c.get("actorId");
  const s = store(c);
  const now = new Date();
  // 取引の実体は txn イベント側にある(出品 envelope は title/写真だけ持つ)。txn を1度だけ
  // 全走査して listing_id ごとに畳む(loadTxns を listing 数だけ呼ぶと O(listings×txns) の
  // 再走査になるため、ここは単走査+グルーピングにする)。
  const allTxns = (await s.listEvents(`truth/${TXN_TYPE}/`)).map(dataOf) as unknown as TxnEvent[];
  const byListing = new Map<string, TxnEvent[]>();
  for (const e of allTxns) {
    const arr = byListing.get(e.listing_id);
    if (arr) arr.push(e);
    else byListing.set(e.listing_id, [e]);
  }
  const firstAt = (events: TxnEvent[], kind: MarketKind): string | undefined =>
    events.filter((e) => e.kind === kind).map((e) => e.created_at).sort()[0];

  const transactions: Record<string, unknown>[] = [];
  for (const [listingId, events] of byListing) {
    const cur = reduceMarket(listingId, events);
    if (!IN_PROGRESS_STATES.has(cur.state)) continue;
    const role = roleOf(cur, actorId);
    if (!role) continue; // 当事者(売り手/買い手)でない取引は出さない

    const payment = projectPayment(events);
    const matchedAt = firstAt(events, "match");
    const shippedAt = firstAt(events, "ship");
    const buyerId = role === "buy" ? actorId : cur.matched_with;
    const matchAmount = events.filter((e) => e.kind === "match").map((e) => e.amount).find((a) => typeof a === "number");
    const { turn, action } = turnOf(cur.state, role, payment);
    // 出品 envelope(title/写真)は存在すれば読む(予約 fulfillment 等 envelope 無しの
    // 取引もあるため必須にしない)。
    const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
    const listing = listingEv ? dataOf(listingEv) : {};
    const photos = await loadListingPhotos(s, listingId);

    transactions.push({
      listing_id: listingId,
      title: typeof listing.title === "string" ? listing.title : undefined,
      cover_photo_id: photos[0]?.photo_id,
      role,
      state: cur.state,
      state_label: stateLabel(cur.state, payment),
      counterparty: role === "sell" ? cur.matched_with : cur.seller_id,
      amount: matchAmount ?? (typeof listing.price === "number" ? listing.price : undefined),
      turn,
      turn_action: action,
      action_kind: actionKindOf(cur.state, role, payment), // 「あなたの番」で押せる遷移(相手待ちは null)
      flags: flagsOf({ state: cur.state, role, payment, matchedAt, shippedAt, now }),
      stepper: stepper(cur.state, payment),
      payment,
      shipping_link: projectShippingLink(events),
      cancel_request: projectCancelRequest(events),
      settlement: projectSettlement(events, now),
      grace_cancel_window_open: isGraceCancelWindowOpen(events, now),
      no_pay_cancel_due: isNoPayCancelDue(events, now),
      // 振込名義に添えるコード(CL-11・買い手の識別子)。買い手本人にも売り手にも同じ値を返す。
      transfer_code: buyerId ? await deriveTransferCode(buyerId) : undefined,
    });
  }
  return c.json({ transactions });
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
// export: market-rating-routes.ts(T-71 GAP⑤/SEC-A5)が取引当事者検証に再利用する
// (reduceMarket と同じ trust boundary・当ファイル外への複製を避ける)。
export async function loadTxns(c: { env: Bindings }, listingId: string): Promise<TxnEvent[]> {
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

// ★V3-GOV-05(design35 §433)。gov-dispute(category=market・二人部屋)の争いが解決
// (close/vote_resolve)した際、対象 listing の trade_event(ihl.mkt.transaction_event.v1)
// へ dispute_resolved を追記するフック関数。kind="dispute_resolved" は listing state を
// 動かさない経済副次イベント(tax_debt/tax_pay/fee_unpaidと同型)。呼び出し側(gov-routes.ts・
// w-govのglob)は dispute close/vote_resolve のハンドラからこの関数を1回呼ぶだけでよい。
// GOV-05本体(表示切替)は plaza-routes.ts の既存 correction_of で足りているため不要
// (design35実測)。system actor 発行(人間操作ではなくdispute解決という他イベント起因の
// 副次記録・V3-AUT-17例外)。
export async function appendDisputeResolvedTradeEvent(
  s: TruthStore,
  listingId: string,
  disputeId: string,
  resolution?: string,
): Promise<PutEventResult> {
  const id = ulid();
  const data: Record<string, unknown> = {
    transaction_event_id: id,
    listing_id: listingId,
    actor_id: SYSTEM_AUTO_ACTOR,
    kind: "dispute_resolved",
    payload: resolution ? { dispute_id: disputeId, resolution } : { dispute_id: disputeId },
    created_at: new Date().toISOString(),
    schema_version: TXN_SCHEMA_VERSION,
  };
  return s.putEventAt(`truth/${TXN_TYPE}/dispute-resolved-${safeKeyPart(disputeId)}.json`, systemTxnEnvelope(id, data));
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
  if (kind === "cancel_request" || kind === "cancel_approve" || kind === "cancel_decline") {
    // 相互承認キャンセル依頼(HANDOFF §3.4): request/approve/decline いずれも当事者
    // (出品者/落札者)のみ。requester 本人が自分の request を承認/却下できない制約は
    // 別途 route 側(projectCancelRequest 参照後)でチェックする(ここは party 判定のみ)。
    const isParty = (!!cur.seller_id && actorId === cur.seller_id) || (!!cur.matched_with && actorId === cur.matched_with);
    if (!isParty) return "party only";
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

// V3-MKT-05: オークション締切(ends_at)経過の read-time 自己修復(settleNoPayCancel と
// 同型パターン)。listed_auction のまま ends_at を過ぎたら、最高入札があれば match
// (=matched へ・落札額=最高額)、入札が無ければ delist(「入札なしでも決着」)を系統
// actor が deterministic key で put-if-absent する。★w1-01実装で価格帯別入札単位刻み・
// ヤフオク型自動入札(予算上限までの自動再入札)を POST /transition の kind==="bid"
// 分岐(下記 auctionPricing/appendAuctionProxyRebid)へ実装した。自動入札の再入札も
// 「実効額(2番手+1刻み)」を通常の bid イベントとして append するため、この決着関数は
// highestBid(cur.bids) を呼ぶだけで自動的に実効額(max_bid ではない)で確定する
// (変更不要・以前の「本波では対象外」コメントは是正済み)。
const SYSTEM_AUCTION_ACTOR = "system:auction-settle";

// V3-MKT-05(w1-01実装): 現在価格・刻み・次の最低入札額を算出する。開始価格(入札0件時の
// 基準)は出品時の希望価格(listing.price・省略時0)を流用する既定値とした — 要件文には
// 「初回入札の最低額」の基準が明記されていないため(判断が要った箇所・報告書に明記)。
async function auctionPricing(
  s: TruthStore,
  listingId: string,
  cur: MarketState,
): Promise<{ currentPrice: number; step: number; nextMinBid: number }> {
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  const startingPrice = listingEv && typeof dataOf(listingEv).price === "number" ? Number(dataOf(listingEv).price) : 0;
  const currentPrice = highestBid(cur.bids)?.amount ?? startingPrice;
  const step = bidStepFor(currentPrice);
  return { currentPrice, step, nextMinBid: currentPrice + step };
}

// V3-MKT-05(w1-01実装): 入札者本人の直近(最新)の bid イベントから payload.max_bid を
// 読む。MarketState.bids(公開投影)には max_bid を載せない — bids-table は公開情報
// (stage1)であり、ここに max_bid を混ぜると「max_bid を露出させない」というヤフオク型
// 自動入札の要点(要件文)に反するため、生の TxnEvent[] からだけ読む設計にした。
function findBidMaxBid(events: TxnEvent[], bidder: string): number | undefined {
  const mine = events
    .filter((e) => e.kind === "bid" && e.actor_id === bidder)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const raw = (mine[mine.length - 1]?.payload as { max_bid?: unknown } | undefined)?.max_bid;
  return typeof raw === "number" ? raw : undefined;
}

// V3-MKT-05(w1-01実装): ヤフオク型自動入札の再入札を「新しい bid イベントの追記」として
// append-only 台帳に記録する(過去イベントの書き換え禁止)。data.actor_id は実際の
// 入札者本人(bids-table の bidder 判定・highestBid の落札者判定に使われるため system
// 固定値にしない)。provenance だけを system 生成として正直に記録する(CL-02)。
const SYSTEM_AUCTION_PROXY_AGENT = "market-auction-proxy-bid";
async function appendAuctionProxyRebid(
  s: TruthStore,
  listingId: string,
  bidderId: string,
  amount: number,
  maxBid: number,
): Promise<void> {
  const id = ulid();
  const data: Record<string, unknown> = {
    transaction_event_id: id,
    listing_id: listingId,
    actor_id: bidderId,
    kind: "bid",
    amount,
    payload: { max_bid: maxBid, proxy_rebid: true },
    created_at: new Date().toISOString(),
    schema_version: TXN_SCHEMA_VERSION,
  };
  await s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: TXN_TYPE,
    time: new Date().toISOString(),
    dataschema: TXN_SCHEMA,
    provenance: { generator_kind: "agent", agent_name: SYSTEM_AUCTION_PROXY_AGENT },
    data,
  });
}

async function settleDueAuctions(
  s: TruthStore,
  listingId: string,
  events: TxnEvent[],
  now: Date,
): Promise<TxnEvent[]> {
  const cur = reduceMarket(listingId, events);
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  const endsAt = listingEv ? dataOf(listingEv).ends_at : undefined;
  if (!isAuctionSettleDue(cur.state, typeof endsAt === "string" ? endsAt : undefined, now)) return events;

  const best = highestBid(cur.bids);
  const id = ulid();
  const data: Record<string, unknown> = best
    ? {
        transaction_event_id: id,
        listing_id: listingId,
        actor_id: SYSTEM_AUCTION_ACTOR,
        kind: "match",
        counterparty: best.bidder,
        amount: best.amount,
        payload: { auction_settle: "highest_bid" },
        created_at: now.toISOString(),
        schema_version: TXN_SCHEMA_VERSION,
      }
    : {
        transaction_event_id: id,
        listing_id: listingId,
        actor_id: SYSTEM_AUCTION_ACTOR,
        kind: "delist",
        payload: { auction_settle: "no_bids" },
        created_at: now.toISOString(),
        schema_version: TXN_SCHEMA_VERSION,
      };
  const res = await s.putEventAt(`truth/${TXN_TYPE}/auction-settle-${listingId}.json`, systemTxnEnvelope(id, data));
  if (res.status !== "inserted") return events; // 既に自己修復済み(冪等)
  // V3-MKT-24(w3-mkt): 入札なしで delist が新規確定した時だけ、relist-policy が
  // 宣言されていれば自動再出品を発火する(w2-mkt で持ち越された配線=下記コメント参照)。
  if (!best) await autoRelistIfDelisted(s, listingId, now);
  return [...events, data as unknown as TxnEvent];
}

// V3-MKT-07: 抽選(listed_lottery)締切経過の read-time 自己修復。settleDueAuctions と
// 同型パターン。応募(bid)が1件も無ければ delist(入札なし決着と同じ扱い)、1件以上
// なら CSPRNG(crypto.getRandomValues)で応募者(重複除去済み)から均等に1名を選び
// match する。当選判定に amount は一切使わない(Coin/PTで当選率を上げられない=MKT-07)。
const SYSTEM_LOTTERY_ACTOR = "system:lottery-draw";

async function settleDueLottery(
  s: TruthStore,
  listingId: string,
  events: TxnEvent[],
  now: Date,
): Promise<TxnEvent[]> {
  const cur = reduceMarket(listingId, events);
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  const endsAt = listingEv ? dataOf(listingEv).ends_at : undefined;
  if (!isLotteryDrawDue(cur.state, typeof endsAt === "string" ? endsAt : undefined, now)) return events;

  const applicants = [...new Set(cur.bids.map((b) => b.bidder))];
  const id = ulid();
  let data: Record<string, unknown>;
  if (applicants.length === 0) {
    data = {
      transaction_event_id: id,
      listing_id: listingId,
      actor_id: SYSTEM_LOTTERY_ACTOR,
      kind: "delist",
      payload: { lottery_draw: "no_applicants" },
      created_at: now.toISOString(),
      schema_version: TXN_SCHEMA_VERSION,
    };
  } else {
    const randomUint32 = crypto.getRandomValues(new Uint32Array(1))[0];
    const winner = pickLotteryWinner(applicants, randomUint32);
    data = {
      transaction_event_id: id,
      listing_id: listingId,
      actor_id: SYSTEM_LOTTERY_ACTOR,
      kind: "match",
      counterparty: winner,
      payload: { lottery_draw: "csprng", applicant_count: applicants.length },
      created_at: now.toISOString(),
      schema_version: TXN_SCHEMA_VERSION,
    };
  }
  const res = await s.putEventAt(`truth/${TXN_TYPE}/lottery-draw-${listingId}.json`, systemTxnEnvelope(id, data));
  if (res.status !== "inserted") return events; // 既に自己修復済み(冪等)
  return [...events, data as unknown as TxnEvent];
}

// V3-MKT-08: プラチナコイン優先(listed_platinum)締切経過の read-time 自己修復。
// 累計PT自己申告(bid.amount)降順(同数は入札の早い順)で上位1名に割当てる(K=1・
// 1 listing = 1 買い手の既存単発取引状態機械の範囲内。複数枠(K>1)の分割割当は
// 本波スコープ外=ponytail・別途裁定要)。応募が無ければ delist。
const SYSTEM_PLATINUM_ACTOR = "system:platinum-priority";

async function settleDuePlatinum(
  s: TruthStore,
  listingId: string,
  events: TxnEvent[],
  now: Date,
): Promise<TxnEvent[]> {
  const cur = reduceMarket(listingId, events);
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  const endsAt = listingEv ? dataOf(listingEv).ends_at : undefined;
  if (!isPlatinumPriorityDue(cur.state, typeof endsAt === "string" ? endsAt : undefined, now)) return events;

  const ranked = rankPlatinumPriority(cur.bids);
  const top = ranked[0];
  const id = ulid();
  const data: Record<string, unknown> = top
    ? {
        transaction_event_id: id,
        listing_id: listingId,
        actor_id: SYSTEM_PLATINUM_ACTOR,
        kind: "match",
        counterparty: top.bidder,
        amount: top.amount,
        payload: { platinum_priority: "cumulative_pt_desc", applicant_count: ranked.length },
        created_at: now.toISOString(),
        schema_version: TXN_SCHEMA_VERSION,
      }
    : {
        transaction_event_id: id,
        listing_id: listingId,
        actor_id: SYSTEM_PLATINUM_ACTOR,
        kind: "delist",
        payload: { platinum_priority: "no_applicants" },
        created_at: now.toISOString(),
        schema_version: TXN_SCHEMA_VERSION,
      };
  const res = await s.putEventAt(`truth/${TXN_TYPE}/platinum-priority-${listingId}.json`, systemTxnEnvelope(id, data));
  if (res.status !== "inserted") return events; // 既に自己修復済み(冪等)
  return [...events, data as unknown as TxnEvent];
}

// V3-MKT-10: 取引成立(receive∧rate 揃う=MKT-04)時に 5% 維持費税を義務台帳へ自動計上
// (「取引成立からの義務自動計上」=これまでの partial の残り)。fee-routes.ts(PAY.JP
// ゆる請求フロー)が読む既存義務台帳(OBLIGATION_TYPE)をそのまま継承する(型リネーム禁止・
// round-16裁定=強制収集しない/ゆる請求のため自動ペナルティ・Fibonacci課金は付けない)。
// gross(成約額)は「実際に動いた金額」を優先する決定的順位: pay_confirm確認額 >
// pay_declare申告額 > listing.price 表示価格。全て欠落なら課税せず記録もしない(ゆる請求=
// 取り逃し許容の精神・強制しない)。1 listing = 1 obligation(deterministic key の
// put-if-absent で冪等・再実行や rate→receive 逆順でも二重計上しない)。
async function settleFeeObligation(
  s: TruthStore,
  listingId: string,
  sellerId: string | undefined,
  events: TxnEvent[],
  settledAt: string,
): Promise<void> {
  if (!sellerId) return;
  const payment = projectPayment(events);
  // V3-MKT-63: PAY.JP Platform charge は createPlatformCharge() が platformFeeFor() で
  // 5%を charge 作成時に自動控除済み(fee-routes.ts payjp-charge route)。ここでゆる請求の
  // 義務台帳(5%)を重ねて計上すると二重徴収になるためスキップする(bank_transfer のみ本来の
  // ゆる請求フローの対象)。
  if (payment.method === "payjp_platform") return;
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  const listingPrice = listingEv ? Number(dataOf(listingEv).price) : NaN;
  const gross = payment.confirmed_amount ?? payment.declared_amount ?? (Number.isFinite(listingPrice) ? listingPrice : undefined);
  if (!gross || gross <= 0) return;
  const amount = Math.round(gross * FEE_MAINTENANCE_TAX_RATE);
  if (amount <= 0) return; // schema: amount exclusiveMinimum 0

  const id = ulid();
  const dueDate = new Date(new Date(settledAt).getTime() + TAX_GRACE_DAYS * DAY_MS).toISOString();
  const data: Record<string, unknown> = {
    obligation_id: id,
    actor_id: sellerId,
    transfer_code: await deriveTransferCode(sellerId),
    amount,
    obligation_kind: "fee_tax",
    due_date: dueDate,
    created_at: new Date().toISOString(),
    schema_version: "1",
  };
  await s.putEventAt(`truth/${OBLIGATION_TYPE}/mkt-fee-${safeKeyPart(listingId)}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: OBLIGATION_TYPE,
    time: new Date().toISOString(),
    dataschema: "schemas/events/gmo-obligation.schema.json",
    provenance: { generator_kind: "agent", agent_name: "market-settle" },
    data,
  });
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
  events = await settleDueAuctions(s, listingId, events, now); // V3-MKT-05(自己修復)
  events = await settleDueLottery(s, listingId, events, now); // V3-MKT-07(自己修復)
  events = await settleDuePlatinum(s, listingId, events, now); // V3-MKT-08(自己修復)

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
  // V3-MKT-07: 抽選応募は 1 応募/actor・価格 UI を出さない(応募に amount を付けさせない
  // = Coin/PT で当選率を上げられない設計をリクエスト側でも強制)。
  if (kind === "bid" && cur.state === "listed_lottery") {
    if (cur.bids.some((b) => b.bidder === actorId)) {
      return c.json({ error: "ALREADY_APPLIED", details: ["1 application per listing"] }, 409);
    }
    if (extra.amount !== undefined) {
      return c.json({ error: "INVALID_TRANSITION", details: ["lottery entries carry no price"] }, 400);
    }
  }
  // V3-MKT-08: プラチナ優先の申込は累計PT(amount)必須・最低=現在の最高累計PT(1PT刻み)。
  if (kind === "bid" && cur.state === "listed_platinum") {
    if (typeof extra.amount !== "number" || !Number.isInteger(extra.amount) || extra.amount <= 0) {
      return c.json({ error: "INVALID_TRANSITION", details: ["payload amount (cumulative PT) required"] }, 400);
    }
    const currentTop = rankPlatinumPriority(cur.bids)[0];
    if (currentTop && (extra.amount as number) < (currentTop.amount as number)) {
      return c.json({ error: "BID_TOO_LOW", current_top: currentTop.amount }, 409);
    }
  }
  // V3-MKT-05(w1-01実装): オークション入札は「現在価格+その価格帯の刻み」以上・
  // 刻みの倍数に整合すること(要件文)。負値/0/非数は明示的に拒否する(元は
  // Number.isFinite だけ通っていた=負値でも append されていたギャップの是正)。
  // ★判断: 「刻みの倍数に整合」は amount 自体を刻みグリッドに揃える(amount % step
  // === 0)と解釈した(現在価格からの差分ではなく金額そのものを揃える方が、複数入札者
  // が混在しても検算しやすいため。要件文はどちらとも取れる書き方で、報告書に明記する)。
  let auctionProxyRebid: { bidder: string; amount: number; maxBid: number } | undefined;
  if (kind === "bid" && cur.state === "listed_auction") {
    const amount = extra.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
      return c.json({ error: "INVALID_TRANSITION", details: ["bid amount must be a positive integer"] }, 400);
    }
    const pricing = await auctionPricing(s, listingId, cur);
    if (amount < pricing.nextMinBid || amount % pricing.step !== 0) {
      return c.json(
        { error: "BID_TOO_LOW", current_price: pricing.currentPrice, min_next_bid: pricing.nextMinBid, bid_step: pricing.step },
        409,
      );
    }
    // V3-MKT-05(w1-01実装・T2): ヤフオク型自動入札の予算上限(任意)。amount 以上を要求する
    // (max_bid が amount 未満なら即座に自分自身の入札にすら勝てない矛盾した入力のため)。
    const maxBidRaw = body?.max_bid;
    if (maxBidRaw !== undefined) {
      const maxBid = Number(maxBidRaw);
      if (!Number.isFinite(maxBid) || !Number.isInteger(maxBid) || maxBid < amount) {
        return c.json({ error: "INVALID_TRANSITION", details: ["max_bid must be an integer >= amount"] }, 400);
      }
      extra.payload = { ...(extra.payload as Record<string, unknown> | undefined), max_bid: maxBid };
    }
    // 既存の最高額入札者(直前のリーダー)が max_bid を持ち、その上限がこの新しい入札への
    // 「1刻み上乗せ」を賄えるなら、リーダーの入札を1刻みだけ自動で引き上げて再入札する
    // (ヤフオク型・max_bid 自体は露出しない)。同額時「先に入れた方」が勝つのは
    // highestBid() の既存タイブレーク(created_at 昇順)がそのまま担保する。
    const prevBest = highestBid(cur.bids);
    if (prevBest && prevBest.bidder !== actorId) {
      const prevMaxBid = findBidMaxBid(events, prevBest.bidder);
      if (typeof prevMaxBid === "number") {
        const raised = amount + bidStepFor(amount);
        if (prevMaxBid >= raised) {
          auctionProxyRebid = { bidder: prevBest.bidder, amount: raised, maxBid: prevMaxBid };
        }
      }
    }
  }
  if (kind === "cancel" && cur.state === "matched" && actorId === cur.matched_with) {
    // 猶予キャンセル(成立後60分・買い手無条件)。窓が閉じた後は cancel_request/
    // cancel_approve/cancel_decline(相互承認フロー・HANDOFF §3.4)を使う。
    if (!isGraceCancelWindowOpen(events, now)) {
      return c.json({ error: "GRACE_WINDOW_CLOSED", details: ["use cancel_request (mutual approval) after the grace window"] }, 409);
    }
    extra.payload = { ...(extra.payload as Record<string, unknown> | undefined), cancel_reason: "grace" };
  }
  // HANDOFF §3.4 残作業: 猶予キャンセル窓が閉じた後の相手承認制キャンセル依頼フロー。
  // request は「pending 中の request が無いこと」、approve/decline は「pending 中で
  // かつ自分が requester でないこと」を要求する(自分の request を自分で承認/却下
  // できない=対等な相互承認)。
  if (kind === "cancel_request") {
    const existing = projectCancelRequest(events);
    if (existing.status === "pending") return c.json({ error: "CANCEL_REQUEST_PENDING" }, 409);
    const reason = (extra.payload as { reason?: unknown } | undefined)?.reason;
    extra.payload = { ...(extra.payload as Record<string, unknown> | undefined), reason: typeof reason === "string" ? reason : undefined };
  }
  if (kind === "cancel_approve" || kind === "cancel_decline") {
    const existing = projectCancelRequest(events);
    if (existing.status !== "pending") return c.json({ error: "NO_PENDING_CANCEL_REQUEST" }, 409);
    if (existing.requested_by === actorId) {
      return c.json({ error: "FORBIDDEN", details: ["requester cannot resolve own cancel request"] }, 403);
    }
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

  // V3-MKT-05(w1-01実装): この入札の直後にヤフオク型自動入札の再入札を追記する
  // (append-only・過去イベントは書き換えない)。
  if (auctionProxyRebid) {
    await appendAuctionProxyRebid(s, listingId, auctionProxyRebid.bidder, auctionProxyRebid.amount, auctionProxyRebid.maxBid);
  }

  const merged = [...events, data];
  const next = reduceMarket(listingId, merged);
  if (kind === "receive" || kind === "rate") {
    const settlement = projectSettlement(merged, now);
    if (settlement.settled && settlement.settled_at) {
      await settleFeeObligation(s, listingId, next.seller_id, merged, settlement.settled_at);
    }
  }
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
  events = await settleDueAuctions(s, listingId, events, now); // V3-MKT-05(自己修復)
  events = await settleDueLottery(s, listingId, events, now); // V3-MKT-07(自己修復)
  events = await settleDuePlatinum(s, listingId, events, now); // V3-MKT-08(自己修復)
  const cur = reduceMarket(listingId, events);
  // V3-MKT-05(w1-01実装・T3): 入札フォームが表示する「現在価格・次の最低入札額・刻み」。
  // listed_auction のときだけ算出する(それ以外は入札できないため無意味)。
  const auctionPricingInfo = cur.state === "listed_auction" ? await auctionPricing(s, listingId, cur) : undefined;
  return c.json({
    ...cur,
    auction: auctionPricingInfo
      ? { current_price: auctionPricingInfo.currentPrice, next_min_bid: auctionPricingInfo.nextMinBid, bid_step: auctionPricingInfo.step }
      : undefined,
    settlement: projectSettlement(events, now),
    payment: projectPayment(events),
    no_pay_cancel_due: isNoPayCancelDue(events, now),
    grace_cancel_window_open: isGraceCancelWindowOpen(events, now),
    cancel_request: projectCancelRequest(events), // HANDOFF §3.4 相互承認キャンセル依頼
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

// ── V3-MKT-24: 落札されなかった出品の自動再出品(値下げ方向のみ)────────────────
// 未登録イベント型(codegen 対象外・envelope.ts の schema 検証をバイパスする既存
// パターン=market-intl-shipping-routes.ts の listing_intl と同型。mkt-listing.schema
// を additionalProperties:false のまま直接拡張すると precompile 済み validator の
// 再生成(packages/truth/src/generated/validators.cjs・全ドメイン共通の生成物)が
// 要り本波の glob 外になるため、この設計を踏襲した)。
// w2-mkt で持ち越された配線(settleDueAuctions の「入札なし→delist」枝から自動発火)は
// w3-mkt で接続済み(下記 autoRelistIfDelisted・呼び出し元=settleDueAuctions)。
const RELIST_POLICY_TYPE = "ihl.mkt.relist_policy.v1";
const RELIST_POLICY_SCHEMA = "schemas/events/mkt-relist-policy.schema.json";
// V3-MKT-24(w3-mkt): 再出品チェーンの回数カウント(from_listing_id をキーにした
// put-if-absent・1つの delist から生む relist は高々1件=settleDueAuctions 側の
// auction-settle-${listingId} 冪等キーで既に「1回だけ」呼ばれることが保証されている)。
const RELIST_EVENT_TYPE = "ihl.mkt.relist_event.v1";
const RELIST_EVENT_SCHEMA = "schemas/events/mkt-relist-event.schema.json";

async function relistCountFor(s: TruthStore, listingId: string): Promise<number> {
  const ev = await s.readEvent(`truth/${RELIST_EVENT_TYPE}/${listingId}.json`);
  if (!ev) return 0;
  const d = dataOf(ev);
  return typeof d.relist_count === "number" ? d.relist_count : 0;
}

// V3-MKT-24(w3-mkt): 対象 listing が relist-policy を宣言していれば、次回価格
// (nextRelistPrice)で新しい listing を自動生成し、relist_event に鎖(from→to +
// この listing 自身の relist_count)を記録する。未宣言(policy=null)ならオプトイン
// していないので何もしない(delist のまま=既存挙動を壊さない)。
async function autoRelistIfDelisted(s: TruthStore, listingId: string, now: Date): Promise<void> {
  const policy = await readRelistPolicy(s, listingId);
  if (!policy) return;
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  if (!listingEv) return;
  const listing = dataOf(listingEv);
  const currentPrice = typeof listing.price === "number" ? listing.price : 0;
  const priorCount = await relistCountFor(s, listingId);
  if (policy.maxRelistCount !== null && priorCount + 1 > policy.maxRelistCount) return; // 上限到達
  const nextPrice = nextRelistPrice(currentPrice, {
    maxRelistCount: policy.maxRelistCount,
    discountMode: policy.discountMode,
    discountValue: policy.discountValue,
    floorPrice: policy.floorPrice,
  });
  if (nextPrice === null) return; // 下限到達=再出品しない(delist のまま)

  const newListingId = ulid();
  const newData: Record<string, unknown> = {
    listing_id: newListingId,
    actor_id: listing.actor_id,
    title: listing.title,
    price: nextPrice,
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (typeof listing.description === "string") newData.description = listing.description;
  if (typeof listing.species_id === "string") newData.species_id = listing.species_id;
  if (typeof listing.lang === "string") newData.lang = listing.lang;
  const createRes = await s.putEvent(envelope(newListingId, String(listing.actor_id), newData));
  if (createRes.status !== "inserted") return; // 異常時は静かに諦める(delist 自体は既に確定済み)

  const eventId = ulid();
  const eventData: Record<string, unknown> = {
    relist_event_id: eventId,
    from_listing_id: listingId,
    to_listing_id: newListingId,
    relist_count: priorCount + 1,
    created_at: now.toISOString(),
    schema_version: TXN_SCHEMA_VERSION,
  };
  await s.putEventAt(`truth/${RELIST_EVENT_TYPE}/${listingId}.json`, {
    specversion: "1.0",
    id: eventId,
    source: "apps/api",
    type: RELIST_EVENT_TYPE,
    time: now.toISOString(),
    dataschema: RELIST_EVENT_SCHEMA,
    provenance: { generator_kind: "agent", agent_name: "market-relist" },
    data: eventData,
  });
}

async function readRelistPolicy(s: TruthStore, listingId: string): Promise<
  { maxRelistCount: number | null; discountMode: RelistDiscountMode; discountValue: number; floorPrice: number | null } | null
> {
  const ev = await s.readEvent(`truth/${RELIST_POLICY_TYPE}/${listingId}.json`);
  if (!ev) return null;
  const d = dataOf(ev);
  return {
    maxRelistCount: typeof d.max_relist_count === "number" ? d.max_relist_count : null,
    discountMode: (d.discount_mode as RelistDiscountMode) ?? "none",
    discountValue: typeof d.discount_value === "number" ? d.discount_value : 0,
    floorPrice: typeof d.floor_price === "number" ? d.floor_price : null,
  };
}

// POST /market/listings/{id}/relist-policy — 出品者が再出品回数(無制限=省略/1/3/5等
// 任意の正整数)・値下げルール(percent/fixed/none)・下限価格を宣言する(出品者本人
// のみ・1出品につき1回=既存宣言があれば409。訂正は本波スコープ外)。
marketRoutes.post("/market/listings/:listing_id/relist-policy", async (c) => {
  const listingId = c.req.param("listing_id");
  const s = store(c);
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  if (!listingEv) return c.json({ error: "NOT_FOUND" }, 404);
  const actorId = c.get("actorId");
  if (dataOf(listingEv).actor_id !== actorId) return c.json({ error: "FORBIDDEN", details: ["seller only"] }, 403);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const discountMode = body?.discount_mode;
  if (discountMode !== "percent" && discountMode !== "fixed" && discountMode !== "none") {
    return c.json({ error: "INVALID_RELIST_POLICY", details: ["discount_mode must be percent|fixed|none"] }, 400);
  }
  const discountValue = discountMode === "none" ? 0 : Number(body?.discount_value);
  if (discountMode !== "none" && (!Number.isFinite(discountValue) || discountValue < 0)) {
    return c.json({ error: "INVALID_RELIST_POLICY", details: ["discount_value required for percent/fixed"] }, 400);
  }
  const maxRelistCountRaw = body?.max_relist_count;
  const maxRelistCount =
    maxRelistCountRaw === undefined || maxRelistCountRaw === null ? null : Number(maxRelistCountRaw);
  if (maxRelistCount !== null && (!Number.isInteger(maxRelistCount) || maxRelistCount < 1)) {
    return c.json({ error: "INVALID_RELIST_POLICY", details: ["max_relist_count must be a positive integer or omitted (unlimited)"] }, 400);
  }
  const floorPriceRaw = body?.floor_price;
  const floorPrice = floorPriceRaw === undefined || floorPriceRaw === null ? null : Number(floorPriceRaw);
  if (floorPrice !== null && (!Number.isInteger(floorPrice) || floorPrice < 0)) {
    return c.json({ error: "INVALID_RELIST_POLICY", details: ["floor_price must be a non-negative integer or omitted"] }, 400);
  }

  const id = ulid();
  const data: Record<string, unknown> = {
    relist_policy_id: id,
    listing_id: listingId,
    actor_id: actorId,
    max_relist_count: maxRelistCount,
    discount_mode: discountMode,
    discount_value: discountValue,
    floor_price: floorPrice,
    created_at: new Date().toISOString(),
    schema_version: TXN_SCHEMA_VERSION,
  };
  const res = await s.putEventAt(`truth/${RELIST_POLICY_TYPE}/${listingId}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: RELIST_POLICY_TYPE,
    time: new Date().toISOString(),
    dataschema: RELIST_POLICY_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
  if (res.status === "conflict") return c.json({ error: "ALREADY_SET" }, 409);
  return c.json({ listing_id: listingId, max_relist_count: maxRelistCount, discount_mode: discountMode, floor_price: floorPrice }, 201);
});

// GET /market/listings/{id}/relist-policy — 宣言済みルール + 現在価格から算出した
// 次回再出品価格プレビュー(null=下限到達=最低額で取り下げ)。
marketRoutes.get("/market/listings/:listing_id/relist-policy", async (c) => {
  const listingId = c.req.param("listing_id");
  const s = store(c);
  const policy = await readRelistPolicy(s, listingId);
  if (!policy) return c.json({ error: "NOT_FOUND" }, 404);
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  const currentPrice = listingEv && typeof dataOf(listingEv).price === "number" ? Number(dataOf(listingEv).price) : 0;
  const next = nextRelistPrice(currentPrice, {
    maxRelistCount: policy.maxRelistCount,
    discountMode: policy.discountMode,
    discountValue: policy.discountValue,
    floorPrice: policy.floorPrice,
  });
  return c.json({
    listing_id: listingId,
    max_relist_count: policy.maxRelistCount,
    discount_mode: policy.discountMode,
    discount_value: policy.discountValue,
    floor_price: policy.floorPrice,
    current_price: currentPrice,
    next_relist_price: next,
  });
});
