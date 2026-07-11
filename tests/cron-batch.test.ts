// C5 K3 月次 cron handleScheduled 検証（design-k3 §2.6）。KRM-11 fork/vote 還元・
// KRM-12 dry 軸救済鋳造・MKT-04 自動良評価・MKT-10 fee_unpaid 月次 Fib Δcount を、
// 時刻注入で境界検証する。全ジョブは deterministic key の put-if-absent で冪等。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import { FakeR2Bucket } from "./helpers";
import { projectLedger } from "../apps/api/src/ledger-routes";
import { CONTRIBUTION_TYPE } from "../apps/api/src/contribution";
import {
  krmDryAxisMercyMint,
  krmForkVoteRebate,
  mktAutoGoodRatings,
  mktFeeUnpaidPenalty,
} from "../apps/api/src/batch";

const TXN_TYPE = "ihl.mkt.transaction_event.v1";
const RATING_TYPE = "ihl.mkt.rating.v1";

async function putContribution(
  s: TruthStore,
  p: { actor: string; axis: string; delta: number; source: string; source_ref?: string; id?: string; created_at: string },
) {
  const eid = p.id ?? ulid();
  await s.putEvent({
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: CONTRIBUTION_TYPE,
    time: p.created_at,
    dataschema: "schemas/events/economy-contribution-event.schema.json",
    provenance: { generator_kind: "human", actor_id: p.actor },
    data: {
      contribution_event_id: eid,
      node_id: "node-1",
      actor_id: p.actor,
      axis: p.axis,
      delta: p.delta,
      source: p.source,
      ...(p.source_ref ? { source_ref: p.source_ref } : {}),
      created_at: p.created_at,
      schema_version: "1",
    },
  });
}

async function putTxn(
  s: TruthStore,
  p: { listing: string; actor: string; kind: string; counterparty?: string; created_at: string },
) {
  const id = ulid();
  await s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: TXN_TYPE,
    time: p.created_at,
    dataschema: "schemas/events/mkt-transaction-event.schema.json",
    provenance: { generator_kind: "human", actor_id: p.actor },
    data: {
      transaction_event_id: id,
      listing_id: p.listing,
      actor_id: p.actor,
      kind: p.kind,
      ...(p.counterparty ? { counterparty: p.counterparty } : {}),
      created_at: p.created_at,
      schema_version: "1",
    },
  });
}

const JULY = new Date("2026-07-25T15:00:00Z");

describe("KRM-12 dry-axis mercy mint (Fib threshold step-down, floor 100)", () => {
  it("dry axis mints a mercy coin, wet axis (contribution this month) does not", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    // research: score 350 from LAST month (July dry) -> minted 2, carry 150 >= lowered 100 -> mint.
    await putContribution(s, { actor: "u1", axis: "research", delta: 350, source: "manual", created_at: "2026-06-10T00:00:00Z" });
    // capital: score 350 but a contribution THIS month -> wet -> no mint.
    await putContribution(s, { actor: "u1", axis: "capital", delta: 350, source: "manual", created_at: "2026-07-10T00:00:00Z" });

    await krmDryAxisMercyMint(s, JULY);

    expect((await projectLedger(s, "u1")).platinum_coins).toBe(1); // only research mints
  });

  it("idempotent: two runs in the same month mint once", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await putContribution(s, { actor: "u1", axis: "research", delta: 350, source: "manual", created_at: "2026-06-10T00:00:00Z" });
    await krmDryAxisMercyMint(s, JULY);
    await krmDryAxisMercyMint(s, JULY);
    expect((await projectLedger(s, "u1")).platinum_coins).toBe(1);
  });

  it("carry below the lowered threshold does not mint", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    // score 250 -> minted 2, carry 50 < lowered 100 -> no mint.
    await putContribution(s, { actor: "u2", axis: "research", delta: 250, source: "manual", created_at: "2026-06-10T00:00:00Z" });
    await krmDryAxisMercyMint(s, JULY);
    expect((await projectLedger(s, "u2")).platinum_coins).toBe(0);
  });
});

describe("KRM-11 fork/vote platinum rebate to upstream author (10%)", () => {
  it("fork source rebates 10% to source_ref upstream; non-fork source does not", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await putContribution(s, { actor: "down1", axis: "development", delta: 100, source: "fork", source_ref: "up1", id: "c-fork", created_at: "2026-07-05T00:00:00Z" });
    await putContribution(s, { actor: "down2", axis: "development", delta: 100, source: "github", source_ref: "up2", id: "c-gh", created_at: "2026-07-05T00:00:00Z" });

    await krmForkVoteRebate(s, JULY);

    expect((await projectLedger(s, "up1")).platinum_coins).toBe(10); // floor(100 * 0.10)
    expect((await projectLedger(s, "up2")).platinum_coins).toBe(0); // github is not fork/vote
  });

  it("idempotent: two runs rebate once per source event", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await putContribution(s, { actor: "down1", axis: "development", delta: 100, source: "vote", source_ref: "up1", id: "c-vote", created_at: "2026-07-05T00:00:00Z" });
    await krmForkVoteRebate(s, JULY);
    await krmForkVoteRebate(s, JULY);
    expect((await projectLedger(s, "up1")).platinum_coins).toBe(10);
  });
});

describe("MKT-04 auto-good rating after ship + 30 days with no rating", () => {
  it("appends grade:good auto:true for the seller and is idempotent", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await putTxn(s, { listing: "L1", actor: "seller", kind: "list_fixed", created_at: "2026-06-01T00:00:00Z" });
    await putTxn(s, { listing: "L1", actor: "seller", kind: "match", counterparty: "buyer", created_at: "2026-06-02T00:00:00Z" });
    await putTxn(s, { listing: "L1", actor: "seller", kind: "ship", created_at: "2026-06-03T00:00:00Z" });

    await mktAutoGoodRatings(s, new Date("2026-07-10T00:00:00Z")); // 37 days after ship

    const rating = await s.readEvent(`truth/${RATING_TYPE}/auto-L1.json`);
    expect(rating).not.toBeNull();
    const d = (rating as { data: Record<string, unknown> }).data;
    expect(d.grade).toBe("good");
    expect(d.auto).toBe(true);
    expect(d.ratee_id).toBe("seller");

    // idempotent: second run does not add another auto rating for L1.
    await mktAutoGoodRatings(s, new Date("2026-07-11T00:00:00Z"));
    const ratings = (await s.listEvents(`truth/${RATING_TYPE}/`)).filter(
      (e) => (e.data as { listing_id?: string }).listing_id === "L1",
    );
    expect(ratings.length).toBe(1);
  });

  it("no auto rating before the 30-day boundary", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await putTxn(s, { listing: "L9", actor: "seller", kind: "list_fixed", created_at: "2026-06-01T00:00:00Z" });
    await putTxn(s, { listing: "L9", actor: "seller", kind: "match", counterparty: "buyer", created_at: "2026-06-02T00:00:00Z" });
    await putTxn(s, { listing: "L9", actor: "seller", kind: "ship", created_at: "2026-06-03T00:00:00Z" });
    await mktAutoGoodRatings(s, new Date("2026-06-20T00:00:00Z")); // 17 days
    expect(await s.readEvent(`truth/${RATING_TYPE}/auto-L9.json`)).toBeNull();
  });
});

describe("MKT-10 fee_unpaid monthly Fibonacci penalty", () => {
  async function settledUnpaid(s: TruthStore) {
    await putTxn(s, { listing: "L2", actor: "seller", kind: "list_fixed", created_at: "2026-05-01T00:00:00Z" });
    await putTxn(s, { listing: "L2", actor: "seller", kind: "match", counterparty: "buyer", created_at: "2026-05-02T00:00:00Z" });
    await putTxn(s, { listing: "L2", actor: "seller", kind: "ship", created_at: "2026-05-03T00:00:00Z" });
    await putTxn(s, { listing: "L2", actor: "buyer", kind: "receive", created_at: "2026-05-10T00:00:00Z" });
    await putTxn(s, { listing: "L2", actor: "buyer", kind: "rate", created_at: "2026-05-11T00:00:00Z" });
  }

  it("one Fibonacci count step per month for the seller, idempotent within a month", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await settledUnpaid(s);

    await mktFeeUnpaidPenalty(s, new Date("2026-06-25T15:00:00Z"));
    let p = await projectLedger(s, "seller");
    expect(p.karma_count).toBe(1);
    expect(p.karma_value).toBe(-1); // fibPenalty(0,1) = 1

    // idempotent: second run in June does not double-penalize.
    await mktFeeUnpaidPenalty(s, new Date("2026-06-25T15:00:00Z"));
    p = await projectLedger(s, "seller");
    expect(p.karma_count).toBe(1);
    expect(p.karma_value).toBe(-1);
  });

  it("tax_pay stops the penalty (fee_unpaid started_at clears)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await settledUnpaid(s);
    await mktFeeUnpaidPenalty(s, new Date("2026-06-25T15:00:00Z")); // count 1
    await putTxn(s, { listing: "L2", actor: "seller", kind: "tax_pay", created_at: "2026-06-28T00:00:00Z" });

    await mktFeeUnpaidPenalty(s, new Date("2026-07-25T15:00:00Z")); // paid -> no new penalty
    expect((await projectLedger(s, "seller")).karma_count).toBe(1);
  });
});
