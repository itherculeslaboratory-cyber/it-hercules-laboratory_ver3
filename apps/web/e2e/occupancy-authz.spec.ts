import { test, expect, request, type APIRequestContext } from "@playwright/test";

// Occupancy ownership trust boundary (wave1-obs Task 1 — persona R75): a
// shelf QR lets a caller LINK their OWN individual to a placement, but must
// never let them claim someone else's individual by writing an occupancy
// directly (that must go through Market transfer + consent). This mirrors
// observation.spec.ts's "API semantics guard" suite's magic-link auth
// pattern (2 independent principals, no browser needed — API-level authz
// check) rather than reusing the single shared dev-login session every other
// e2e spec uses.
const API = "http://127.0.0.1:8787";

async function newPrincipal(email: string): Promise<{ api: APIRequestContext; actorId: string }> {
  const anon: APIRequestContext = await request.newContext({ baseURL: API });
  const mlRes = await anon.post("/api/v1/auth/magic-link", { data: { email } });
  expect(mlRes.status()).toBe(202);
  const ml = await mlRes.json();
  const verifyRes = await anon.post("/api/v1/auth/verify", { data: { token: ml.dev_magic_token } });
  expect(verifyRes.status()).toBe(200);
  const actorId = (await verifyRes.json()).actor_id;
  const setCookie = verifyRes.headersArray().find((h) => h.name.toLowerCase() === "set-cookie");
  const sessionToken = setCookie!.value.slice("ihl_session=".length).split(";")[0];
  await anon.dispose();
  const api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${sessionToken}` } });
  return { api, actorId };
}

test("POST /occupancy rejects linking an individual the caller does not own (403 NOT_OWNER), no write", async () => {
  const tag = Date.now().toString(36);
  const a = await newPrincipal(`e2e-owner-a-${tag}@ihl.local`);
  const b = await newPrincipal(`e2e-owner-b-${tag}@ihl.local`);

  // A creates individual X — A is its owner (creator, no transfer yet).
  const indRes = await a.api.post("/api/v1/individuals", { data: { local_label_text: `E2E-OWN-${tag}` } });
  expect(indRes.status()).toBe(201);
  const individualId = (await indRes.json()).individual_id as string;
  expect(individualId).toBeTruthy();

  const plRes = await a.api.post("/api/v1/placements", { data: { label: `E2E-SHELF-${tag}` } });
  expect(plRes.status()).toBe(201);
  const placementId = (await plRes.json()).placement_id as string;

  // B (NOT the owner) attempts to link X to the shelf directly — must be
  // denied (fail-closed authz), not silently written.
  const forbidden = await b.api.post("/api/v1/occupancy", {
    data: { placement_id: placementId, subject_ref: `individual/${individualId}` },
  });
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toEqual({ error: "NOT_OWNER" });

  // Nothing was written for either party's occupancy list.
  const bList = await b.api.get("/api/v1/occupancy");
  expect((await bList.json()).occupancy).toEqual([]);
  const aList = await a.api.get("/api/v1/occupancy");
  expect((await aList.json()).occupancy).toEqual([]);

  // A (the actual owner) CAN link their own individual.
  const allowed = await a.api.post("/api/v1/occupancy", {
    data: { placement_id: placementId, subject_ref: `individual/${individualId}` },
  });
  expect(allowed.status()).toBe(201);
  const allowedBody = await allowed.json();
  expect(allowedBody.occupancy_id).toBeTruthy();

  const aListAfter = await a.api.get("/api/v1/occupancy");
  expect((await aListAfter.json()).occupancy).toHaveLength(1);

  await a.api.dispose();
  await b.api.dispose();
});
