import { readFileSync } from "node:fs";
import { ulid, type R2BucketLite, type R2PutOptions } from "@ihl/truth";

/**
 * In-memory R2 fake. Conditional-put semantics MIRROR THE LIVE EVIDENCE
 * (docs/planning/c1/r2-put-if-absent-evidence.md): with
 * onlyIf { etagDoesNotMatch: "*" } and an existing key, put returns null —
 * no throw, no overwrite, first body/etag win. Without onlyIf, put overwrites
 * (plain R2 behaviour).
 */
export class FakeR2Bucket implements R2BucketLite {
  objects = new Map<string, { body: string; etag: string }>();
  private seq = 0;

  async put(
    key: string,
    value: string,
    options?: R2PutOptions,
  ): Promise<{ key: string; etag: string } | null> {
    if (options?.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) {
      return null; // write rejected — first-wins (live-verified)
    }
    const rec = { body: String(value), etag: `etag-${++this.seq}` };
    this.objects.set(key, rec);
    return { key, etag: rec.etag };
  }
}

export const DEV_TOKEN = "test-dev-token";
export const SESSION_SECRET = "test-session-secret";

export const AUTH_HEADERS = {
  Authorization: `Bearer ${DEV_TOKEN}`,
  "content-type": "application/json",
};

export function makeEnv(bucket: FakeR2Bucket = new FakeR2Bucket()) {
  return { DEV_TOKEN, SESSION_SECRET, TRUTH: bucket };
}

/** Minimal valid event envelope per schemas/events/envelope.schema.json. */
export function makeEnvelope(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: "ihl.test.sample.v1",
    time: "2026-07-10T12:00:00Z",
    provenance: { generator_kind: "agent", agent_name: "claude-code" },
    data: {},
    ...overrides,
  };
}

export function loadFixture<T = Record<string, unknown>>(name: string): T {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}
