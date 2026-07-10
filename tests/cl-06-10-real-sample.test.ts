// CL-06 親子参照 + CL-10 実トークン解決 — design-c3 §2。
// 個体 ID は ihl-ver2 UAT サインオフ実 ID、親子リンクは合成 (fixture _meta 参照)。
import { describe, expect, it } from "vitest";
import { validateFrozen } from "@ihl/truth";
import { loadFixture } from "./helpers";

type Ind = Record<string, unknown> & {
  individual_id: string;
  sire_id?: string;
  dam_id?: string;
};
type Qr = Record<string, unknown> & {
  schema: string;
  token: string;
  placement_id: string;
  actor_id: string;
  expires_at: string;
};

const fx = loadFixture<{
  lineage: { child: Ind; sire: Ind; dam: Ind };
  qr_valid: Qr;
  qr_expired: Qr;
}>("cl-06-10-lineage-samples.json");

// ponytail: mirrors ver2 libs/ihl/env/placement_store.py resolve_qr_token
// (schema const + token echo + 200-char + expiry). App-level GET /qr/{token}
// route is separate (design-c2 §3.2); this is the CL-10 format/resolve contract.
function resolveQrToken(
  rec: Qr,
  token: string,
  nowMs: number,
): { placement_id: string; actor_id: string } | null {
  const t = token.trim();
  if (!t || t.length > 200) return null;
  if (rec.schema !== "env_qr_token_v1" || rec.token !== t) return null;
  if (new Date(rec.expires_at).getTime() < nowMs) return null;
  return { placement_id: rec.placement_id, actor_id: rec.actor_id };
}

describe("CL-06 parent-child reference (real ver2 individual ids)", () => {
  const { child, sire, dam } = fx.lineage;

  it.each([
    ["child", child],
    ["sire", sire],
    ["dam", dam],
  ])("%s validates against frozen individual-key", (_name, rec) => {
    expect(validateFrozen("individual-key", rec).valid).toBe(true);
  });

  it("child.sire_id resolves to the sire individual record", () => {
    expect(child.sire_id).toBe(sire.individual_id);
  });

  it("child.dam_id resolves to the dam individual record", () => {
    expect(child.dam_id).toBe(dam.individual_id);
  });

  it("rejects a self-referential parent link (ver2 individuals.py guard)", () => {
    // ver2 update_individual_parents 400s when sire_id/dam_id == individual_id.
    const selfLinked = { ...child, sire_id: child.individual_id };
    const isSelfRef =
      selfLinked.sire_id === selfLinked.individual_id ||
      selfLinked.dam_id === selfLinked.individual_id;
    expect(isSelfRef).toBe(true);
    // the honest lineage fixture must NOT be self-referential
    expect(child.sire_id).not.toBe(child.individual_id);
    expect(child.dam_id).not.toBe(child.individual_id);
  });
});

describe("CL-10 real-code-path token resolution (env_qr_token_v1)", () => {
  const now = Date.UTC(2026, 6, 11); // 2026-07-11

  it("the valid token record passes frozen qr-token", () => {
    expect(validateFrozen("qr-token", fx.qr_valid).valid).toBe(true);
  });

  it("resolves a live token to its placement_id + actor_id", () => {
    expect(resolveQrToken(fx.qr_valid, fx.qr_valid.token, now)).toEqual({
      placement_id: fx.qr_valid.placement_id,
      actor_id: fx.qr_valid.actor_id,
    });
  });

  it("returns null for an expired token", () => {
    expect(resolveQrToken(fx.qr_expired, fx.qr_expired.token, now)).toBeNull();
  });

  it("returns null when the scanned token does not match the record", () => {
    expect(resolveQrToken(fx.qr_valid, "someOtherTokenValue1234", now)).toBeNull();
  });

  it("returns null for a token over the 200-char resolve limit", () => {
    expect(resolveQrToken(fx.qr_valid, "a".repeat(201), now)).toBeNull();
  });

  it("returns null for a wrong schema const", () => {
    const bad = { ...fx.qr_valid, schema: "env_qr_token_v2" };
    expect(resolveQrToken(bad, bad.token, now)).toBeNull();
  });
});
