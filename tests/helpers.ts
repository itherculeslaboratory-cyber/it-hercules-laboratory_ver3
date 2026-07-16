import { readFileSync } from "node:fs";
import {
  ulid,
  type R2BucketLite,
  type R2ObjectLite,
  type R2ListResult,
  type R2PutOptions,
} from "@ihl/truth";
import { memoryKV } from "../apps/api/src/kv";

/**
 * In-memory R2 fake. Conditional-put semantics MIRROR THE LIVE EVIDENCE
 * (docs/planning/c1/r2-put-if-absent-evidence.md): with
 * onlyIf { etagDoesNotMatch: "*" } and an existing key, put returns null —
 * no throw, no overwrite, first body/etag win. Without onlyIf, put overwrites
 * (plain R2 behaviour). get/list mirror the workers R2Bucket subset the
 * observation-core projections read (design-c2 §3.1).
 */
export class FakeR2Bucket implements R2BucketLite {
  objects = new Map<
    string,
    { body: string | Uint8Array; etag: string; contentType?: string }
  >();
  private seq = 0;

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView,
    options?: R2PutOptions,
  ): Promise<{ key: string; etag: string } | null> {
    if (options?.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) {
      return null; // write rejected — first-wins (live-verified)
    }
    const body = typeof value === "string" ? value : toU8(value);
    const rec = { body, etag: `etag-${++this.seq}`, contentType: options?.httpMetadata?.contentType };
    this.objects.set(key, rec);
    return { key, etag: rec.etag };
  }

  async get(key: string): Promise<R2ObjectLite | null> {
    const rec = this.objects.get(key);
    if (!rec) return null;
    const bytes = typeof rec.body === "string" ? new TextEncoder().encode(rec.body) : rec.body;
    return {
      text: async () =>
        typeof rec.body === "string" ? rec.body : new TextDecoder().decode(rec.body),
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      httpMetadata: rec.contentType ? { contentType: rec.contentType } : undefined,
    };
  }

  async list(options?: { prefix?: string }): Promise<R2ListResult> {
    const prefix = options?.prefix ?? "";
    return {
      objects: [...this.objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ key: k })),
    };
  }
}

function toU8(v: ArrayBuffer | ArrayBufferView): Uint8Array {
  return v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

export const DEV_TOKEN = "test-dev-token";
export const SESSION_SECRET = "test-session-secret";

export const AUTH_HEADERS = {
  Authorization: `Bearer ${DEV_TOKEN}`,
  "content-type": "application/json",
};

// AUTH_DENYLIST/AUTH_CODE_STATE: 「ローカルはメモリ実装」(round-16 Q-REQ-03)を
// テストでも実際に踏む — 未バインド(undefined)だと denylist/verify-code のワンタイム性
// 判定コードパスが素通りしてしまい、TC が本番挙動を検証できなくなるため既定で渡す。
// makeEnv() を呼ぶたびに新しい memoryKV() インスタンス(=FakeR2Bucket と同じくテスト間で
// 独立)なのでテスト間リークはない。
export function makeEnv(bucket: FakeR2Bucket = new FakeR2Bucket()) {
  return {
    DEV_TOKEN,
    SESSION_SECRET,
    TRUTH: bucket,
    AUTH_DENYLIST: memoryKV(),
    AUTH_CODE_STATE: memoryKV(),
  };
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
