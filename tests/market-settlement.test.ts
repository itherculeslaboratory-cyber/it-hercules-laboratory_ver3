// MKT-04 / MKT-10 決済投影の純関数 TC。成立=受取申告(receive)かつ評価確定(rate)、
// 8% 維持費税の未払いは成立後起算、配送(ship)+30 日 無評価の自動 good 境界(29/30/31
// 日を now 注入で検証)。自動 good の実 append と月次 Δcount 累積は cron=P6(design-k3
// §2.6・分離)。ここは純投影の境界のみ。
import { describe, expect, it } from "vitest";
import { projectSettlement, computeFees, type TxnEvent } from "../apps/api/src/market-settlement";
import { AUTO_GOOD_RATING_DAYS, FEE_MAINTENANCE_TAX_RATE } from "../apps/api/src/economy-constants";

function ev(kind: TxnEvent["kind"], at: string): TxnEvent {
  return { transaction_event_id: kind + at, listing_id: "L1", actor_id: "a", kind, created_at: at };
}
const NOW0 = new Date("2026-07-11T00:00:00Z");
const SHIP_AT = "2026-07-11T00:00:00Z";
function plusDays(base: string, d: number): Date {
  return new Date(new Date(base).getTime() + d * 86_400_000);
}

describe("MKT-04 成立=receive かつ rate", () => {
  it("receive だけでは未成立、rate も揃って初めて成立", () => {
    const receiveOnly = projectSettlement(
      [ev("ship", "2026-07-11T00:00:00Z"), ev("receive", "2026-07-11T00:01:00Z")],
      NOW0,
    );
    expect(receiveOnly.settled).toBe(false);

    const both = projectSettlement(
      [
        ev("ship", "2026-07-11T00:00:00Z"),
        ev("receive", "2026-07-11T00:01:00Z"),
        ev("rate", "2026-07-11T00:02:00Z"),
      ],
      NOW0,
    );
    expect(both.settled).toBe(true);
    expect(both.settled_at).toBe("2026-07-11T00:02:00Z"); // receive/rate の遅い方
    expect(both.fee_unpaid_started_at).toBe("2026-07-11T00:02:00Z"); // 8% fee は成立後起算
  });

  it("tax_pay(全額消込)で未払い起算が停止する", () => {
    const s = projectSettlement(
      [
        ev("receive", "2026-07-11T00:01:00Z"),
        ev("rate", "2026-07-11T00:02:00Z"),
        ev("tax_pay", "2026-07-11T00:03:00Z"),
      ],
      NOW0,
    );
    expect(s.settled).toBe(true);
    expect(s.fee_unpaid_started_at).toBeUndefined();
  });
});

describe("MKT-04 自動 good 境界(配送 + 30 日 無評価)", () => {
  const shipped = [ev("ship", SHIP_AT), ev("receive", "2026-07-11T00:05:00Z")];
  it("29 日: 未到来", () => {
    expect(projectSettlement(shipped, plusDays(SHIP_AT, AUTO_GOOD_RATING_DAYS - 1)).auto_good_due).toBe(false);
  });
  it("30 日: 到来", () => {
    expect(projectSettlement(shipped, plusDays(SHIP_AT, AUTO_GOOD_RATING_DAYS)).auto_good_due).toBe(true);
  });
  it("31 日: 到来", () => {
    expect(projectSettlement(shipped, plusDays(SHIP_AT, AUTO_GOOD_RATING_DAYS + 1)).auto_good_due).toBe(true);
  });
  it("既に評価済みなら自動 good は起きない", () => {
    expect(
      projectSettlement([...shipped, ev("rate", "2026-07-11T00:06:00Z")], plusDays(SHIP_AT, 60)).auto_good_due,
    ).toBe(false);
  });
});

describe("MKT-10 8% 維持費税負債額", () => {
  it("成立取引の税は総額の 8%", () => {
    const tax = computeFees(50000, { commercial: true, forked: false }).maintenance_tax;
    expect(tax).toBe(Math.round(50000 * FEE_MAINTENANCE_TAX_RATE));
    expect(tax).toBe(4000);
  });
});
