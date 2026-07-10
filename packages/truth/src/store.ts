import { validateEnvelope } from "./envelope";

export interface R2PutOptions {
  onlyIf?: { etagDoesNotMatch?: string };
}

/** Minimal R2Bucket surface TruthStore needs (typed subset of workers R2Bucket). */
export interface R2BucketLite {
  put(
    key: string,
    value: string,
    options?: R2PutOptions,
  ): Promise<unknown | null>;
}

export type PutEventResult =
  | { status: "inserted"; key: string }
  | { status: "conflict"; key: string }
  | { status: "invalid"; errors: string[] };

// NOTE (CL-12): TruthStore deliberately has NO update/delete methods.
// Their absence is itself the append-only contract (invariant clause 3);
// cl-12-ledger.test.ts asserts it.
export class TruthStore {
  constructor(private readonly bucket: R2BucketLite) {}

  async putEvent(envelope: unknown): Promise<PutEventResult> {
    const v = validateEnvelope(envelope);
    if (!v.valid) return { status: "invalid", errors: v.errors };

    const e = envelope as { type: string; id: string };
    // ver2 event-store key layout truth/<schema_ref>/<event_id>.json
    // (libs/ihl/core/event_store.py) adapted to envelope type/id.
    const key = `truth/${e.type}/${e.id}.json`;

    // put-if-absent at the STORAGE layer — live-verified on real R2:
    // docs/planning/c1/r2-put-if-absent-evidence.md (mode=storage, first-wins).
    // put does NOT throw on conflict; it returns null → map to 409 upstream.
    const res = await this.bucket.put(key, JSON.stringify(envelope), {
      onlyIf: { etagDoesNotMatch: "*" },
    });
    if (res === null) return { status: "conflict", key };
    return { status: "inserted", key };
  }
}
