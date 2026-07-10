// CL-01: R2 INSERT ONLY / no-overwrite (振る舞い TC — schemas/frozen/README.md 担保先).
// Duplicate put of the same key must be rejected, first write wins.
// Conditional-put semantics per docs/planning/c1/r2-put-if-absent-evidence.md.
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv, makeEnvelope } from "./helpers";

describe("CL-01 insert-only (store level)", () => {
  it("rejects a duplicate put of the same event id — first-wins", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const first = makeEnvelope({ data: { marker: "first" } });
    const second = { ...first, data: { marker: "second" } };

    const r1 = await store.putEvent(first);
    expect(r1.status).toBe("inserted");

    const r2 = await store.putEvent(second);
    expect(r2.status).toBe("conflict");

    // stored body is still the FIRST put's body (no overwrite)
    const key = (r1 as { key: string }).key;
    const stored = JSON.parse(bucket.objects.get(key)!.body);
    expect(stored.data.marker).toBe("first");
  });

  it("accepts a different event id (append, not overwrite)", async () => {
    const store = new TruthStore(new FakeR2Bucket());
    const r1 = await store.putEvent(makeEnvelope());
    const r2 = await store.putEvent(makeEnvelope());
    expect(r1.status).toBe("inserted");
    expect(r2.status).toBe("inserted");
  });

  it("derives the key from envelope type/id (ver2 event-store layout adapted)", async () => {
    const store = new TruthStore(new FakeR2Bucket());
    const envlp = makeEnvelope();
    const r = await store.putEvent(envlp);
    expect(r.status).toBe("inserted");
    expect((r as { key: string }).key).toBe(
      `truth/${envlp.type}/${envlp.id}.json`,
    );
  });
});

describe("CL-01 insert-only (HTTP level)", () => {
  it("POST /events → 201 on first insert, 409 on duplicate", async () => {
    const env = makeEnv();
    const envlp = makeEnvelope();
    const init = {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(envlp),
    };

    const res1 = await app.request("/events", init, env);
    expect(res1.status).toBe(201);

    const res2 = await app.request("/events", init, env);
    expect(res2.status).toBe(409);
  });
});
