import { validateEnvelope } from "./envelope";

export interface R2PutOptions {
  onlyIf?: { etagDoesNotMatch?: string };
  httpMetadata?: { contentType?: string };
}

/** Subset of R2ObjectBody TruthStore reads (blob bytes / event JSON). */
export interface R2ObjectLite {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
}

export interface R2ListResult {
  objects: { key: string }[];
}

/** Minimal R2Bucket surface TruthStore needs (typed subset of workers R2Bucket). */
export interface R2BucketLite {
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView,
    options?: R2PutOptions,
  ): Promise<unknown | null>;
  get(key: string): Promise<R2ObjectLite | null>;
  list(options?: { prefix?: string }): Promise<R2ListResult>;
}

export type PutEventResult =
  | { status: "inserted"; key: string }
  | { status: "conflict"; key: string }
  | { status: "invalid"; errors: string[] };

export type PutBlobResult =
  | { status: "inserted"; key: string }
  | { status: "conflict"; key: string };

// NOTE (CL-12): TruthStore deliberately has NO update/delete methods.
// Their absence is itself the append-only contract (invariant clause 3);
// cl-12-ledger.test.ts asserts it.
export class TruthStore {
  constructor(private readonly bucket: R2BucketLite) {}

  // put-if-absent at the STORAGE layer — live-verified on real R2:
  // docs/planning/c1/r2-put-if-absent-evidence.md (mode=storage, first-wins).
  // put does NOT throw on conflict; it returns null → map to 409 upstream.
  private async writeOnce(key: string, envelope: unknown): Promise<PutEventResult> {
    const res = await this.bucket.put(key, JSON.stringify(envelope), {
      onlyIf: { etagDoesNotMatch: "*" },
    });
    if (res === null) return { status: "conflict", key };
    return { status: "inserted", key };
  }

  async putEvent(envelope: unknown): Promise<PutEventResult> {
    const v = validateEnvelope(envelope);
    if (!v.valid) return { status: "invalid", errors: v.errors };

    const e = envelope as { type: string; id: string };
    // ver2 event-store key layout truth/<schema_ref>/<event_id>.json
    // (libs/ihl/core/event_store.py) adapted to envelope type/id.
    return this.writeOnce(`truth/${e.type}/${e.id}.json`, envelope);
  }

  /**
   * Append an event at an EXPLICIT Truth key (not derived from envelope.id).
   * envelope.id stays a valid ULID (CloudEvents id / idempotency), while the
   * storage key carries a domain layout — e.g. photo keyed by
   * truth/ihl.obs.photo.v1/<capture_id>-<photo_ulid>.json (capture-prefix list)
   * or qr keyed by truth/ihl.ind.qr.v1/<token>.json (O(1) resolve). Same
   * validation + put-if-absent semantics as putEvent (design-c2 §3.1).
   */
  async putEventAt(key: string, envelope: unknown): Promise<PutEventResult> {
    const v = validateEnvelope(envelope);
    if (!v.valid) return { status: "invalid", errors: v.errors };
    return this.writeOnce(key, envelope);
  }

  /** Put a binary blob (media/photo/<id>) with the same put-if-absent contract. */
  async putBlob(
    key: string,
    bytes: ArrayBuffer | ArrayBufferView,
    contentType: string,
  ): Promise<PutBlobResult> {
    const res = await this.bucket.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType },
    });
    if (res === null) return { status: "conflict", key };
    return { status: "inserted", key };
  }

  /** Read one event by exact key. null if absent. */
  async readEvent(key: string): Promise<Record<string, unknown> | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return JSON.parse(await obj.text()) as Record<string, unknown>;
  }

  // ponytail: list keys by prefix + one get each = O(n) full scan of a type
  // (or capture-prefix). Fine for MVP volumes; projection index is C3+
  // (design-c2 §3.1 "一覧系投影は R2 prefix scan / 投影 index は C3+").
  async listEvents(prefix: string): Promise<Record<string, unknown>[]> {
    const { objects } = await this.bucket.list({ prefix });
    const out: Record<string, unknown>[] = [];
    for (const o of objects) {
      const e = await this.readEvent(o.key);
      if (e) out.push(e);
    }
    return out;
  }
}
