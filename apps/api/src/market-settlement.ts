// マーケット状態機械 + 決済/税/手数料/所有権系譜(design-k3 §2.3・純関数・都度
// 再計算=不変条項①)。全て append-only の ihl.mkt.transaction_event.v1 data 列を
// 畳む prefix-scan 投影。常駐 DB は持たない。route はこれらを呼ぶだけ(不正遷移は
// route が 409・非エスクロー=資金は一切預らない=MKT-01)。
import {
  FEE_COMMERCIAL_RATE,
  FEE_MAINTENANCE_TAX_RATE,
  FEE_FORK_REVENUE_RATE,
  AUTO_GOOD_RATING_DAYS,
  OFFER_RESPONSE_HOURS,
  NO_PAY_CANCEL_HOURS,
  GRACE_CANCEL_MINUTES,
  BID_STEP_UNDER_1000,
  BID_STEP_UNDER_5000,
  BID_STEP_UNDER_10000,
  BID_STEP_10000_PLUS,
  AUCTION_EXTEND_WINDOW_MINUTES,
  AUCTION_EXTEND_BY_MINUTES,
  AUCTION_EXTEND_MAX_COUNT,
} from "./economy-constants";

export type MarketKind =
  | "list_fixed" | "list_auction" | "list_lottery" | "list_platinum"
  | "offer" | "love_letter" | "bid" | "match" | "ship" | "receive"
  | "rate" | "settle" | "delist" | "transfer" | "tax_debt" | "tax_pay" | "fee_unpaid"
  | "pay_declare" | "pay_confirm" | "cancel" | "ship_link"
  | "cancel_request" | "cancel_approve" | "cancel_decline"
  // AUTOBID-1(w2-market2実装): tax_debt等と同型の経済副次イベント(MARKET_EDGESに
  // 未登録=状態を動かさない・POST /transitionのTRANSITION_KINDSにも入れない=システムのみ
  // が発行し、ユーザーが直接kindを指定して呼べない)。
  | "auction_extend";

/** ihl.mkt.transaction_event.v1 の data。route は listing 単位に prefix-scan して渡す。 */
export interface TxnEvent {
  transaction_event_id: string;
  listing_id: string;
  actor_id: string;
  kind: MarketKind;
  counterparty?: string;
  amount?: number;
  individual_ids?: string[];
  payload?: Record<string, unknown>;
  created_at: string;
}

// ── 許可辺表(MARKET_EDGES)─ from-state × kind → to-state。ここに無い (state,kind)
// は不正遷移で、route が 409 を返す(reduceMarket 自身は非辺を黙って無視して畳む=
// tax_* 等の経済副次イベントは状態を動かさない)。成立(sold)は receive∧rate の両方が
// 揃って初めて到達=途中 received/rated を経由(順不同)。
export const MARKET_EDGES: Record<string, Partial<Record<MarketKind, string>>> = {
  unlisted: {
    list_fixed: "listed_fixed",
    list_auction: "listed_auction",
    list_lottery: "listed_lottery",
    list_platinum: "listed_platinum",
  },
  listed_fixed: { offer: "offer_pending", love_letter: "offer_pending", match: "matched", delist: "delisted" },
  listed_auction: { bid: "listed_auction", match: "matched", delist: "delisted" },
  // V3-MKT-07/08(w2-mkt): 抽選/プラチナ優先は締切までの応募受付が要る。auction の
  // bid 自己ループと同型(bid は状態を動かさない=経済副次イベントではなく応募の
  // 蓄積のみ)。1 応募/actor の強制は route 側(POST /transition の重複チェック)。
  listed_lottery: { bid: "listed_lottery", match: "matched", delist: "delisted" },
  listed_platinum: { bid: "listed_platinum", match: "matched", delist: "delisted" },
  offer_pending: { offer: "offer_pending", love_letter: "offer_pending", match: "matched", delist: "delisted" },
  // round-16 決済裁定(受領7): 銀行振込既定・IHL非関与。pay_declare/pay_confirm は
  // tax_* と同型の経済副次イベント。listing state を動かさない意図だが isAllowedEdge
  // は MARKET_EDGES に無い kind を一律 409 にする route ガードのため、副次イベントも
  // 自己ループ(同じ state を指す辺)として登録しないと POST /transition から到達
  // 不能になる(発見した既存ギャップの root-cause fix。tax_debt/tax_pay/fee_unpaid は
  // TRANSITION_KINDS に無く本 route から発行しないため未登録のまま=対象外)。
  // ship_link は round-15裁定 V3-MKT-20(匿名配送=外部URL中継)の同型副次イベント
  // (入金確認後、matched/shipped のどちらでも売り手が中継 URL を送れる)。
  // cancel は猶予キャンセル(60分・買い手)/48h no-pay 自動キャンセル(系統
  // actor)の到達点(V3-MKT-01 状態機械5脚③・批評R4)。pay_declare/pay_confirm は
  // shipped からも許可(出荷後の遅延入金確認・c8 market-trade E2E で発見)。
  // cancel_request/cancel_decline は経済副次イベント(自己ループ)、cancel_approve は
  // 猶予窓が閉じた後の相手承認制キャンセル依頼フロー(HANDOFF §3.4残作業)の到達点
  // (route 側が「相手方のみ承認可・pending request 必須」を保証する・pure edge 表は
  // 単純な到達可否だけを持つ)。
  matched: {
    ship: "shipped",
    cancel: "cancelled",
    pay_declare: "matched",
    pay_confirm: "matched",
    ship_link: "matched",
    cancel_request: "matched",
    cancel_decline: "matched",
    cancel_approve: "cancelled",
  },
  shipped: { receive: "received", rate: "rated", ship_link: "shipped", pay_declare: "shipped", pay_confirm: "shipped" },
  received: { rate: "sold" },
  rated: { receive: "sold" },
  sold: { transfer: "sold" },
  delisted: {},
  cancelled: {},
};

const STAGE2 = new Set(["matched", "shipped", "received", "rated", "sold"]);
const STAGE1 = new Set(["listed_fixed", "listed_auction", "listed_lottery", "listed_platinum", "offer_pending"]);

/** state → stage 番号(0=未出品/取消・1=公開・2=非公開ボード=当事者2人)。落札は
 * match で matched に入るため Stage1 を経ず Stage2 に直行(MKT-03)。 */
export function stageOf(state: string): number {
  return STAGE2.has(state) ? 2 : STAGE1.has(state) ? 1 : 0;
}

/** (state,kind) が許可辺か。route の遷移前ガードに使う(不許可=409)。 */
export function isAllowedEdge(state: string, kind: MarketKind): boolean {
  return MARKET_EDGES[state]?.[kind] !== undefined;
}

function sortEvents(events: TxnEvent[]): TxnEvent[] {
  return [...events].sort((a, b) =>
    a.created_at === b.created_at
      ? a.transaction_event_id.localeCompare(b.transaction_event_id)
      : a.created_at.localeCompare(b.created_at),
  );
}

export interface MarketState {
  listing_id: string;
  state: string;
  seller_id?: string;
  owner_id?: string;
  matched_with?: string;
  bids: { bidder: string; amount?: number; at: string }[];
  stage: number;
}

/** listing 単位の末尾状態を投影(MKT-01/02/03)。許可辺だけを畳み、非辺は状態を
 * 動かさない。owner は成立(sold)で seller→buyer、以後 transfer で移る。 */
export function reduceMarket(listingId: string, events: TxnEvent[]): MarketState {
  let state = "unlisted";
  let sellerId: string | undefined;
  let ownerId: string | undefined;
  let matchedWith: string | undefined;
  const bids: MarketState["bids"] = [];

  for (const ev of sortEvents(events)) {
    if (ev.listing_id !== listingId) continue;
    const next = MARKET_EDGES[state]?.[ev.kind];

    if (ev.kind === "bid") bids.push({ bidder: ev.actor_id, amount: ev.amount, at: ev.created_at });
    if (next === undefined) continue; // 非辺(経済副次 tax_* など)は状態不変

    if (ev.kind.startsWith("list_")) {
      sellerId = ev.actor_id;
      ownerId = ev.actor_id;
    }
    if (ev.kind === "match") matchedWith = ev.counterparty;
    if (ev.kind === "transfer" && ev.counterparty) ownerId = ev.counterparty;
    state = next;
    if (state === "sold" && matchedWith) ownerId = matchedWith;
  }

  return { listing_id: listingId, state, seller_id: sellerId, owner_id: ownerId, matched_with: matchedWith, bids, stage: stageOf(state) };
}

/** V3-MKT-05: 締切(ends_at)経過時にオークションを自動決着すべきか(read-time判定)。
 * listed_auction のまま ends_at を過ぎていれば入札の有無に関わらず due=true
 * (「入札なしでも決着」=入札ゼロは delist・1件以上は最高額 match として route 側が
 * 処理する)。 */
export function isAuctionSettleDue(state: string, endsAt: string | undefined, now: Date): boolean {
  if (state !== "listed_auction" || !endsAt) return false;
  return now.getTime() >= new Date(endsAt).getTime();
}

/** 最高額入札(同額は先着=created_at 昇順)。amount 欠落の bid は対象外。 */
export function highestBid(bids: MarketState["bids"]): MarketState["bids"][number] | undefined {
  let best: MarketState["bids"][number] | undefined;
  for (const b of bids) {
    if (typeof b.amount !== "number") continue;
    if (!best || b.amount > (best.amount as number) || (b.amount === best.amount && b.at < best.at)) best = b;
  }
  return best;
}

/** V3-MKT-05(w1-01実装): 価格帯別の入札単位刻み。帯は「現在価格」(次の入札の
 * 直前の価格)で決まる(要件文の「現在価格帯」表記に対応)。¥1,000/¥5,000/¥10,000
 * ちょうどは、それぞれ「以上」側(1つ上の帯)に属する(要件文の閉区間表記どおり)。 */
export function bidStepFor(currentPrice: number): number {
  if (currentPrice < 1000) return BID_STEP_UNDER_1000;
  if (currentPrice < 5000) return BID_STEP_UNDER_5000;
  if (currentPrice < 10000) return BID_STEP_UNDER_10000;
  return BID_STEP_10000_PLUS;
}

/** AUTOBID-1(w2-market2実装・review-queue R0807-1ef084 ○ score90): このlisting分の
 * txnイベントから直近のオークション延長後の締切を返す。auction_extend イベントが
 * 1件も無ければ base(listing.ends_at)をそのまま返す。複数回延長された場合は最後
 * (created_at最大)の new_ends_at を採る(累積加算ではなく都度「今から5分後」まで
 * 押し出す方式=ヤフオクと同じ挙動・ifYes文どおり)。 */
export function effectiveAuctionEndsAt(events: TxnEvent[], baseEndsAt: string | undefined): string | undefined {
  const extensions = sortEvents(events.filter((e) => e.kind === "auction_extend"));
  const last = extensions[extensions.length - 1];
  const extended = last ? (last.payload as { new_ends_at?: unknown } | undefined)?.new_ends_at : undefined;
  return typeof extended === "string" ? extended : baseEndsAt;
}

/** 延長回数(AUCTION_EXTEND_MAX_COUNT 上限判定に使う。ifYes文(c)「延長が連鎖すると
 * 長時間終わらない可能性があるため、上限の追加判断が要ります」への対応・
 * 既定値は economy-constants.ts 側で置いた=判断が要った箇所)。 */
export function auctionExtensionCount(events: TxnEvent[]): number {
  return events.filter((e) => e.kind === "auction_extend").length;
}

/** AUTOBID-1: 今回の入札で延長すべきならその新しい締切(ISO文字列)を返す。残り時間が
 * AUCTION_EXTEND_WINDOW_MINUTES 分以内・かつ延長回数が上限未満の時だけ発火。延長先は
 * 「今から AUCTION_EXTEND_BY_MINUTES 分後」まで押し出す(currentEndsAt への加算ではない
 * =何度延長されても常に「あと5分」で確定できる=ヤフオクの挙動どおり)。 */
export function nextAuctionExtension(
  events: TxnEvent[],
  currentEndsAt: string | undefined,
  now: Date,
): string | undefined {
  if (!currentEndsAt) return undefined;
  if (auctionExtensionCount(events) >= AUCTION_EXTEND_MAX_COUNT) return undefined;
  const remainingMs = new Date(currentEndsAt).getTime() - now.getTime();
  if (remainingMs > AUCTION_EXTEND_WINDOW_MINUTES * 60 * 1000) return undefined;
  return new Date(now.getTime() + AUCTION_EXTEND_BY_MINUTES * 60 * 1000).toISOString();
}

/** V3-MKT-07: 抽選(listed_lottery)締切(ends_at)経過時に決着すべきか。auction と
 * 同じ read-time 判定(ends_at 未設定なら締切なし=due にならない)。 */
export function isLotteryDrawDue(state: string, endsAt: string | undefined, now: Date): boolean {
  if (state !== "listed_lottery" || !endsAt) return false;
  return now.getTime() >= new Date(endsAt).getTime();
}

/** V3-MKT-08: プラチナ優先(listed_platinum)締切(ends_at)経過時に決着すべきか。 */
export function isPlatinumPriorityDue(state: string, endsAt: string | undefined, now: Date): boolean {
  if (state !== "listed_platinum" || !endsAt) return false;
  return now.getTime() >= new Date(endsAt).getTime();
}

/** V3-MKT-07: 応募者(重複除去済み・route 側が 1 応募/actor を強制)から CSPRNG
 * 均等乱数で 1 名を選ぶ純関数。randomUint32 は呼び出し側が crypto.getRandomValues
 * で都度生成し注入する(純関数としてテスト可能にするため・Coin/PTで当選率を上げ
 * られない=amount を一切見ない設計そのものが「操作不可」を保証する)。 */
export function pickLotteryWinner(applicants: string[], randomUint32: number): string | undefined {
  if (applicants.length === 0) return undefined;
  const idx = randomUint32 % applicants.length;
  return applicants[idx];
}

// V3-MKT-24: 落札されなかった出品の自動再出品(値下げ方向のみ・価格を上げる自動
// 調整はしない)。
export type RelistDiscountMode = "percent" | "fixed" | "none";
export interface RelistPolicy {
  maxRelistCount: number | null; // null=無制限
  discountMode: RelistDiscountMode;
  discountValue: number; // percent=0-100 / fixed=円額 / none時は無視
  floorPrice: number | null; // null=下限なし
}

/** 次回出品価格を算出する純関数。floor_price を下回る(または割れる)場合は null を
 * 返し、呼び出し側はこれを「最低額で取り下げ」(再出品を止める)と解釈する。 */
export function nextRelistPrice(currentPrice: number, policy: RelistPolicy): number | null {
  let next = currentPrice;
  if (policy.discountMode === "percent") {
    next = Math.floor(currentPrice * (1 - policy.discountValue / 100));
  } else if (policy.discountMode === "fixed") {
    next = currentPrice - policy.discountValue;
  } // "none" = 値下げしない(同額で再出品)
  if (next < 0) next = 0;
  if (policy.floorPrice !== null && next < policy.floorPrice) return null;
  return next;
}

/** V3-MKT-08: プラチナ優先の応募(bid.amount=累計PT自己申告)を累計Coin降順・
 * 同数は入札の早い順(created_at 昇順)でランク付けする。Pay To Win 禁止(PT消費や
 * Coin購入で順位操作しない)= ここは申告額の比較のみで、後から金額を書き換える
 * 経路を持たない(append-only の bid イベントを畳むだけ)。 */
export function rankPlatinumPriority(bids: MarketState["bids"]): MarketState["bids"] {
  return [...bids]
    .filter((b) => typeof b.amount === "number")
    .sort((a, b) => (b.amount as number) - (a.amount as number) || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Settlement {
  settled: boolean;
  settled_at?: string;
  fee_unpaid_started_at?: string; // 5%(round-15で8%から引き下げ) 維持費税の未払い起算=成立時刻(MKT-04/10)
  auto_good_due: boolean; // 配送+30日 無評価 → cron が自動 good を append すべき(MKT-04・実 append は P6)
}

/** 成立=受取申告(receive)かつ評価確定(rate)。成立後に 5% fee の未払いが起算し、
 * tax_pay で消える。auto_good_due は「配送(ship)から 30 日 無評価」の境界判定のみ
 * (実際の自動 good append は cron=P6)。now を注入して境界をテストする(純関数)。 */
export function projectSettlement(events: TxnEvent[], now: Date): Settlement {
  const first = (kind: MarketKind): string | undefined =>
    sortEvents(events.filter((e) => e.kind === kind))[0]?.created_at;

  const shippedAt = first("ship");
  const receivedAt = first("receive");
  const ratedAt = first("rate");
  const taxPaid = events.some((e) => e.kind === "tax_pay");

  const settled = receivedAt !== undefined && ratedAt !== undefined;
  const settledAt = settled
    ? (receivedAt! > ratedAt! ? receivedAt! : ratedAt!)
    : undefined;

  const autoGoodDue =
    ratedAt === undefined &&
    shippedAt !== undefined &&
    now.getTime() - new Date(shippedAt).getTime() >= AUTO_GOOD_RATING_DAYS * DAY_MS;

  return {
    settled,
    settled_at: settledAt,
    fee_unpaid_started_at: settled && !taxPaid ? settledAt : undefined,
    auto_good_due: autoGoodDue,
  };
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export interface PaymentStatus {
  // V3-MKT-62(round-16裁定・P2P決済ユーザー選択制): 既定=bank_transfer。直近 pay_confirm の
  // payload.method が "payjp_platform" のときだけ切り替わる(fee-routes.ts の
  // POST /market/listings/{id}/payjp-charge が system actor で append・後方互換=既存の
  // bank_transfer 専用 pay_confirm は payload.method 省略のまま bank_transfer 判定を維持)。
  method: "bank_transfer" | "payjp_platform";
  declared_at?: string; // 買主:振込済み申告(pay_declare・最初の申告時刻)
  confirmed_at?: string; // 売主:入金確認(pay_confirm・最初の確認時刻)
  declared_amount?: number; // V3-MKT-13: 買主の直近自己申告額(最新の pay_declare.amount)
  confirmed_amount?: number; // V3-MKT-13: 売主の直近確認額(最新の pay_confirm.amount)
  mismatch?: "partial" | "over"; // V3-MKT-13: 直近 pay_confirm の金額相違自己申告(省略=一致・自動制裁なし)
  payjp_charge_id?: string; // V3-MKT-63: method=payjp_platform のときの PAY.JP charge id(5%自動控除の照合用)
}

/** round-16 決済裁定(受領7): P2P=銀行振込既定・IHL非関与(「振込自動検知」前提は廃止)。
 * pay_declare/pay_confirm は tax_* と同型の listing state を動かさない経済副次イベント
 * (MARKET_EDGES 上は自己ループ)。都度投影する(常駐 DB 禁止・不変条項①)。
 * round-15裁定 V3-MKT-13: 銀行振込 P2P では売主の自己申告確認になったため、pay_confirm
 * に「金額相違」自己申告(payload.mismatch=partial|over)を許す。部分入金(partial)は
 * 義務が消えない(残債の再申告=買主が追加の pay_declare を再度行う想定)、過入金(over)は
 * 前払いクレジット扱いの記録のみ(返金・自動充当・自動制裁は行わない=ゆる運用)。 */
export function projectPayment(events: TxnEvent[]): PaymentStatus {
  const of = (kind: MarketKind) => sortEvents(events.filter((e) => e.kind === kind));
  const firstDeclare = of("pay_declare")[0];
  const firstConfirm = of("pay_confirm")[0];
  const declares = of("pay_declare");
  const confirms = of("pay_confirm");
  const lastDeclare = declares[declares.length - 1];
  const lastConfirm = confirms[confirms.length - 1];
  const mismatchRaw = (lastConfirm?.payload as { mismatch?: unknown } | undefined)?.mismatch;
  const lastConfirmPayload = lastConfirm?.payload as { method?: unknown; charge_id?: unknown } | undefined;
  const method = lastConfirmPayload?.method === "payjp_platform" ? "payjp_platform" : "bank_transfer";
  return {
    method,
    declared_at: firstDeclare?.created_at,
    confirmed_at: firstConfirm?.created_at,
    declared_amount: lastDeclare?.amount,
    confirmed_amount: lastConfirm?.amount,
    mismatch: mismatchRaw === "partial" || mismatchRaw === "over" ? mismatchRaw : undefined,
    payjp_charge_id: method === "payjp_platform" && typeof lastConfirmPayload?.charge_id === "string" ? lastConfirmPayload.charge_id : undefined,
  };
}

export interface CancelRequestStatus {
  status: "none" | "pending" | "approved" | "declined";
  requested_by?: string;
  requested_at?: string;
  reason?: string;
}

/** HANDOFF §3.4 残作業: 猶予キャンセル窓(60分)が閉じた後の相手承認制キャンセル依頼
 * フロー。cancel_request(どちらの当事者でも)→ 相手方の cancel_approve(実際の
 * cancel 遷移=cancelled)/cancel_decline(却下・matched のまま)の2段階。都度投影
 * (常駐 DB 禁止・不変条項①): 3 kind を時系列に畳み、直近の request が応答(approve/
 * decline)済みかどうかで pending/approved/declined/none を判定する。却下後に再度
 * request すれば新しい pending へ戻る(1回却下されたら永久に不可、ではない)。 */
export function projectCancelRequest(events: TxnEvent[]): CancelRequestStatus {
  const relevant = sortEvents(
    events.filter((e) => e.kind === "cancel_request" || e.kind === "cancel_approve" || e.kind === "cancel_decline"),
  );
  let pending: TxnEvent | undefined;
  let out: CancelRequestStatus = { status: "none" };
  for (const e of relevant) {
    if (e.kind === "cancel_request") {
      pending = e;
      const reason = (e.payload as { reason?: unknown } | undefined)?.reason;
      out = {
        status: "pending",
        requested_by: e.actor_id,
        requested_at: e.created_at,
        reason: typeof reason === "string" ? reason : undefined,
      };
    } else if (pending && (e.kind === "cancel_approve" || e.kind === "cancel_decline")) {
      out = { ...out, status: e.kind === "cancel_approve" ? "approved" : "declined" };
      pending = undefined;
    }
  }
  return out;
}

export interface ShippingLink {
  url?: string; // V3-MKT-20: 外部住所入力 URL(日本郵便『ゆうパックスマホ割』等)。内容の適法性は未検証(round-16裁定・断定しない)
  posted_by?: string;
  posted_at?: string;
}

/** V3-MKT-20(round-15裁定・匿名配送=外部URL中継): システムは住所を一切保持せず、
 * 売り手が中継する外部URLを relay するだけ(ihl.mkt.transaction_event.v1 kind=ship_link
 * の payload.external_shipping_url)。都度投影・最新の1件を採用(直近の再送で更新可能)。 */
export function projectShippingLink(events: TxnEvent[]): ShippingLink {
  const links = sortEvents(events.filter((e) => e.kind === "ship_link"));
  const last = links[links.length - 1];
  if (!last) return {};
  const urlRaw = (last.payload as { external_shipping_url?: unknown } | undefined)?.external_shipping_url;
  return {
    url: typeof urlRaw === "string" ? urlRaw : undefined,
    posted_by: last.actor_id,
    posted_at: last.created_at,
  };
}

/** 状態機械5脚③(48h 未入金→自動キャンセル+再出品+no-pay マーク・批評R4脚③)。matched の
 * まま NO_PAY_CANCEL_HOURS 経過し pay_confirm がまだ無いなら due=true。read-time 判定
 * (cron 不要): state が matched を離れる(ship/cancel 済み)と自動的に対象外になる。 */
export function isNoPayCancelDue(events: TxnEvent[], now: Date): boolean {
  const listingId = events[0]?.listing_id;
  if (!listingId) return false;
  const cur = reduceMarket(listingId, events);
  if (cur.state !== "matched") return false;
  if (events.some((e) => e.kind === "pay_confirm")) return false; // 入金確認済みは対象外
  const matchedAt = sortEvents(events.filter((e) => e.kind === "match"))[0]?.created_at;
  if (!matchedAt) return false;
  return now.getTime() - new Date(matchedAt).getTime() >= NO_PAY_CANCEL_HOURS * HOUR_MS;
}

/** 猶予キャンセル(成立後 GRACE_CANCEL_MINUTES は買い手が無条件・無料でキャンセル可能・
 * 批評R4)の残窓。窓が閉じた後の相手承認制キャンセル依頼フローは本波対象外(残課題)。 */
export function isGraceCancelWindowOpen(events: TxnEvent[], now: Date): boolean {
  const matchedAt = sortEvents(events.filter((e) => e.kind === "match"))[0]?.created_at;
  if (!matchedAt) return false;
  return now.getTime() - new Date(matchedAt).getTime() < GRACE_CANCEL_MINUTES * MINUTE_MS;
}

/** 状態機械5脚②(承諾制オファーへの無応答=自動辞退・24h)の read-time 判定。offer/
 * love_letter イベント単体の created_at を渡す(呼び出し側で対象オファーを特定)。 */
export function isOfferExpired(offerCreatedAt: string, now: Date): boolean {
  return now.getTime() - new Date(offerCreatedAt).getTime() >= OFFER_RESPONSE_HOURS * HOUR_MS;
}

export interface LineageLink {
  from: string;
  to: string;
  at: string;
  carried_observations: string[];
}

/** 所有権系譜(MKT-29)。transfer イベントを時系列に連結し観測データ引継ぎを一本の
 * 系譜へ。payload.external===true の移転は観測を引き継がない(外部持出=経済圏外)。 */
export function projectOwnershipLineage(events: TxnEvent[]): { chain: LineageLink[] } {
  const chain = sortEvents(events.filter((e) => e.kind === "transfer" && !!e.counterparty)).map((e) => ({
    from: e.actor_id,
    to: e.counterparty as string,
    at: e.created_at,
    carried_observations: e.payload?.external === true ? [] : (e.individual_ids ?? []),
  }));
  return { chain };
}

// ── V3-MKT-09(w2-mkt): マーケット既定ソート「好み新着順」───────────────────
// score = Σ(weight[tag] × normalizedValue[tag])。数値タグは (value-min)/(max-min)、
// カテゴリタグは一致度 1/0.5/0、価格タグは 1-(price/maxPrice)。weight は「重み」の
// 実数値であり本要件が求める『係数』そのもの — round-19裁定は算式を承認しただけで
// 具体的な重み値は確定していない(「将来的にはユーザーがこの計算式もフォークで
// 作ったりする」=可変であることが仕様)ため、ここでは重みをハードコードせず呼び
// 出し側(将来の GUI/フォーク)からの入力として受け取る純関数にする(MKT-25/36と
// 同種の「係数は決め打ちしない」判断)。
export type PreferenceTagKind = "numeric" | "category" | "price";
export interface PreferenceTagSpec {
  kind: PreferenceTagKind;
  weight: number;
  min?: number; // numeric/price 用
  max?: number; // numeric/price 用
  categoryMatch?: 1 | 0.5 | 0; // category 用(呼び出し側が一致度を算出済みで渡す)
}

function normalizedTagValue(spec: PreferenceTagSpec, rawValue: number | undefined): number {
  if (spec.kind === "category") return spec.categoryMatch ?? 0;
  if (rawValue === undefined) return 0;
  if (spec.kind === "price") {
    const maxPrice = spec.max ?? 0;
    return maxPrice > 0 ? Math.max(0, 1 - rawValue / maxPrice) : 0;
  }
  // numeric
  const min = spec.min ?? 0;
  const max = spec.max ?? 0;
  return max > min ? (rawValue - min) / (max - min) : 0;
}

export interface PreferenceScoreResult {
  score: number;
  matchPercent: number; // 0-100(スコアを % 表示に丸めた一致度)
  tagContributions: Record<string, number>;
}

/** V3-MKT-09: 出品1件のタグ値(rawValues)と重み設定(specs)から score/一致度%を
 * 算出する純関数。weight はゼロなら寄与しない(重み未設定タグは自動的に無視)。 */
export function computePreferenceScore(
  specs: Record<string, PreferenceTagSpec>,
  rawValues: Record<string, number | undefined>,
): PreferenceScoreResult {
  let score = 0;
  let weightSum = 0;
  const tagContributions: Record<string, number> = {};
  for (const [tag, spec] of Object.entries(specs)) {
    const normalized = normalizedTagValue(spec, rawValues[tag]);
    const contribution = spec.weight * normalized;
    tagContributions[tag] = contribution;
    score += contribution;
    weightSum += spec.weight;
  }
  const matchPercent = weightSum > 0 ? Math.round((score / weightSum) * 100) : 0;
  return { score, matchPercent, tagContributions };
}

/** V3-MKT-09: 「良い点/惜しい点」自動生成テキスト。寄与度上位1件を良い点、
 * 下位1件(スコア>0のタグの中で最小)を惜しい点として返す(単純な最大/最小選出・
 * 文言テンプレは呼び出し側 UI が翻訳/整形する前提の tag 名のみ返す=I18-06 不変
 * 条項①=常駐サーバ翻訳を持たない)。 */
export function preferenceHighlights(
  tagContributions: Record<string, number>,
): { strongestTag?: string; weakestTag?: string } {
  const entries = Object.entries(tagContributions);
  if (entries.length === 0) return {};
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  return { strongestTag: sorted[0]?.[0], weakestTag: sorted[sorted.length - 1]?.[0] };
}

export interface Fees {
  civilization: number; // 3% 文明拠出
  maintenance_tax: number; // 5% 維持費税(round-15で8%から引き下げ)
  fork_rebate: number; // 10% 原作者還元(fork 由来のみ)
}

/** 取引総額から各拠出を算出(MKT-36)。OSS 非商用(commercial=false)は経済圏外=全 0。
 * fork_rebate は fork 由来(forked=true)のときだけ。定数は economy-constants で凍結。 */
export function computeFees(gross: number, opts: { commercial: boolean; forked: boolean }): Fees {
  if (!opts.commercial) return { civilization: 0, maintenance_tax: 0, fork_rebate: 0 };
  return {
    civilization: Math.round(gross * FEE_COMMERCIAL_RATE),
    maintenance_tax: Math.round(gross * FEE_MAINTENANCE_TAX_RATE),
    fork_rebate: opts.forked ? Math.round(gross * FEE_FORK_REVENUE_RATE) : 0,
  };
}
