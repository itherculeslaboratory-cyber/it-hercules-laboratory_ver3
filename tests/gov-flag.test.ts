// Flag 不使用フラグ TC(design-c5.md §K6 §4 / V3-GOV-09)。flag event が R2 DELETE せず append され、
// 対象 owner に grantKarmaCountIncrease(steps=10)で Δcount+10 とフィボナッチ減点が台帳 append
// される。route は requireRole("operator","admin") で fail-closed(GOV-09 ハード完了条件)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { projectLedger } from "../apps/api/src/ledger-routes";
import { issueSessionToken } from "../apps/api/src/session";
import { GOV_FLAG_COUNT_STEPS } from "../apps/api/src/plaza-constants";
import { TruthStore } from "@ihl/truth";
import { AUTH_HEADERS, FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

async function operatorHeaders() {
  const tok = await issueSessionToken("operator-1", SESSION_SECRET, ["operator"]);
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}

function postFlag(env: ReturnType<typeof makeEnv>, body: Record<string, unknown>, headers: Record<string, string>) {
  return app.request("/api/v1/gov/flags", { method: "POST", headers, body: JSON.stringify(body) }, env);
}

describe("gov flag not-in-use (GOV-09)", () => {
  it("appends a flag event (no R2 DELETE) and charges the target owner dcount+10 with a fib penalty", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const headers = await operatorHeaders();

    const before = await projectLedger(new TruthStore(bucket), "owner-x");
    expect(before.karma_count).toBe(0);

    const res = await postFlag(env, { target_type: "listing", target_id: "L-1", target_owner: "owner-x", reason: "stale listing" }, headers);
    expect(res.status).toBe(201);

    // append-only: the flag object exists (logical invalidation, never DELETE).
    const flagKeys = [...bucket.objects.keys()].filter((k) => k.startsWith("truth/ihl.gov.flag.v1/"));
    expect(flagKeys.length).toBe(1);

    const after = await projectLedger(new TruthStore(bucket), "owner-x");
    expect(after.karma_count).toBe(GOV_FLAG_COUNT_STEPS); // dcount +10
    expect(after.karma_value).toBeLessThan(before.karma_value); // fibonacci value penalty applied
  });

  it("rejects a flag missing the target_owner", async () => {
    const env = makeEnv();
    const res = await postFlag(env, { target_type: "listing", target_id: "L-2" }, await operatorHeaders());
    expect(res.status).toBe(400);
  });
});

describe("gov flag route is role-gated (fail-closed)", () => {
  it("returns 401 unauthenticated", async () => {
    const env = makeEnv();
    const r = await app.request("/api/v1/gov/flags", { method: "POST", body: "{}" }, env);
    expect(r.status).toBe(401);
  });

  it("returns 403 for an authenticated non-operator (DEV_TOKEN roles=[]) and appends nothing", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const r = await postFlag(env, { target_type: "listing", target_id: "L-3", target_owner: "owner-y", reason: "grief attempt" }, AUTH_HEADERS);
    expect(r.status).toBe(403);
    const flagKeys = [...bucket.objects.keys()].filter((k) => k.startsWith("truth/ihl.gov.flag.v1/"));
    expect(flagKeys.length).toBe(0);
    const after = await projectLedger(new TruthStore(bucket), "owner-y");
    expect(after.karma_count).toBe(0); // no penalty was charged
  });

  it("returns 403 for a plain member session (roles=['member'])", async () => {
    const env = makeEnv();
    const tok = await issueSessionToken("member-1", SESSION_SECRET, ["member"]);
    const r = await postFlag(env, { target_type: "listing", target_id: "L-4", target_owner: "owner-z", reason: "x" }, { Authorization: `Bearer ${tok}`, "content-type": "application/json" });
    expect(r.status).toBe(403);
  });
});
