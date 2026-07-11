// FND-15 lineage metadata: deterministic, IO-free provenance scaffold.
// content/lineage hashes reuse sha256Hex + canonicalJson (contracts.ts) — no
// new hash algorithm. This is the reusable helper; retrofitting every existing
// FeatureNode with lineage meta is deferred (design-k7 §5 ceiling).
import { canonicalJson, sha256Hex } from "./contracts";
import { GENESIS_HASH } from "./hash-chain";
import { ulid } from "./ulid";

/** Shape mirrors schemas/common/lineage-meta.schema.json (the SSOT). */
export interface LineageMeta {
  uuid: string;
  lineage_hash: string;
  content_hash: string;
  generation: number;
  parent_uuid?: string;
  ancestor_chain?: string[];
  semantic_hash?: string;
}

/**
 * Derive a LineageMeta for `content`, optionally chained to `parent`.
 * content_hash = SHA-256(canonicalJson(content)).
 * lineage_hash = SHA-256((parent.lineage_hash ?? GENESIS_HASH) + content_hash).
 * Hashes are fully deterministic; only uuid (ulid) is fresh per call.
 * Value-absent fields (parent_uuid/ancestor_chain at root) are omitted, per the
 * schema's AI-first rule (no null/empty).
 */
export async function computeLineageMeta(
  content: unknown,
  parent?: LineageMeta,
): Promise<LineageMeta> {
  const content_hash = await sha256Hex(canonicalJson(content));
  const lineage_hash = await sha256Hex(
    (parent?.lineage_hash ?? GENESIS_HASH) + content_hash,
  );
  const meta: LineageMeta = {
    uuid: ulid(),
    lineage_hash,
    content_hash,
    generation: parent ? parent.generation + 1 : 0,
  };
  if (parent) {
    meta.parent_uuid = parent.uuid;
    meta.ancestor_chain = [...(parent.ancestor_chain ?? []), parent.uuid];
  }
  return meta;
}
