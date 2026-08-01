// g81-f2wiring T4(R0801-73be3e §7-1が並走衝突回避で次波送りにした本命): 検索条件JSON
// (query-generator.ts の ResearchQueryJson)を ihl.research.query.v1 として既存
// POST /events 経路でTruthへ保存する。condition-share.ts のクライアント側ダウンロード/
// URL共有とは併存(置き換えではない — 両方が使える)。
import type { ResearchQueryJson } from "./query-generator";

// ULID: packages/truth/src/ulid.ts と同じアルゴリズム(48bit msタイムスタンプ + 80bit
// 乱数, Crockford Base32・envelope.schema.json の id パターンに一致)。apps/web は
// @ihl/truth(ajv 依存のサーバ専用パッケージ)をブラウザバンドルへ引き込みたくないため、
// この最小関数だけをここへ複製する(新規npm依存の追加はしない)。
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(now: number = Date.now()): string {
  let t = now;
  let ts = "";
  for (let i = 0; i < 10; i++) {
    ts = ULID_ALPHABET[t % 32] + ts;
    t = Math.floor(t / 32);
  }
  let rnd = "";
  // 256 % 32 === 0 なので (byte & 31) はアルファベット上で一様。
  for (const b of crypto.getRandomValues(new Uint8Array(16))) {
    rnd += ULID_ALPHABET[b & 31];
  }
  return ts + rnd;
}

export interface SaveResearchQueryToTruthResult {
  key: string;
}

/** schemas/events/research-query.schema.json の data 部を組み立てる。 */
export function buildResearchQueryEventData(
  query: ResearchQueryJson,
  manifestGeneration: number,
  actorId: string,
  createdAt: string,
): Record<string, unknown> {
  return {
    query_id: ulid(),
    actor_id: actorId,
    manifest_generation: manifestGeneration,
    query,
    created_at: createdAt,
  };
}

/**
 * POST /events(T-71自己サービス allowlist に登録済みの ihl.research.query.v1・
 * apps/api/src/index.ts SELF_SERVICE_EVENT_TYPES)でTruthへ1件appendする。
 */
export async function saveResearchQueryToTruth(
  query: ResearchQueryJson,
  manifestGeneration: number,
  actorId: string,
  now: () => Date = () => new Date(),
): Promise<SaveResearchQueryToTruthResult> {
  const createdAt = now().toISOString();
  const data = buildResearchQueryEventData(query, manifestGeneration, actorId, createdAt);
  const envelope = {
    specversion: "1.0",
    id: ulid(),
    source: "apps/web",
    type: "ihl.research.query.v1",
    time: createdAt,
    dataschema: "schemas/events/research-query.schema.json",
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
  const res = await fetch("/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`research-query save failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return (await res.json()) as SaveResearchQueryToTruthResult;
}
