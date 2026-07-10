// CL-03: actor_id 解決 / セッション (振る舞い TC — schemas/frozen/README.md 担保先).
// Derivation layer is vectorable (fixtures/cl-03-actor-id-vectors.json,
// real ver2 hash_actor_id run). Session layer is NOT vectorable (opaque
// in-memory tokens) → per fixture guidance we assert the 401 contract shape.
import { describe, expect, it } from "vitest";
import { deriveActorId } from "@ihl/truth";
import app from "../apps/api/src/index";
import { loadFixture, makeEnv } from "./helpers";

type Vector = { raw: string; salt: string; actor_id: string };
const fixture = loadFixture<{ vectors: Vector[] }>(
  "cl-03-actor-id-vectors.json",
);

describe("CL-03 actor_id derivation (pure layer)", () => {
  it("matches every ver2 vector byte-for-byte", async () => {
    for (const v of fixture.vectors) {
      const got = await deriveActorId(v.raw, v.salt);
      expect(got, `raw=${JSON.stringify(v.raw)}`).toBe(v.actor_id);
    }
  });

  it("detects attribution break: different salt yields a different actor_id", async () => {
    const v = fixture.vectors[0];
    const got = await deriveActorId(v.raw, "some-other-salt");
    expect(got).not.toBe(v.actor_id);
  });

  it("detects attribution break: un-normalized input yields a different actor_id", async () => {
    // ver2 inconsistency (strip().lower() vs raw) — mixed case must NOT map
    // to the lowercase identity silently.
    const lower = await deriveActorId("synthetic-user-a", "ihl-pii-salt");
    const mixed = await deriveActorId("Synthetic-User-A", "ihl-pii-salt");
    expect(mixed).not.toBe(lower);
  });
});

describe("CL-03 session layer (HTTP contract shape)", () => {
  it("protected route without any token → 401 AUTH_REQUIRED", async () => {
    const res = await app.request("/events", { method: "GET" }, makeEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
  });

  it("protected route with an unknown/invalid token → 401", async () => {
    const res = await app.request(
      "/events",
      { method: "POST", headers: { Authorization: "Bearer bogus-token" } },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });
});
