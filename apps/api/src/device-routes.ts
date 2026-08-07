// C5 K1 観測機器 API (design-k1 §1.1 / V3-OBS-31 / V3-SEC-03). PROTECTED. A device
// binds to a placement, NOT an individual — an individual-binding request is 400
// (the obs-device schema carries no individual ref; the route rejects it
// explicitly before Truth). The provider API key is a HARD server-side secrecy
// boundary (V3-SEC-03: サーバー側に一切保持・使用せず) — the server never stores
// it, encrypted or otherwise, and never derives a key from an env secret to do so
// (第20回裁定DK-1: サーバー側AES-GCM保管を廃止). The client holds the plaintext
// key and supplies it per-request only when it wants to exercise the provider
// connection (POST /devices/:id/test) — either via the `x-device-api-key`
// header or a JSON body `api_key` field (the ScreenDef renderer has no header
// vocabulary, so the device screen's test form uses the body field; both are
// read transiently for that single request and never persisted). Real
// providers are a human gate — only a dummy provider's
// testConnection ships. envelope()/store()/dataOf() inlined per the
// projectLedger precedent (批評家#3).
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { CLOUD_POLL_PROVIDERS, DEFAULT_POLL_INTERVAL_SEC, CUSTOM_MIN_POLL_INTERVAL_SEC } from "./observation-constants";

export const deviceRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export const DEVICE_TYPE = "ihl.obs.device.v1";
const DEVICE_SCHEMA = "schemas/events/obs-device.schema.json";

// R0807-eb6d90 w1-uifix T1(カードR0802-4bf402-g91w2device・ユーザー裁定「けせよ。それ
// は。」): 2026-08-01の動作確認時、PowerShellのエンコーディング事故で display_name が
// 文字化けした2件が append-only ストア(TruthStoreにdeleteEvent無し・不変条項①)へ
// 誤って永続化された。削除APIが存在しないため、既知の2件をIDで一覧から除外する
// (新しい汎用の文字化け検出は作らない — この2件限定の是正)。
const CORRUPTED_DEVICE_IDS = new Set(["01KYZQXRXN4TZB2BMVXX908RZ2", "01KYZQXRXYBV7SEMZMFY7J7RAF"]);

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function envelope(actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: DEVICE_TYPE,
    time: new Date().toISOString(),
    dataschema: DEVICE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// Reject any attempt to bind a device to an individual (OBS-31: placement only).
function bindsIndividual(body: Record<string, unknown>): boolean {
  const sref = body.subject_ref;
  if (typeof sref === "string" && sref.startsWith("individual/")) return true;
  if (body.subject_type === "individual") return true;
  return body.individual_id !== undefined || body.individual_ref !== undefined;
}

// ── dummy provider (real providers = human gate) ────────────────────────────────
// Deterministic auto-discovery derived from the device id — proves the
// per-request client-supplied key is usable without any real provider network
// call. No server-side storage or decryption is involved (V3-SEC-03).
function dummyTestConnection(deviceId: string, apiKey: string | null): { ok: boolean; discovered: string[] } {
  return {
    ok: apiKey !== null, // a key was supplied on this request = connectable
    discovered: apiKey ? [`sensor-${deviceId.slice(0, 6)}-a`, `sensor-${deviceId.slice(0, 6)}-b`] : [],
  };
}

// ── routes ─────────────────────────────────────────────────────────────────────

// POST /devices — register a device (OBS-31). placement binding OK; individual
// binding → 400. No api_key field is accepted here at all (V3-SEC-03/DK-1): the
// server never stores a provider key, so registration carries no key material.
// The client supplies the key later, per-call, only when it wants to exercise
// POST /devices/:id/test.
deviceRoutes.post("/devices", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  if (bindsIndividual(body)) {
    return c.json({ error: "DEVICE_INDIVIDUAL_BINDING_FORBIDDEN" }, 400);
  }
  const deviceId = typeof body.device_id === "string" && body.device_id ? body.device_id : ulid();
  const data: Record<string, unknown> = {
    device_id: deviceId,
    provider: typeof body.provider === "string" && body.provider ? body.provider : "dummy",
    display_name: body.display_name,
    actor_id: actorId,
    created_at: new Date().toISOString(),
  };
  if (typeof body.placement_ref === "string") data.placement_ref = body.placement_ref;
  if (typeof body.started_on === "string") data.started_on = body.started_on; // 開始日のみ
  const res = await store(c).putEventAt(`truth/${DEVICE_TYPE}/${deviceId}.json`, envelope(actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_DEVICE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_DEVICE", key: res.key }, 409);
  return c.json({ device_id: deviceId, provider: data.provider }, 201);
});

// GET /devices — list with display_name. No key-related field is exposed
// (V3-SEC-03: the server holds no key material to report on — there is no
// has_api_key flag anymore because the server has no way to know).
deviceRoutes.get("/devices", async (c) => {
  const actorId = c.get("actorId");
  const rows = (await store(c).listEvents(`truth/${DEVICE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId) // 本人スコープ
    .filter((d) => !CORRUPTED_DEVICE_IDS.has(String(d.device_id)))
    .map((d) => ({
      device_id: d.device_id,
      display_name: d.display_name,
      provider: d.provider,
      placement_ref: d.placement_ref ?? null,
      started_on: d.started_on ?? null,
    }));
  return c.json({ devices: rows });
});

// ── V3-OBS-30: データ取得間隔4階層(既定/一括上書き/複数選択/個別) ─────────
// クラウド最新値取得系(SwitchBot等)は「間隔設定は無意味/DB格納値を取るだけで
// リアルタイムでない」ため常に null(設定不可)。自作デバイスは秒単位。優先順位:
// 個別device override(最新) > 直近の一括上書き(scope="global"・最新) >
// 既定(DEFAULT_POLL_INTERVAL_SEC)。不変条項①(append-only)に合わせ、上書きは
// device record を直接書き換えず「設定イベントの追記+最新を投影」で表現する
// (source-routes.ts projectLabEnvironmentAt と同じ append-only history 型)。
const POLL_INTERVAL_TYPE = "ihl.obs.poll_interval.v1";

function isCloudProvider(provider: unknown): boolean {
  return typeof provider === "string" && CLOUD_POLL_PROVIDERS.has(provider.toLowerCase());
}

/** 4階層の解決(純関数・OBS-30)。 */
export function resolvePollIntervalSec(
  provider: unknown,
  deviceOverrideSec: number | null,
  globalOverrideSec: number | null,
): { interval_sec: number | null; reason: string } {
  if (isCloudProvider(provider)) {
    return { interval_sec: null, reason: "CLOUD_POLL_INTERVAL_MEANINGLESS" };
  }
  if (deviceOverrideSec !== null) return { interval_sec: deviceOverrideSec, reason: "individual" };
  if (globalOverrideSec !== null) return { interval_sec: globalOverrideSec, reason: "global_override" };
  return { interval_sec: DEFAULT_POLL_INTERVAL_SEC, reason: "default" };
}

/** scope="global" または device_id プレフィックスの最新設定イベントを投影する。 */
async function latestPollIntervalFor(s: TruthStore, scope: string): Promise<number | null> {
  const seg = encodeURIComponent(scope);
  const events = (await s.listEvents(`truth/${POLL_INTERVAL_TYPE}/${seg}-`)).map(dataOf);
  let latest: Record<string, unknown> | null = null;
  for (const d of events) {
    if (!latest || String(d.created_at) > String(latest.created_at)) latest = d;
  }
  const v = latest?.interval_sec;
  return typeof v === "number" ? v : null;
}

async function appendPollIntervalEvent(
  s: TruthStore,
  actorId: string,
  scope: string,
  intervalSec: number,
): Promise<void> {
  const id = ulid();
  const seg = encodeURIComponent(scope);
  await s.putEventAt(`truth/${POLL_INTERVAL_TYPE}/${seg}-${id}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: POLL_INTERVAL_TYPE,
    time: new Date().toISOString(),
    dataschema: "schemas/events/obs-poll-interval.schema.json",
    provenance: { generator_kind: "human", actor_id: actorId },
    data: { scope, interval_sec: intervalSec, actor_id: actorId, created_at: new Date().toISOString() },
  });
}

// PUT /devices/poll-interval — 一括上書き(device_ids省略=既定を差し替える
// scope="global")または複数選択/個別(device_ids指定・1件でも複数件でも同じ
// 経路=OBS-30「複数選択と個別」の統一)。interval_sec は自作デバイス向けに
// 秒単位で細かく指定可能(CUSTOM_MIN_POLL_INTERVAL_SEC以上)。
deviceRoutes.put("/devices/poll-interval", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const intervalSec = body.interval_sec;
  if (typeof intervalSec !== "number" || !Number.isFinite(intervalSec) || intervalSec < CUSTOM_MIN_POLL_INTERVAL_SEC) {
    return c.json({ error: "INVALID_INTERVAL" }, 400);
  }
  const s = store(c);
  const deviceIds = Array.isArray(body.device_ids)
    ? (body.device_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : null;

  if (deviceIds === null) {
    await appendPollIntervalEvent(s, actorId, "global", intervalSec);
    return c.json({ scope: "global", interval_sec: intervalSec }, 202);
  }
  if (deviceIds.length === 0) return c.json({ error: "EMPTY_DEVICE_IDS" }, 400);
  const results: { device_id: string; ok: boolean }[] = [];
  for (const deviceId of deviceIds) {
    const rec = await s.readEvent(`truth/${DEVICE_TYPE}/${deviceId}.json`);
    if (!rec || dataOf(rec).actor_id !== actorId) {
      results.push({ device_id: deviceId, ok: false });
      continue;
    }
    await appendPollIntervalEvent(s, actorId, deviceId, intervalSec);
    results.push({ device_id: deviceId, ok: true });
  }
  return c.json({ scope: deviceIds.length === 1 ? "individual" : "multi_select", results }, 202);
});

// GET /devices/{id}/poll-interval — 4階層を解決した実効値(OBS-30)。
deviceRoutes.get("/devices/:id/poll-interval", async (c) => {
  const deviceId = c.req.param("id");
  const actorId = c.get("actorId");
  const s = store(c);
  const rec = await s.readEvent(`truth/${DEVICE_TYPE}/${deviceId}.json`);
  if (!rec || dataOf(rec).actor_id !== actorId) return c.json({ error: "NOT_FOUND" }, 404);
  const d = dataOf(rec);
  const deviceOverride = await latestPollIntervalFor(s, deviceId);
  const globalOverride = await latestPollIntervalFor(s, "global");
  const resolved = resolvePollIntervalSec(d.provider, deviceOverride, globalOverride);
  return c.json({ device_id: deviceId, ...resolved });
});

// POST /devices/{id}/test — dummy provider connection test + auto-discovery
// (OBS-31 / V3-SEC-03). The server holds no stored key: the caller supplies the
// provider key per-call via the `x-device-api-key` header or a JSON body
// `api_key` field (the ScreenDef renderer has no header vocabulary, so the
// device screen's test form sends it in the body — header support is kept for
// other/future clients). It is used only for this single request's
// dummyTestConnection call and is never written to Truth or anywhere else —
// no server-side persistence, encrypted or otherwise. Real provider keys are
// a human gate and are not invoked here.
deviceRoutes.post("/devices/:id/test", async (c) => {
  const deviceId = c.req.param("id");
  const actorId = c.get("actorId");
  const rec = await store(c).readEvent(`truth/${DEVICE_TYPE}/${deviceId}.json`);
  if (!rec) return c.json({ error: "NOT_FOUND" }, 404);
  const d = dataOf(rec);
  if (d.actor_id !== actorId) return c.json({ error: "NOT_FOUND" }, 404); // 本人スコープ
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const bodyKey = typeof body.api_key === "string" && body.api_key ? body.api_key : null;
  const apiKey = bodyKey ?? c.req.header("x-device-api-key") ?? null;
  const result = dummyTestConnection(deviceId, apiKey);
  // never echo the plaintext key back — only the connection outcome.
  return c.json({ device_id: deviceId, provider: d.provider, ...result });
});
