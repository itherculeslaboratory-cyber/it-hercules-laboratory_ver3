import { validateEnvelope } from "./envelope";
import { buildIndexEntry, indexKeyFor } from "./index-entry";

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

// V3-SEC-48 段階1(bridgeplan J3-B・案A)。渡されなければ現状と完全に同一挙動。
// 違反時は既存の "invalid" ステータスへ乗せる(新ステータスを追加すると既存呼び出し元
// 全体(数十箇所)が黙って成功扱いする=セキュリティ退行になるため・R0731-7b0c89の危険判断を継承)。
// 段階2(key-bundle-routes.ts 1ファイルへの適用)・段階3(全呼び出し元への展開)は別ラウンド。
export type PolicyHook = (envelope: unknown, key: string) => string | null;

export type PutBlobResult =
  | { status: "inserted"; key: string }
  | { status: "conflict"; key: string };

// NOTE (CL-12): TruthStore deliberately has NO update/delete methods.
// Their absence is itself the append-only contract (invariant clause 3);
// cl-12-ledger.test.ts asserts it.
export class TruthStore {
  constructor(
    private readonly bucket: R2BucketLite,
    private readonly policy?: PolicyHook,
  ) {}

  // put-if-absent at the STORAGE layer — live-verified on real R2:
  // docs/planning/c1/r2-put-if-absent-evidence.md (mode=storage, first-wins).
  // put does NOT throw on conflict; it returns null → map to 409 upstream.
  private async writeOnce(key: string, envelope: unknown): Promise<PutEventResult> {
    if (this.policy) {
      const violation = this.policy(envelope, key);
      if (violation) return { status: "invalid", errors: [`FORBIDDEN: ${violation}`] };
    }
    const res = await this.bucket.put(key, JSON.stringify(envelope), {
      onlyIf: { etagDoesNotMatch: "*" },
    });
    if (res === null) return { status: "conflict", key };
    return { status: "inserted", key };
  }

  async putEvent(envelope: unknown): Promise<PutEventResult> {
    const stamped = { ...(envelope as Record<string, unknown>), received_at: new Date().toISOString() };
    const v = validateEnvelope(stamped);
    if (!v.valid) return { status: "invalid", errors: v.errors };

    const e = stamped as { type: string; id: string };
    // ver2 event-store key layout truth/<schema_ref>/<event_id>.json
    // (libs/ihl/core/event_store.py) adapted to envelope type/id.
    const key = `truth/${e.type}/${e.id}.json`;
    const result = await this.writeOnce(key, stamped);
    if (result.status !== "invalid") await this.writeIndexEntry(result, stamped, key);
    return result;
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
    const stamped = { ...(envelope as Record<string, unknown>), received_at: new Date().toISOString() };
    const v = validateEnvelope(stamped);
    if (!v.valid) return { status: "invalid", errors: v.errors };
    const result = await this.writeOnce(key, stamped);
    if (result.status !== "invalid") await this.writeIndexEntry(result, stamped, key);
    return result;
  }

  /**
   * S2(design R0801-f383db §6 論点3): payload put-if-absent の後に索引を put-if-absent。
   * payload が conflict(既存)でも索引書き込みへ進む(再送で索引だけ埋まる冪等経路)。
   * conflict時は索引キーを再送時刻ではなく「既に保存されている envelope の received_at」から
   * 作る — でないと再送のたびに index キーが変わり冪等にならない(同じイベントの索引が
   * 複数できてしまう)。索引の put 自体が例外を投げた場合はここで飲み込まず、そのまま
   * 呼び出し元(Hono の app.onError → 500)へ伝播させる = 「索引書き込み失敗を成功と
   * 言わない」の実装(index.ts 等の呼び出し元route群には一切手を入れない)。
   */
  private async writeIndexEntry(
    result: PutEventResult,
    stamped: Record<string, unknown>,
    payloadKey: string,
  ): Promise<void> {
    let source = stamped;
    let payloadBytes = new TextEncoder().encode(JSON.stringify(stamped)).length;
    if (result.status === "conflict") {
      const obj = await this.bucket.get(payloadKey);
      if (obj) {
        const text = await obj.text();
        payloadBytes = new TextEncoder().encode(text).length;
        source = JSON.parse(text) as Record<string, unknown>;
      }
    }
    const entry = await buildIndexEntry(source, payloadKey, payloadBytes);
    const indexKey = indexKeyFor(source as { id: string; received_at: string });
    await this.bucket.put(indexKey, JSON.stringify(entry), {
      onlyIf: { etagDoesNotMatch: "*" },
    });
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
