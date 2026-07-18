// SECURITY: POST /events is a generic raw Truth-append — any authenticated
// user can putEvent ANY schema-valid envelope. It force-stamps
// provenance.actor_id but does nothing about the data body, so a caller could
// append e.g. an ihl.src.occupancy.v1 naming ANOTHER user's individual on
// their own shelf, bypassing the ownership authz POST /occupancy enforces
// (source-routes.ts projectCurrentOwner). index.ts ROUTE_ONLY_EVENT_TYPES
// denylists exactly the event types that have a dedicated authz'd route —
// this TC proves the denylist fires, that the conformance path (tag_event)
// used by cl-01..13/auth.test.ts stays green, and that the typed route the
// denylist points callers at still works.
import { describe, expect, it } from "vitest";
import { deriveActorId, TruthStore } from "@ihl/truth";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { AUTH_HEADERS, FakeR2Bucket, SESSION_SECRET, loadFixture, makeEnv, makeEnvelope } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, ...JSON_HEADERS };
}
async function sessionFor(email: string) {
  const actorId = await deriveActorId(email);
  const token = await issueSessionToken(actorId, SESSION_SECRET);
  return { actorId, headers: bearer(token) };
}

const TAG_DATASCHEMA = "schemas/frozen/tag-event.schema.json";
const tagSample = loadFixture("cl-shape-samples.json")["cl-13"] as Record<string, unknown>;

describe("POST /events refuses route-owned authz-sensitive event types", () => {
  it("ihl.src.occupancy.v1: regular user forging any individual on any placement -> 403 USE_TYPED_ROUTE, no occupancy event written", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const attacker = await sessionFor("attacker@example.com");
    const forged = makeEnvelope({
      type: "ihl.src.occupancy.v1",
      dataschema: "schemas/events/occupancy.schema.json",
      data: {
        occupancy_id: "occ-forged",
        actor_id: attacker.actorId,
        placement_id: "plc-attacker-shelf",
        subject_ref: "individual/some-victims-individual",
        effective_at: new Date().toISOString(),
        schema_version: "ihl.src.occupancy.v1",
      },
    });
    const res = await app.request(
      "/events",
      { method: "POST", headers: attacker.headers, body: JSON.stringify(forged) },
      env,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "USE_TYPED_ROUTE",
      type: "ihl.src.occupancy.v1",
      hint: "この型は専用の認可付きエンドポイント経由でのみ作成できます",
    });

    const written = await new TruthStore(bucket).listEvents("truth/ihl.src.occupancy.v1/");
    expect(written).toHaveLength(0);
  });

  it("ihl.mkt.transaction_event.v1: forged ownership-transfer envelope -> 403 USE_TYPED_ROUTE, no txn event written", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const attacker = await sessionFor("attacker2@example.com");
    const forged = makeEnvelope({
      type: "ihl.mkt.transaction_event.v1",
      dataschema: "schemas/events/mkt-transaction-event.schema.json",
      data: {
        listing_id: "listing-1",
        kind: "transfer",
        individual_ids: ["some-victims-individual"],
        counterparty: attacker.actorId,
        actor_id: attacker.actorId,
        created_at: new Date().toISOString(),
        schema_version: "1",
      },
    });
    const res = await app.request(
      "/events",
      { method: "POST", headers: attacker.headers, body: JSON.stringify(forged) },
      env,
    );
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: string; type: string }).toMatchObject({
      error: "USE_TYPED_ROUTE",
      type: "ihl.mkt.transaction_event.v1",
    });

    const written = await new TruthStore(bucket).listEvents("truth/ihl.mkt.transaction_event.v1/");
    expect(written).toHaveLength(0);
  });

  it("ihl.obs.tag_event.v1 conformance path is NOT denylisted — still 201 (cl-01..13/auth.test.ts unbroken)", async () => {
    const env = makeEnv();
    const good = makeEnvelope({
      type: "ihl.obs.tag_event.v1",
      dataschema: TAG_DATASCHEMA,
      data: tagSample,
    });
    const res = await app.request(
      "/events",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(good) },
      env,
    );
    expect(res.status).toBe(201);
  });

  it("typed route still works: POST /api/v1/occupancy for an individual the actor OWNS -> 201 (denylist did not break the legitimate path)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const owner = await sessionFor("owner@example.com");

    const createRes = await app.request(
      "/api/v1/individuals",
      { method: "POST", headers: owner.headers, body: JSON.stringify({ local_label_text: "my-lizard" }) },
      env,
    );
    expect(createRes.status).toBe(201);
    const { individual_id: individualId } = (await createRes.json()) as { individual_id: string };

    const occRes = await app.request(
      "/api/v1/occupancy",
      {
        method: "POST",
        headers: owner.headers,
        body: JSON.stringify({ placement_id: "plc-owner-shelf", subject_ref: `individual/${individualId}` }),
      },
      env,
    );
    expect(occRes.status).toBe(201);
    expect((await occRes.json()) as { occupancy_id: string }).toHaveProperty("occupancy_id");
  });
});
