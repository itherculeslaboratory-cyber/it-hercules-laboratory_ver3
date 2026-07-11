// MKT-29 所有権系譜の純関数 TC。transfer イベントを時系列に連結し、観測データを
// 引き継ぐ一本の系譜へ。payload.external===true は観測を引き継がない(design-k3 §2.3)。
import { describe, expect, it } from "vitest";
import { projectOwnershipLineage, type TxnEvent } from "../apps/api/src/market-settlement";

function transfer(
  id: string,
  from: string,
  to: string,
  individual_ids: string[],
  external: boolean,
  at: string,
): TxnEvent {
  return {
    transaction_event_id: id,
    listing_id: "L1",
    actor_id: from,
    kind: "transfer",
    counterparty: to,
    individual_ids,
    payload: external ? { external: true } : undefined,
    created_at: at,
  };
}

describe("MKT-29 projectOwnershipLineage", () => {
  it("成立の移転は個体を買い手へ移し観測を引き継ぐ", () => {
    const { chain } = projectOwnershipLineage([
      transfer("1", "A", "B", ["X"], false, "2026-07-11T00:00:01Z"),
    ]);
    expect(chain).toEqual([
      { from: "A", to: "B", at: "2026-07-11T00:00:01Z", carried_observations: ["X"] },
    ]);
  });

  it("external フラグの移転は観測を引き継がない", () => {
    const { chain } = projectOwnershipLineage([
      transfer("1", "A", "B", ["X"], true, "2026-07-11T00:00:01Z"),
    ]);
    expect(chain[0].carried_observations).toEqual([]);
  });

  it("A→B→C を時系列で連結する(入力順不同でも)", () => {
    const { chain } = projectOwnershipLineage([
      transfer("2", "B", "C", ["X"], false, "2026-07-11T00:00:02Z"),
      transfer("1", "A", "B", ["X"], false, "2026-07-11T00:00:01Z"),
    ]);
    expect(chain.map((l) => [l.from, l.to])).toEqual([
      ["A", "B"],
      ["B", "C"],
    ]);
  });

  it("transfer 以外のイベントは系譜に載らない", () => {
    const { chain } = projectOwnershipLineage([
      { transaction_event_id: "1", listing_id: "L1", actor_id: "A", kind: "ship", created_at: "2026-07-11T00:00:01Z" },
    ]);
    expect(chain).toEqual([]);
  });
});
