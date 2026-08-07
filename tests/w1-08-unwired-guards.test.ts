// 2026-08-07 order-w1-08-unwired-guards: 「作ってあるのに繋いでいない」防御機構の配線TC。
// T1: policy.ts の buildImageReuseSilentWarning を V3-OBS-65(sha256完全一致検出)へ配線
//     (dHash/EXIF/成長曲線/特徴点はupload時点で入力が揃わず配線できなかった=報告書参照)。
//     ★「イベントとして台帳に追記」まではできず、構造化サーバログ(console.warn)止まり
//     (event-registry-wiring.test.ts の UNREGISTERED_DEBT 上限アサートに抵触するため。
//     報告書「決められなかったこと」参照)。
// T2: pii.mjs の redactForPublic を GET /observation/{capture_id} と
//     GET /individuals/{individual_id}/observations の note フィールドへ配線。
import { describe, expect, it, vi } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId, ulid } from "@ihl/truth";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");
const OTHER_ACTOR = "someone-else";

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}

async function post(path: string, body: unknown, env: object, headers = AUTH_JSON) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
async function get(path: string, env: object, headers: Record<string, string> = AUTH) {
  return app.request(path, { method: "GET", headers }, env);
}

function envOf(type: string, dataschema: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type,
    time: "2026-08-07T00:00:00Z",
    dataschema,
    provenance: { generator_kind: "human", actor_id: OTHER_ACTOR },
    data,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

describe("V3-OBS-54 T1: sha256完全一致検出をbuildImageReuseSilentWarningでevent化", () => {
  it("同一sha256を別actorが再アップロード → 静かな警告ログが記録され、アップロード自体は成功する(ブロックしない)", async () => {
    const { bucket, env } = ctx();
    const bytes = new Uint8Array([9, 9, 9, 9, 9]);
    const sha256 = await sha256Hex(bytes);
    const store = new TruthStore(bucket);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 別actor(OTHER_ACTOR)が同一バイト列を先にアップロード済みという状態を直接シード
    // (individual.test.ts 822行目と同一手法 — POSTはactor_idをセッションから強制上書き
    // するため、別actorのアップロードをHTTP経由で再現できない)。
    const priorPhotoId = ulid();
    const priorCaptureId = ulid();
    await store.putEventAt(
      `truth/ihl.obs.photo.v1/${priorCaptureId}-${priorPhotoId}.json`,
      envOf("ihl.obs.photo.v1", "schemas/events/obs-photo.schema.json", {
        photo_id: priorPhotoId,
        capture_id: priorCaptureId,
        actor_id: OTHER_ACTOR,
        media_key: `media/photo/${priorPhotoId}`,
        content_type: "image/png",
        size_bytes: bytes.length,
        sha256,
      }),
    );

    const capRes = await post("/api/v1/observation/captures", { domain: "biology" }, env);
    const { capture_id: captureId } = (await capRes.json()) as { capture_id: string };
    const fd = new FormData();
    fd.append("capture_id", captureId);
    fd.append("file", new Blob([bytes], { type: "image/png" }), "p.png");
    const up = await app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fd }, env);

    // ブロックしない: 202のまま成功する。
    expect(up.status).toBe(202);
    const upBody = (await up.json()) as { possible_reuse: boolean; photo_id: string };
    expect(upBody.possible_reuse).toBe(true);

    // buildImageReuseSilentWarning() の戻り値を積んだ静かな警告ログが1回だけ出る。
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [, payload] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.reasons).toEqual(["sha256_exact"]);
    expect(payload.capture_id).toBe(captureId);
    expect(payload.photo_id).toBe(upBody.photo_id);
    expect(typeof payload.flagged_at).toBe("string");

    // 他ユーザーに見える形では出さない: upload レスポンスに reasons/warning_id を含めない。
    expect(Object.keys(upBody)).not.toContain("reasons");
    expect(Object.keys(upBody)).not.toContain("warning_id");
    warnSpy.mockRestore();
  });

  it("自分自身の再アップロード(既存V3-OBS-65の偽陽性なし挙動)では警告ログも出ない", async () => {
    const { env } = ctx();
    const bytes = new Uint8Array([7, 7, 7, 7]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const capA = await post("/api/v1/observation/captures", { domain: "biology" }, env);
    const { capture_id: captureA } = (await capA.json()) as { capture_id: string };
    const fdA = new FormData();
    fdA.append("capture_id", captureA);
    fdA.append("file", new Blob([bytes], { type: "image/png" }), "a.png");
    await app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fdA }, env);

    const capB = await post("/api/v1/observation/captures", { domain: "biology" }, env);
    const { capture_id: captureB } = (await capB.json()) as { capture_id: string };
    const fdB = new FormData();
    fdB.append("capture_id", captureB);
    fdB.append("file", new Blob([bytes], { type: "image/png" }), "a.png");
    const upB = await app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fdB }, env);
    expect((await upB.json() as { possible_reuse: boolean }).possible_reuse).toBe(false);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("V3-IND-30 T2: redactForPublicをGET /observation/{capture_id}へ配線", () => {
  it("他人(未ログイン含む)が読むとPIIはマスクされ、ULID(個体ID相当の構造化ID)はマスクされない", async () => {
    const { bucket, env } = ctx();
    const captureId = ulid();
    const individualUlid = "01ARZ3NDEKTSV4RRFFQ69G5FAV"; // Crockford base32 ULID形式
    const store = new TruthStore(bucket);
    await store.putEventAt(
      `truth/ihl.obs.capture.v1/${captureId}.json`,
      envOf("ihl.obs.capture.v1", "schemas/events/obs-capture.schema.json", {
        capture_id: captureId,
        actor_id: OTHER_ACTOR,
        domain: "biology",
        note: `連絡先 bob@example.com 個体参照 ${individualUlid}`,
      }),
    );

    // 未ログイン(未認証)閲覧 — GET /observation/:capture_id はpublic wildcard route。
    const anon = await app.request(`/api/v1/observation/${captureId}`, {}, env);
    expect(anon.status).toBe(200);
    const anonBody = (await anon.json()) as { capture: { note: string } };
    expect(anonBody.capture.note).toContain("{{PII:EMAIL}}");
    expect(anonBody.capture.note).not.toContain("bob@example.com");
    expect(anonBody.capture.note).toContain(individualUlid); // ULIDはマスク対象外(STRUCTURED_ID_ALLOW)

    // 別actor(DEV_ACTOR)がログイン閲覧しても同様にマスクされる(本人ではないため)。
    const other = await app.request(`/api/v1/observation/${captureId}`, { headers: AUTH }, env);
    const otherBody = (await other.json()) as { capture: { note: string } };
    expect(otherBody.capture.note).toContain("{{PII:EMAIL}}");
  });

  it("本人が自分の観測を見る時はマスクしない", async () => {
    const { env } = ctx();
    const capRes = await post(
      "/api/v1/observation/captures",
      { domain: "biology", note: "連絡先 bob@example.com" },
      env,
    );
    const { capture_id: captureId } = (await capRes.json()) as { capture_id: string };
    const detail = await app.request(`/api/v1/observation/${captureId}`, { headers: AUTH }, env);
    const body = (await detail.json()) as { capture: { note: string } };
    expect(body.capture.note).toContain("bob@example.com");
    expect(body.capture.note).not.toContain("{{PII:EMAIL}}");
  });
});

describe("V3-IND-30 T2: redactForPublicをGET /individuals/{individual_id}/observationsへ配線", () => {
  it("他人の観測一覧に含まれるnoteはマスクされる", async () => {
    const { bucket, env } = ctx();
    const individualId = ulid();
    const captureId = ulid();
    const store = new TruthStore(bucket);
    await store.putEventAt(
      `truth/ihl.obs.capture.v1/${captureId}.json`,
      envOf("ihl.obs.capture.v1", "schemas/events/obs-capture.schema.json", {
        capture_id: captureId,
        actor_id: OTHER_ACTOR,
        domain: "biology",
        subject_ref: `individual/${individualId}`,
        note: "電話 090-1234-5678 です",
      }),
    );
    const res = await get(`/api/v1/individuals/${individualId}/observations`, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { observations: { note: string }[] };
    expect(body.observations.length).toBe(1);
    expect(body.observations[0].note).toContain("{{PII:PHONE_JP}}");
    expect(body.observations[0].note).not.toContain("090-1234-5678");
  });
});
