// C5 K1 C-USB(統合入力バス)取り込み API (design-k1 §1.1/§1.2 / V3-OBS-44).
// PROTECTED (index.ts §1.5 gate) — collector と違い署名公開ではなくセッション保護
// (PUBLIC_ROUTES に足さない)。フロー: validate(input_kind) → payload_hash 算出/改ざん
// 検知 → lineage/semantic 付与 → put-if-absent 保存(同 payload = 同 hash = 409)。
// actor_id は常にセッション principal(V3-AUT-17)。envelope/store はインライン。
//
// V3-OBS-70 段階1(design R0731-060798 §5案B): Docker中間層(無人プロセス)からの push
// にも対応する第2経路を追加。**署名があれば署名で認証、無ければ従来どおりセッション**
// (後方互換・既存ブラウザ呼び出し元は無改変)。秘密鍵はユーザーPC上のコンテナにのみ存在し、
// サーバは公開鍵(CUSB_DEVICE_KEYS env)だけを持つ。collector-routes.ts の
// 「署名 IS the credential」プロトコルをそのまま移植(b64ToBytes/importPublicKey を再利用・
// 新規発明しない)。
// ★段階2(公開鍵登録のセルフサービス化・keyBundleOwnerPolicy転用)は実装しない
// (R65-4で温存と裁定済み。発火条件=2人目の拡張作者 or V3-SEC-58着手時)。
// ★★このrouteはまだ index.ts の PUBLIC_ROUTES に無い(艦は index.ts を書かない — 不可侵)。
// よって現時点では署名経路もセッション経由でしか到達できない(mount待ち = HQ適用待ち)。
// ★PII(§4-3): input_kind:"screen" の可視性は本書では変えない — C-USB は元々 payload を
// 解釈しない設計であり、visibility 概念の欠如は既存(OBS-44)からの状態。署名経路の追加は
// 「誰が書けるか」の認証方式を増やすだけで、「何が書けるか」「誰が読めるか」には触れない
// (design §4-3/§7-2で明示的に未決のまま — ここで独自のvisibility制限を発明しない)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { b64ToBytes, importPublicKey } from "./collector-routes";

export const cusbRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const CUSB_TYPE = "ihl.cusb.ingest.v1";
const CUSB_SCHEMA = "schemas/events/cusb-ingest.schema.json";
const INPUT_KINDS = new Set(["screen", "api", "sensor", "file", "human", "network"]);

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function envelope(actorId: string, data: Record<string, unknown>, provenance?: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: CUSB_TYPE,
    time: new Date().toISOString(),
    dataschema: CUSB_SCHEMA,
    provenance: provenance ?? { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// Registered device credential for an extension_id: public key + the human
// actor_id who registered it (C-USB attributes device writes to a human owner,
// unlike collector which attributes to the device itself — design §4-2).
// null if the extension_id is not registered.
function deviceKeyFor(env: Bindings, extensionId: string): { pem: string; actorId: string } | null {
  if (!env.CUSB_DEVICE_KEYS) return null;
  let map: Record<string, { public_key_pem?: unknown; actor_id?: unknown }>;
  try {
    map = JSON.parse(env.CUSB_DEVICE_KEYS);
  } catch {
    return null;
  }
  const entry = map[extensionId];
  if (!entry || typeof entry.public_key_pem !== "string" || typeof entry.actor_id !== "string") return null;
  return { pem: entry.public_key_pem, actorId: entry.actor_id };
}

// Canonical JSON: recursively sort object keys so the payload hash is independent
// of key order. Arrays keep order (order is semantic). ~10 lines vs a dep.
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonical((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

// POST /cusb — ingest one payload into the unified input bus (OBS-44).
// 400 on: bad body / unknown input_kind / a client-supplied payload_hash that does
// not match the recomputed hash of `payload` (tamper detection). 409 on replay of
// the same payload (put-if-absent, INSERT ONLY). lineage/semantic are stamped here.
// ★timestamp は署名対象(下記 message)だが鮮度検証はしていない(再送は内容アドレスキーの
// put-if-absent 409 で止まるため = 現行防御はキー方式に依存。キー方式を変える/削除経路を
// 足す時はこの前提が崩れる — 批評ゲート R0801-c16d84 軽微2)。
cusbRoutes.post("/cusb", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);

  // R66-9: 署名3点(device_id/timestamp/signature_base64)が1つも無く、かつ
  // セッション principal(actorId)も無い場合は認証不備。schema検証(400)まで
  // 進めず、route冒頭(署名分岐の判定より前)で 401 AUTH_REQUIRED を返す
  // (何も保存しない)。部分提示(1〜2個)はこのガードを通過するが、署名分岐は
  // 3点すべて提示時のみ真のため従来のセッション経路へ落ちる: セッションがあれば
  // 従来どおり、無ければ schema検証の 400 INVALID_CUSB(2巡目ゲートR0801-c13b4c参考1)。
  const hasAnySignatureField =
    typeof body.device_id === "string" ||
    typeof body.timestamp === "string" ||
    typeof body.signature_base64 === "string";
  if (!hasAnySignatureField && !c.get("actorId")) {
    return c.json({ error: "AUTH_REQUIRED" }, 401);
  }

  const inputKind = body.input_kind;
  if (typeof inputKind !== "string" || !INPUT_KINDS.has(inputKind)) {
    return c.json({ error: "INVALID_INPUT_KIND" }, 400);
  }
  if (body.payload === undefined) return c.json({ error: "MISSING_PAYLOAD" }, 400);

  // payload_hash は payload から一意に再計算する(冪等キー)。クライアントが
  // payload_hash を主張してきた場合は再計算値と照合し、不一致 = 改ざんで 400。
  const payloadHash = await sha256Hex(
    new TextEncoder().encode(JSON.stringify(canonical(body.payload))),
  );
  if (typeof body.payload_hash === "string" && body.payload_hash !== payloadHash) {
    return c.json({ error: "PAYLOAD_HASH_MISMATCH", expected: payloadHash }, 400);
  }

  // lineage/semantic 付与: 取り込み側が入力元メタを刻む。クライアント提供分(object の
  // 場合のみ)を土台にサーバ由来フィールドで上書きし、常に object を保証。
  // ★署名対象に含めるため(下記)、この正規化はセッション/署名どちらの経路でも
  // 認証チェックより前に行う(クライアントが実際に送った生の lineage/semantic を signed
  // message に使う。ingested_by/ingested_at 等サーバ側スタンプ後の値ではない)。
  const clientLineage =
    body.lineage && typeof body.lineage === "object" && !Array.isArray(body.lineage)
      ? (body.lineage as Record<string, unknown>)
      : {};
  const semantic =
    body.semantic && typeof body.semantic === "object" && !Array.isArray(body.semantic)
      ? (body.semantic as Record<string, unknown>)
      : {};

  // 署名経路(V3-OBS-70 段階1): device_id/timestamp/signature_base64 の3点が揃っていれば
  // Ed25519 署名で認証する(collector-routes.ts と同じ「署名 IS the credential」)。
  // 揃っていなければ従来どおりセッション principal を使う(後方互換)。
  // signed message は `${timestamp}.${canonical({input_kind, payload, lineage, semantic})}` —
  // input_kind を含めることで、捕捉された署名済みメッセージを別の input_kind(例: screen)に
  // 付け替えて先着 write を奪う再送を防ぐ。lineage/semantic も含めるのは、この2つが
  // additionalProperties:true でサーバ側の上書きを受けず(ingested_by/ingested_at 以外は
  // クライアントの値がそのまま保存される)ため、含めないと署名を壊さず semantic だけを
  // 差し替えて先に投げ込める攻撃が成立するため(批評ゲート R0801-c16d84 中4)。
  let actorId: string;
  let provenance: Record<string, unknown> | undefined;
  if (
    typeof body.device_id === "string" &&
    typeof body.timestamp === "string" &&
    typeof body.signature_base64 === "string"
  ) {
    const extensionId = body.device_id;
    const cred = deviceKeyFor(c.env, extensionId);
    if (!cred) return c.json({ error: "CUSB_DEVICE_UNKNOWN" }, 401);
    const message = `${body.timestamp}.${JSON.stringify(canonical({ input_kind: inputKind, payload: body.payload, lineage: clientLineage, semantic }))}`;
    let ok = false;
    try {
      const key = await importPublicKey(cred.pem);
      ok = await crypto.subtle.verify(
        "Ed25519",
        key,
        b64ToBytes(body.signature_base64),
        new TextEncoder().encode(message),
      );
    } catch {
      ok = false; // malformed key/signature bytes = not verified
    }
    if (!ok) return c.json({ error: "CUSB_SIGNATURE_INVALID" }, 401);
    actorId = cred.actorId;
    // 機械投入が人間投入に化けない(design §4-2): generator_kind="device" を明示し、
    // device_id で拡張を識別する(human 用の provenance.actor_id は立てない)。
    // 帰属(誰の書き込みか)は data.actor_id(= 鍵の登録者)に残す。
    provenance = { generator_kind: "device", device_id: extensionId };
  } else {
    actorId = c.get("actorId");
  }
  const lineage: Record<string, unknown> = {
    ...clientLineage,
    input_kind: inputKind,
    ingested_by: actorId,
    ingested_at: new Date().toISOString(),
  };

  const data: Record<string, unknown> = {
    input_kind: inputKind,
    payload_hash: payloadHash,
    lineage,
    semantic,
    actor_id: actorId,
    created_at: new Date().toISOString(),
  };

  const key = `truth/${CUSB_TYPE}/${payloadHash}.json`;
  const res = await store(c).putEventAt(key, envelope(actorId, data, provenance));
  if (res.status === "invalid") return c.json({ error: "INVALID_CUSB", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_CUSB", key: res.key }, 409);
  return c.json({ payload_hash: payloadHash, input_kind: inputKind }, 201);
});
