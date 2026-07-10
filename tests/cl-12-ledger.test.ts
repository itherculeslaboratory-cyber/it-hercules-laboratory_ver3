// CL-12: カルマ/プラチナ台帳 append-only — schemas/frozen/ledger-entry.schema.json
// (oneOf karma_event / coin_event) + TruthStore に update/delete が存在しない
// こと自体が契約 (不変条項③)。
import { describe, expect, it } from "vitest";
import { TruthStore, validateFrozen } from "@ihl/truth";
import { FakeR2Bucket, loadFixture, makeEnvelope } from "./helpers";

const shapes = loadFixture("cl-shape-samples.json");
const karma = shapes["cl-12"] as Record<string, unknown>;
const coin = shapes["cl-12-coin"] as Record<string, unknown>;

describe("CL-12 ledger entry shape", () => {
  it("accepts the real ver2 karma_event sample", () => {
    expect(validateFrozen("ledger-entry", karma).valid).toBe(true);
  });

  it("accepts the real ver2 coin_event sample", () => {
    expect(validateFrozen("ledger-entry", coin).valid).toBe(true);
  });

  it("rejects a karma_event with an unknown layer", () => {
    const bad = { ...karma, layer: "bogus" };
    expect(validateFrozen("ledger-entry", bad).valid).toBe(false);
  });

  it("rejects a karma_event missing delta", () => {
    const bad = { ...karma };
    delete bad.delta;
    expect(validateFrozen("ledger-entry", bad).valid).toBe(false);
  });

  it("rejects a coin_event with negative grant_amount (grant-only ledger)", () => {
    const bad = { ...coin, grant_amount: -1 };
    expect(validateFrozen("ledger-entry", bad).valid).toBe(false);
  });

  it("rejects an unknown reason_code", () => {
    const bad = { ...karma, reason_code: "hacked" };
    expect(validateFrozen("ledger-entry", bad).valid).toBe(false);
  });

  it("rejects an entry matching neither karma nor coin variant", () => {
    expect(validateFrozen("ledger-entry", {}).valid).toBe(false);
  });
});

describe("CL-12 ledger append-only behaviour", () => {
  it("overwrite of an existing ledger event key is rejected", async () => {
    const store = new TruthStore(new FakeR2Bucket());
    const entry = makeEnvelope({
      type: "ihl.economy.karma_event.v1",
      dataschema: "schemas/frozen/ledger-entry.schema.json",
      data: karma,
    });
    expect((await store.putEvent(entry)).status).toBe("inserted");
    const overwrite = { ...entry, data: { ...karma, delta: 9999 } };
    expect((await store.putEvent(overwrite)).status).toBe("conflict");
  });

  it("TruthStore exposes NO update and NO delete (absence is the contract)", () => {
    const store = new TruthStore(new FakeR2Bucket());
    expect(typeof (store as Record<string, unknown>)["update"]).toBe(
      "undefined",
    );
    expect(typeof (store as Record<string, unknown>)["delete"]).toBe(
      "undefined",
    );
  });
});
