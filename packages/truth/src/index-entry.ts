// S2(design R0801-f383db §6 論点2/3): 受領索引エントリの生成。
// キー = index/receipt/<YYYY-MM-DD>/<received_at_ms>-<event_id>.json (put-if-absent, store.ts が書く)。
//
// 不変部(ルート計算対象)と可変部(text_repr/text_repr_v)を型レベルで同一オブジェクトの
// フィールドとして持つが、event_hash は canonicalJson(envelope) のみのハッシュであり
// text_repr を絶対に混入させない(§6 論点2の地雷)。event_hash は S3 が使う worldHash 用の
// prev_hash 連鎖ハッシュ(hash-chain.ts の eventHash)とは別物 — こちらは連鎖を持たない
// 単一イベントの内容ハッシュなので eventHash() は再利用しない(意図的な非再利用)。
import { canonicalJson, sha256Hex } from "./contracts";
import { frozenSchemaFor, eventSchemaFor } from "./envelope";

export const TEXT_REPR_VERSION = 1;

export interface IndexEntry {
  event_id: string;
  type: string;
  subject: string | null;
  actor_id: string | null;
  payload_key: string;
  payload_bytes: number;
  event_hash: string;
  received_at: string;
  claimed_at: string | null;
  sig_alg: string | null;
  key_id: string | null;
  sig: string | null;
  signed_bytes_sha256: string | null;
  sig_verified: boolean | null;
  text_repr: string | null;
  text_repr_v: number;
  // g80-vis1(design R0801-7b17da §2-3 案C'補強1): 可視性の判定に要る2列。
  // envelope.data から拾うだけ(capture以外の型はどちらも undefined→null)。
  // chain-routes.ts immutablePartOf の除外リストに同じく追加済み(可変部・
  // 日次ルート計算対象外 — text_repr と同じ扱い)。
  visibility: string | null;
  consent_l3: boolean | null;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "object") return canonicalJson(v);
  return String(v);
}

/**
 * text_repr = 決定論的テンプレート(§6 論点2「入力へ戻れる表現」)。
 * dataschema が既知の schema(frozen または events)を指す場合のみ生成し、
 * 未知の型は null(推定しない)。既知型の一覧は contracts.ts の
 * frozenSchemaFor/eventSchemaFor をそのまま再利用する(reuse-first — 100件超の
 * 型を手書きテンプレ表として複製しない。テンプレ自体は全既知型で共通の
 * 「フィールド名=値」列挙という単一の機械的規則)。
 */
export function buildTextRepr(envelope: Record<string, unknown>): string | null {
  const dataschema = envelope.dataschema;
  if (typeof dataschema !== "string") return null;
  const name = frozenSchemaFor(dataschema) ?? eventSchemaFor(dataschema);
  if (!name) return null;
  const data = (envelope.data ?? {}) as Record<string, unknown>;
  const fields = Object.keys(data)
    .sort()
    .map((k) => `${k}=${formatValue(data[k])}`)
    .join(" ");
  const subject = typeof envelope.subject === "string" ? envelope.subject : "";
  const type = typeof envelope.type === "string" ? envelope.type : "";
  return `[${name}] type=${type} subject=${subject} ${fields}`.trim();
}

/** index/receipt/<date>/<received_at_ms>-<event_id>.json。envelope は received_at 刻印済み前提。 */
export function indexKeyFor(envelope: { id: string; received_at: string }): string {
  const receivedAtMs = new Date(envelope.received_at).getTime();
  const date = envelope.received_at.slice(0, 10);
  return `index/receipt/${date}/${receivedAtMs}-${envelope.id}.json`;
}

/**
 * envelope は「実際に保存されている(またはこれから保存される)」ペイロードそのもの
 * を渡すこと — conflict 再送時は呼び出し側が既存ストア済みの envelope を渡し、
 * received_at を最初の受領時刻のまま保つ(でないと index キーが再送のたびに変わり
 * 冪等にならない。§6 論点3)。
 */
export async function buildIndexEntry(
  envelope: Record<string, unknown>,
  payloadKey: string,
  payloadBytes: number,
): Promise<IndexEntry> {
  const provenance = (envelope.provenance ?? {}) as Record<string, unknown>;
  const data = (envelope.data ?? {}) as Record<string, unknown>;
  return {
    event_id: envelope.id as string,
    type: envelope.type as string,
    subject: typeof envelope.subject === "string" ? envelope.subject : null,
    actor_id: typeof provenance.actor_id === "string" ? provenance.actor_id : null,
    payload_key: payloadKey,
    payload_bytes: payloadBytes,
    // §6 論点2: event_hash は canonicalJson(envelope) のみ。text_repr は絶対に含めない。
    event_hash: await sha256Hex(canonicalJson(envelope)),
    received_at: envelope.received_at as string,
    // claimed_at・署名一式は現行 envelope スキーマに対応フィールドが無い(2026-08-01時点で
    // 署名機構が未実装)。無ければ null(推定しない)。将来 envelope にフィールドが増えたら
    // ここで拾う配線を足すだけでよい形にしてある。
    claimed_at: typeof envelope.claimed_at === "string" ? envelope.claimed_at : null,
    sig_alg: null,
    key_id: null,
    sig: null,
    signed_bytes_sha256: null,
    sig_verified: null,
    text_repr: buildTextRepr(envelope),
    text_repr_v: TEXT_REPR_VERSION,
    visibility: typeof data.visibility === "string" ? data.visibility : null,
    consent_l3: typeof data.consent_l3 === "boolean" ? data.consent_l3 : null,
  };
}
