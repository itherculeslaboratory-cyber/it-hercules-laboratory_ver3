// V3-SEC-57 zero-knowledge 鍵バンドル保管+オフラインリカバリコード。BYOK鍵5本+振込口座
// パスフレーズの暗号バンドルを、IHLが復号不能な ciphertext(opaque blob)としてサーバ保管
// する(V3-SEC-06「保持しない」=平文のみと解釈)。本ファイルのコードは ciphertext の中身を
// 一切パース・復号しない — それが「zero-knowledge」の実体(device-routes.ts の
// AES 暗号化 api_key とは異なり、本ファイルはサーバ側で復号可能な鍵を一切持たない)。
// リカバリコードはサーバが1回だけ発行し平文はレスポンスにのみ載せる(永続化しない)。
// 以後は SHA-256 ハッシュのみ保管し、verify はハッシュ一致 + 未消費のみ許可(1回限り)。
// 全 route PROTECTED(index.ts の auth middleware が gate・actorId を set)。
import { Hono } from "hono";
import { TruthStore, ulid, sha256Hex } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

const BUNDLE_TYPE = "ihl.sec.key_bundle.v1";
const BUNDLE_SCHEMA = "schemas/events/sec-key-bundle.schema.json";
const RECOVERY_TYPE = "ihl.sec.key_bundle_recovery.v1";
const RECOVERY_SCHEMA = "schemas/events/sec-key-bundle-recovery.schema.json";
const SCHEMA_VERSION = "1";

export const keyBundleRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function envelope(type: string, schema: string, id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema: schema,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

/** 20byte(160bit)の一回限りリカバリコード。1Password Secret Key / Bitwarden Emergency
 * Kit と同型の「オフラインで書き留める前提の高エントロピー文字列」。Crockford風に
 * 4文字ずつハイフン区切り(視写ミスを減らす・視認性)。平文はここでしか作られず、
 * サーバはこの後 SHA-256 しか保持しない。 */
function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.match(/.{1,4}/g)!.join("-").toUpperCase();
}

// POST /me/key-bundle — 暗号バンドル(ciphertext・クライアント側で既に暗号化済みの
// opaque文字列)を append。新規バンドルは新レコード(append-only・最新が投影上の現行)。
keyBundleRoutes.post("/me/key-bundle", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { ciphertext?: unknown; kdf_params?: unknown }
    | null;
  if (!body || typeof body.ciphertext !== "string" || !body.ciphertext) {
    return c.json({ error: "INVALID_KEY_BUNDLE", details: ["ciphertext (string) required"] }, 400);
  }
  const actorId = c.get("actorId");
  const bundleId = ulid();
  const data: Record<string, unknown> = {
    bundle_id: bundleId,
    actor_id: actorId,
    ciphertext: body.ciphertext,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (body.kdf_params !== undefined && typeof body.kdf_params === "object" && body.kdf_params !== null) {
    data.kdf_params = body.kdf_params;
  }
  const key = `truth/${BUNDLE_TYPE}/${actorId}/${bundleId}.json`;
  const res = await store(c).putEventAt(key, envelope(BUNDLE_TYPE, BUNDLE_SCHEMA, bundleId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_KEY_BUNDLE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_KEY_BUNDLE", key: res.key }, 409);
  return c.json({ bundle_id: bundleId, created_at: data.created_at }, 201);
});

// GET /me/key-bundle — 最新の暗号バンドルを返す(本人スコープ)。サーバは ciphertext の
// 中身を一切解釈しない=そのまま返すだけ(復号はクライアント側の責務)。
keyBundleRoutes.get("/me/key-bundle", async (c) => {
  const actorId = c.get("actorId");
  const rows = (await store(c).listEvents(`truth/${BUNDLE_TYPE}/${actorId}/`))
    .map(dataOf)
    .sort((a, b) => (String(a.created_at) < String(b.created_at) ? -1 : 1));
  const latest = rows[rows.length - 1];
  if (!latest) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({
    bundle_id: latest.bundle_id,
    ciphertext: latest.ciphertext,
    kdf_params: latest.kdf_params ?? null,
    created_at: latest.created_at,
  });
});

// POST /me/key-bundle/recovery-code — オフライン1回限りリカバリコードを新規発行。平文は
// このレスポンスにのみ載る(以後サーバはSHA-256ハッシュしか持たない=紛失時サーバに
// 問い合わせても再表示できない・1Password/Bitwarden型の運用契約どおり)。
keyBundleRoutes.post("/me/key-bundle/recovery-code", async (c) => {
  const actorId = c.get("actorId");
  const s = store(c);
  const code = generateRecoveryCode();
  const codeHash = await sha256Hex(code);
  const recoveryId = ulid();
  const data: Record<string, unknown> = {
    recovery_id: recoveryId,
    actor_id: actorId,
    code_hash: codeHash,
    action: "issue",
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const key = `truth/${RECOVERY_TYPE}/${actorId}/${recoveryId}-issue.json`;
  const res = await s.putEventAt(key, envelope(RECOVERY_TYPE, RECOVERY_SCHEMA, recoveryId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_RECOVERY", details: res.errors }, 500);
  return c.json({ recovery_id: recoveryId, recovery_code: code }, 201);
});

// POST /me/key-bundle/recovery-code/verify — body.code のハッシュが本人の未消費 issue
// レコードと一致すれば 1 回限り消費(action=consume を deterministic key で append・
// 二回目の消費は conflict=409=再消費不可)。一致しなければ 401。
keyBundleRoutes.post("/me/key-bundle/recovery-code/verify", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null;
  if (!body || typeof body.code !== "string" || !body.code) {
    return c.json({ error: "INVALID_CODE" }, 400);
  }
  const actorId = c.get("actorId");
  const s = store(c);
  const codeHash = await sha256Hex(body.code);
  const rows = (await s.listEvents(`truth/${RECOVERY_TYPE}/${actorId}/`)).map(dataOf);
  const issued = rows.find((d) => d.action === "issue" && d.code_hash === codeHash);
  if (!issued) return c.json({ error: "INVALID_RECOVERY_CODE" }, 401);
  const recoveryId = String(issued.recovery_id);
  const alreadyConsumed = rows.some((d) => d.action === "consume" && d.recovery_id === recoveryId);
  if (alreadyConsumed) return c.json({ error: "RECOVERY_CODE_ALREADY_USED" }, 409);

  const consumeId = ulid();
  const consumeData: Record<string, unknown> = {
    recovery_id: recoveryId,
    actor_id: actorId,
    code_hash: codeHash,
    action: "consume",
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const key = `truth/${RECOVERY_TYPE}/${actorId}/${recoveryId}-consume.json`;
  const res = await s.putEventAt(key, envelope(RECOVERY_TYPE, RECOVERY_SCHEMA, consumeId, actorId, consumeData));
  if (res.status === "conflict") return c.json({ error: "RECOVERY_CODE_ALREADY_USED" }, 409);
  return c.json({ verified: true, recovery_id: recoveryId }, 200);
});
