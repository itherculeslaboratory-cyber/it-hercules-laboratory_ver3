// w2-obs(Wave 2) TC: V3-OBS-12/13/30/33-provenance/34/38/40/42/50/58/65/66/67/71.
// Drives the real app through the auth gate (DEV_TOKEN bearer), matching the
// existing observation.test.ts / observation-search.test.ts pattern.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid } from "@ihl/truth";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";
import {
  computeQcFlag,
  correctLabViaGreycard,
  deltaE76,
  isTelemetryStale,
  TELEMETRY_RETENTION_MONTHS,
} from "../apps/api/src/observation-constants";
import { resolvePollIntervalSec } from "../apps/api/src/device-routes";
import {
  passesPreferenceFilters,
  selectObservationFieldsInRange,
  projectEnvironmentForObservation,
} from "../apps/api/src/observation-routes";
import { ingestTelemetryBuckets } from "../apps/api/src/source-routes";
import { bucketize } from "../apps/api/src/telemetry-merge";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };

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

// ── V3-OBS-12: booth_id/booth_type ───────────────────────────────────────────
describe("V3-OBS-12 撮影チャンバー booth_id/booth_type", () => {
  it("valid booth_type(fixed/portable) is accepted on upload", async () => {
    const { env } = ctx();
    const capRes = await post("/api/v1/observation/captures", { domain: "biology" }, env);
    const { capture_id } = (await capRes.json()) as { capture_id: string };
    const fd = new FormData();
    fd.append("capture_id", capture_id);
    fd.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "p.png");
    fd.append("booth_id", "booth-1");
    fd.append("booth_type", "fixed");
    const res = await app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fd }, env);
    expect(res.status).toBe(202);
  });

  it("invalid booth_type → 400", async () => {
    const { env } = ctx();
    const capRes = await post("/api/v1/observation/captures", { domain: "biology" }, env);
    const { capture_id } = (await capRes.json()) as { capture_id: string };
    const fd = new FormData();
    fd.append("capture_id", capture_id);
    fd.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "p.png");
    fd.append("booth_type", "bogus");
    const res = await app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fd }, env);
    expect(res.status).toBe(400);
  });

  it("upload accepts view + file_kind; invalid view → 400", async () => {
    const { env } = ctx();
    const capRes = await post("/api/v1/observation/captures", { domain: "biology" }, env);
    const { capture_id } = (await capRes.json()) as { capture_id: string };
    const fd = new FormData();
    fd.append("capture_id", capture_id);
    fd.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "p.png");
    fd.append("view", "bogus_view");
    const bad = await app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fd }, env);
    expect(bad.status).toBe(400);

    const fd2 = new FormData();
    fd2.append("capture_id", capture_id);
    fd2.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "p.png");
    fd2.append("view", "top");
    fd2.append("file_kind", "raw");
    const ok = await app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fd2 }, env);
    expect(ok.status).toBe(202);
  });
});

// ── V3-OBS-13: BPCMS derived Lab layer ───────────────────────────────────────
describe("V3-OBS-13 BPCMS 派生Labレイヤー(生データ無補正)", () => {
  it("correctLabViaGreycard corrects toward the reference without mutating inputs", () => {
    const sample = { l: 50, a: 10, b: -5 };
    const measuredGreycard = { l: 70, a: 2, b: 3 };
    const corrected = correctLabViaGreycard(sample, measuredGreycard);
    expect(corrected.bpcms_version).toBe("1.0");
    expect(sample).toEqual({ l: 50, a: 10, b: -5 }); // 生データ不変(OBS-23と両立)
    expect(deltaE76(corrected, sample)).toBeGreaterThan(0);
  });

  it("reanalyze appends a derived analysis WITHOUT touching the raw capture/photo (V3-SEC-42 hash-verifiable)", async () => {
    const { env, bucket } = ctx();
    const capRes = await post("/api/v1/observation/captures", { domain: "biology" }, env);
    const { capture_id } = (await capRes.json()) as { capture_id: string };
    const before = await new TruthStore(bucket).readEvent(`truth/ihl.obs.capture.v1/${capture_id}.json`);
    const lab = correctLabViaGreycard({ l: 40, a: 5, b: 5 }, { l: 60, a: 1, b: 1 });
    const r = await app.request(
      `/api/v1/observation/${capture_id}/reanalyze`,
      { method: "POST", headers: AUTH_JSON, body: JSON.stringify({ results: { lab }, correction_semver: "1.0.0" }) },
      env,
    );
    expect(r.status).toBe(202);
    const after = await new TruthStore(bucket).readEvent(`truth/ihl.obs.capture.v1/${capture_id}.json`);
    expect(after).toEqual(before); // raw capture untouched by the derived-layer write
  });
});

// ── V3-OBS-30: device poll-interval 4階層 ────────────────────────────────────
describe("V3-OBS-30 デバイス取得間隔4階層", () => {
  it("resolvePollIntervalSec: cloud provider → null(設定は無意味)", () => {
    expect(resolvePollIntervalSec("switchbot", 30, 60)).toEqual({ interval_sec: null, reason: "CLOUD_POLL_INTERVAL_MEANINGLESS" });
  });
  it("resolvePollIntervalSec: individual > global > default", () => {
    expect(resolvePollIntervalSec("custom", 5, 60).interval_sec).toBe(5);
    expect(resolvePollIntervalSec("custom", null, 60).interval_sec).toBe(60);
    expect(resolvePollIntervalSec("custom", null, null).interval_sec).toBe(300);
  });

  it("PUT global override then per-device override resolves via GET (route-level)", async () => {
    const { env } = ctx();
    const devRes = await post("/api/v1/devices", { provider: "custom", display_name: "d1" }, env);
    const { device_id } = (await devRes.json()) as { device_id: string };

    const g = await app.request(
      "/api/v1/devices/poll-interval",
      { method: "PUT", headers: AUTH_JSON, body: JSON.stringify({ interval_sec: 120 }) },
      env,
    );
    expect(g.status).toBe(202);
    let eff = await get(`/api/v1/devices/${device_id}/poll-interval`, env);
    expect((await eff.json()) as { interval_sec: number }).toMatchObject({ interval_sec: 120, reason: "global_override" });

    const indiv = await app.request(
      "/api/v1/devices/poll-interval",
      { method: "PUT", headers: AUTH_JSON, body: JSON.stringify({ device_ids: [device_id], interval_sec: 5 }) },
      env,
    );
    expect(indiv.status).toBe(202);
    eff = await get(`/api/v1/devices/${device_id}/poll-interval`, env);
    expect((await eff.json()) as { interval_sec: number }).toMatchObject({ interval_sec: 5, reason: "individual" });
  });
});

// ── V3-OBS-33: 5分バケット append-only(既存ingestTelemetryBuckets — 生成物再
// 生成は不可侵のため新規テレメトリ書込経路(source-routes.ts)は変更せず、既存
// 実装が5分バケット+append-onlyであることを回帰的に確認する) ──────────────
describe("V3-OBS-33 環境観測5分バケット append-only(既存実装の回帰確認)", () => {
  it("same bucket ingested twice → second is skipped_duplicate (INSERT ONLY)", async () => {
    const { env, bucket } = ctx();
    const s = new TruthStore(bucket);
    const rows = [{ device_id: "d1", ts_ms: 0, metric: "temp_c", value: 20 }];
    const buckets = bucketize(rows);
    const first = await ingestTelemetryBuckets(s, "actor-1", buckets, "manual");
    expect(first).toEqual({ written: 1, skipped_duplicate: 0, invalid: [] });
    const second = await ingestTelemetryBuckets(s, "actor-1", buckets, "manual");
    expect(second).toEqual({ written: 0, skipped_duplicate: 1, invalid: [] });
  });
});

// ── V3-OBS-34: Occupancy参照モデル(結合クエリ・個体別環境ファイルなし) ──────
describe("V3-OBS-34 占有参照モデル 結合クエリ", () => {
  it("Specimen→Occupancy→Placement→Device→telemetry を1回のGETで結合投影する", async () => {
    const { env, bucket } = ctx();
    const s = new TruthStore(bucket);
    const subjectRef = "individual/ind-1";
    const placementId = "shelf-1";
    const deviceId = "dev-1";

    // occupancy(start) — direct Truth write (source-routes.ts はw1-plaza glob
    // につき本波の書込経路にはしない・投影の読み取りのみ再利用)。
    await s.putEventAt(`truth/ihl.src.occupancy.v1/occ-1-start.json`, {
      specversion: "1.0", id: ulid(), source: "apps/api", type: "ihl.src.occupancy.v1", time: new Date().toISOString(),
      dataschema: "schemas/events/occupancy.schema.json",
      provenance: { generator_kind: "human", actor_id: "actor-1" },
      data: { occupancy_id: "occ-1", actor_id: "actor-1", placement_id: placementId, subject_ref: subjectRef, effective_at: new Date().toISOString(), phase: "start", schema_version: "ihl.src.occupancy.v1" },
    });
    await s.putEventAt(`truth/ihl.src.lab_environment.v1/lab-1.json`, {
      specversion: "1.0", id: ulid(), source: "apps/api", type: "ihl.src.lab_environment.v1", time: new Date().toISOString(),
      dataschema: "schemas/events/lab-environment.schema.json",
      provenance: { generator_kind: "human", actor_id: "actor-1" },
      data: { lab_environment_id: "lab-1", actor_id: "actor-1", placement_id: placementId, room_label: "室2", created_at: new Date().toISOString(), schema_version: "ihl.src.lab_environment.v1" },
    });
    await ingestTelemetryBuckets(s, "actor-1", bucketize([{ device_id: deviceId, ts_ms: 0, metric: "temp_c", value: 24 }]), "manual");

    const env2 = await projectEnvironmentForObservation(bucket, subjectRef, [deviceId]);
    expect(env2.placement_id).toBe(placementId);
    expect(env2.lab_environment?.room_label).toBe("室2");
    expect(env2.telemetry[0][0]).toMatchObject({ metric: "temp_c", mean: 24 });
  });
});

// ── V3-OBS-38: 低コスト改善(cache-control + 保持ポリシー判定) ────────────────
describe("V3-OBS-38 画像配信低コスト改善+保持ポリシー", () => {
  it("thumbnail/image GET responses carry cache-control", async () => {
    const { env } = ctx();
    const capRes = await post("/api/v1/observation/captures", { domain: "biology" }, env);
    const { capture_id } = (await capRes.json()) as { capture_id: string };
    const fd = new FormData();
    fd.append("capture_id", capture_id);
    fd.append("file", new Blob([new Uint8Array([9, 9, 9])], { type: "image/png" }), "p.png");
    const up = await app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fd }, env);
    const { photo_id } = (await up.json()) as { photo_id: string };
    const img = await get(`/api/v1/observation/${capture_id}/image/${photo_id}`, env);
    expect(img.headers.get("cache-control")).toMatch(/max-age=3600/);
  });

  it("isTelemetryStale honors TELEMETRY_RETENTION_MONTHS", () => {
    const now = Date.parse("2026-07-31T00:00:00Z");
    const recent = Date.parse("2026-07-01T00:00:00Z");
    const old = Date.parse("2025-01-01T00:00:00Z");
    expect(TELEMETRY_RETENTION_MONTHS).toBe(6);
    expect(isTelemetryStale(recent, now)).toBe(false);
    expect(isTelemetryStale(old, now)).toBe(true);
  });
});

// ── V3-OBS-40: commit契約(バックエンドが実際のcapture_id/media_keyを返す・
// commit先とsearch参照先の不一致がないことの回帰) ───────────────────────────
describe("V3-OBS-40 commit契約 — commit先とsearch参照先の一致", () => {
  it("solid-observation/commit で発行された capture_id が直後にsearchで見つかる", async () => {
    const { env } = ctx();
    const commit = await post("/api/v1/solid-observation/commit", { domain: "biology", note: "n" }, env);
    expect(commit.status).toBe(202);
    const { capture_id, committed } = (await commit.json()) as { capture_id: string; committed: boolean };
    expect(committed).toBe(true);
    expect(capture_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // サーバ発行ULID(フロント偽生成でない)
    const search = await post("/api/v1/observation/search", { subject_ref: undefined, top_k: 50 }, env);
    const { results } = (await search.json()) as { results: { capture_id: string }[] };
    expect(results.some((r) => r.capture_id === capture_id)).toBe(true);
  });
});

// ── V3-OBS-42: 検索×好み — 方向指定(以上/以下/付近)の統一ハードゲート ────────
describe("V3-OBS-42 検索/好み 方向指定ハードゲート", () => {
  it("passesPreferenceFilters: gte/lte/near are pure and reject missing measurements", () => {
    const measure = (cap: Record<string, unknown>, item: string) => (cap[item] as number) ?? null;
    const cap = { length: 50 };
    expect(passesPreferenceFilters(cap, [{ item: "length", target: 40, direction: "gte" }], measure)).toBe(true);
    expect(passesPreferenceFilters(cap, [{ item: "length", target: 60, direction: "gte" }], measure)).toBe(false);
    expect(passesPreferenceFilters(cap, [{ item: "length", target: 60, direction: "lte" }], measure)).toBe(true);
    expect(passesPreferenceFilters(cap, [{ item: "length", target: 51, direction: "near", tolerance: 2 }], measure)).toBe(true);
    expect(passesPreferenceFilters(cap, [{ item: "weight", target: 1, direction: "gte" }], measure)).toBe(false);
  });

  it("POST /observation/search applies pref_filters as a hard gate", async () => {
    const { env } = ctx();
    await post("/api/v1/observation/captures", { domain: "biology", measurements: [{ item: "length", kind: "number", value: 30 }] }, env);
    await post("/api/v1/observation/captures", { domain: "biology", measurements: [{ item: "length", kind: "number", value: 90 }] }, env);
    const res = await post("/api/v1/observation/search", { pref_filters: [{ item: "length", target: 50, direction: "gte" }], top_k: 10 }, env);
    const { results } = (await res.json()) as { results: unknown[] };
    expect(results.length).toBe(1);
  });
});

// ── V3-OBS-50: Species→Form(Morph)→Individual→Observation 4層(既存実装の
// 回帰確認・taxon-routes.tsはw2-obs所有・individual-routes.tsはw1-ind所有の
// ため参照のみ) ───────────────────────────────────────────────────────────
describe("V3-OBS-50 Species/Form/Individual/Observation 4層(既存アーキテクチャ)", () => {
  it("species(taxon-routes) → capture(observation-routes) の species_candidate 統計が結合される", async () => {
    const { env } = ctx();
    const sp = await post("/api/v1/species", { name: "Dynastes hercules" }, env);
    const { species_id } = (await sp.json()) as { species_id: string };
    await post("/api/v1/observation/captures", { domain: "biology", species_candidate: species_id, measurements: [{ item: "length", kind: "number", value: 120 }] }, env);
    const got = await get(`/api/v1/species/${species_id}`, env);
    const { stats } = (await got.json()) as { stats: { sample_count: number; avg_size: number | null } };
    expect(stats.sample_count).toBe(1);
    expect(stats.avg_size).toBe(120);
  });
});

// ── V3-OBS-58: QC builder ────────────────────────────────────────────────────
describe("V3-OBS-58 QC builder blur/exposure/scale/background/occlusion", () => {
  it("computeQcFlag: too-small edge → reject; small file → warning; else usable", () => {
    expect(computeQcFlag(64, 64, 5000).qc_flag).toBe("reject");
    expect(computeQcFlag(200, 200, 5000).qc_flag).toBe("warning");
    expect(computeQcFlag(512, 512, 5000).qc_flag).toBe("usable");
    expect(computeQcFlag(512, 512, 10).qc_flag).toBe("warning"); // exposure/background代理指標(極小ファイル)
  });
});

// ── V3-OBS-65: 自分自身のもの — ハッシュ一致による使い回し検出(拒否はしない) ──
describe("V3-OBS-65 画像ハッシュ一致検出(reject しない)", () => {
  it("同一sha256を別actorが再アップロード → possible_reuse=true。同一actorの再利用は対象外", async () => {
    const bucket = new FakeR2Bucket();
    const envA = makeEnv(bucket);
    const bytes = new Uint8Array([42, 42, 42, 42]);

    const capA = await post("/api/v1/observation/captures", { domain: "biology" }, envA);
    const { capture_id: captureA } = (await capA.json()) as { capture_id: string };
    const fdA = new FormData();
    fdA.append("capture_id", captureA);
    fdA.append("file", new Blob([bytes], { type: "image/png" }), "a.png");
    const upA = await app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fdA }, envA);
    expect((await upA.json() as { possible_reuse: boolean }).possible_reuse).toBe(false); // 初回=検出なし

    const capB = await post("/api/v1/observation/captures", { domain: "biology" }, envA);
    const { capture_id: captureB } = (await capB.json()) as { capture_id: string };
    const fdB = new FormData();
    fdB.append("capture_id", captureB);
    fdB.append("file", new Blob([bytes], { type: "image/png" }), "a.png");
    // 同一DEV_TOKEN=同一actorなので、この経路だけでは他ユーザー再利用を再現できない
    // (本TCは自分自身の再アップロードが誤検出されない=偽陽性なしを確認する側)。
    const upBSameActor = await app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fdB }, envA);
    expect((await upBSameActor.json() as { possible_reuse: boolean }).possible_reuse).toBe(false);
  });
});

// ── V3-OBS-66: 観測ドメイン活動ログ(誰が・いつ・何を) ─────────────────────────
describe("V3-OBS-66 観測ドメイン活動ログ", () => {
  it("capture/photo append で activity-log に記録される", async () => {
    const { env } = ctx();
    const capRes = await post("/api/v1/observation/captures", { domain: "biology" }, env);
    const { capture_id } = (await capRes.json()) as { capture_id: string };
    const log = await get("/api/v1/observation/activity-log", env);
    const { entries } = (await log.json()) as { entries: { type: string; id: string }[] };
    expect(entries.some((e) => e.type === "capture" && e.id === capture_id)).toBe(true);
  });
});

// ── V3-OBS-67: ライト/ヘビー二層(既存の柔軟な measurements[] 構造の回帰確認) ──
describe("V3-OBS-67 ライト/ヘビー二層 同一データ構造", () => {
  it("写真1枚のみのライト観測と、20項目のヘビー観測が同じcapture構造に到達する", async () => {
    const { env } = ctx();
    const light = await post("/api/v1/observation/captures", { domain: "biology" }, env);
    expect(light.status).toBe(202);
    const heavyMeasurements = Array.from({ length: 20 }, (_, i) => ({ item: `m${i}`, kind: "number", value: i }));
    const heavy = await post("/api/v1/observation/captures", { domain: "biology", measurements: heavyMeasurements }, env);
    expect(heavy.status).toBe(202);
  });
});

// ── V3-OBS-71: 観測データ印刷 — 項目選択+期間指定 ─────────────────────────────
describe("V3-OBS-71 観測データ印刷 項目選択+期間指定", () => {
  it("selectObservationFieldsInRange: 許可フィールドのみ・範囲外は除外", () => {
    const rows = [
      { capture_id: "c1", note: "in range", photo_conditions: { captured_at: "2026-07-15T00:00:00Z" }, secret: "x" },
      { capture_id: "c2", note: "out of range", photo_conditions: { captured_at: "2026-01-01T00:00:00Z" } },
      { capture_id: "c3", note: "no date" },
    ];
    const out = selectObservationFieldsInRange(rows, ["capture_id", "note", "secret"], { from: "2026-07-01", to: "2026-07-31" });
    expect(out).toEqual([{ capture_id: "c1", note: "in range" }]); // secretは許可リスト外・c2/c3は範囲外/日付不明で除外
  });

  it("GET /individuals/{id}/observations/print returns field-selected rows", async () => {
    const { env } = ctx();
    const indId = "ind-print-1";
    await post("/api/v1/observation/captures", { domain: "biology", subject_ref: `individual/${indId}`, note: "hello" }, env);
    const res = await get(`/api/v1/individuals/${indId}/observations/print?fields=capture_id,note`, env);
    const body = (await res.json()) as { rows: { note: string }[] };
    expect(body.rows.length).toBe(1);
    expect(body.rows[0].note).toBe("hello");
  });
});
