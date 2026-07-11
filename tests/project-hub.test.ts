// PPR-16 Project Hub / Ver 分岐 / bestVersion・PPR-18 citation 報酬・PPR-09 再解析マニフェスト
// (design-k5 §4)。project-routes.ts の 100 番台モジュールを app.request 経由で検証。bestVersion は
// Ver 別観測集計から決定論選定（同点 version_label 昇順）。citation は append-only（同一キー再 put=409・
// status=updated は別イベント）で報酬は grantPlatinum(contribution_rebate) のみ（懲罰関数は呼ばない）。
// reanalysisManifest は事実キーのみ・画像バイナリ非含・同一入力同一結果、observed_at(data)≠committed_at。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore } from "@ihl/truth";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv, makeEnvelope } from "./helpers";
import { projectLedger } from "../apps/api/src/ledger-routes";
import { CONTRIBUTION_POINTS_PER_CITATION } from "../apps/api/src/research-constants";

function post(bucket: FakeR2Bucket, path: string, body: unknown): Promise<Response> {
  return app.request(path, { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, makeEnv(bucket));
}
function get(bucket: FakeR2Bucket, path: string): Promise<Response> {
  return app.request(path, { method: "GET", headers: AUTH_HEADERS }, makeEnv(bucket));
}
function createProject(bucket: FakeR2Bucket, body: Record<string, unknown>): Promise<Response> {
  return post(bucket, "/api/v1/research/projects", body);
}
function createContent(bucket: FakeR2Bucket, body: Record<string, unknown>): Promise<Response> {
  return post(bucket, "/api/v1/research/content", body);
}
function measurement(value: number): Record<string, unknown> {
  return { item: "growth", value, value_origin: "direct_observed" };
}
// obs-photo / obs-analysis を capture-prefix キーで直接 seed（reanalysisManifest の prefix scan 対象）。
async function seedObs(
  bucket: FakeR2Bucket,
  type: string,
  key: string,
  data: Record<string, unknown>,
): Promise<void> {
  const env = makeEnvelope({ type, dataschema: `schemas/events/${type.replace("ihl.", "").replace(/\./g, "-").replace("-v1", "")}.schema.json`, data });
  const res = await new TruthStore(bucket).putEventAt(key, env);
  expect(res.status).toBe("inserted");
}

describe("PPR-16 bestVersion deterministic selection from per-version observation aggregation", () => {
  it("picks the version with the highest average measurement score", async () => {
    const bucket = new FakeR2Bucket();
    expect((await createProject(bucket, { project_id: "P-root", title: "v1" })).status).toBe(201);
    const branch = await post(bucket, "/api/v1/research/projects/P-root/versions", { project_id: "P-v2", title: "v2" });
    expect(branch.status).toBe(201);

    await createContent(bucket, {
      content_id: "c-root", content_type: "article", title: "cr", project_id: "P-root",
      measurements: [measurement(10)],
    });
    await createContent(bucket, {
      content_id: "c-v2", content_type: "article", title: "cv", project_id: "P-v2",
      measurements: [measurement(20), measurement(40)], // avg 30 > root avg 10
    });

    const res = (await (await get(bucket, "/api/v1/research/projects/P-root/best-version")).json()) as {
      best_version: { project_id: string; score: number } | null;
      versions: Array<{ project_id: string }>;
    };
    expect(res.best_version?.project_id).toBe("P-v2");
    expect(res.best_version?.score).toBe(30);
    // family(root + branch)が両方投影に載る。
    expect(res.versions.map((v) => v.project_id).sort()).toEqual(["P-root", "P-v2"]);
  });

  it("breaks ties by version_label ascending (deterministic)", async () => {
    const bucket = new FakeR2Bucket();
    await createProject(bucket, { project_id: "B-root", title: "m-root" });
    // 2 分岐が同スコア(5)。title(=version_label)昇順で a-ver が勝つ。
    await post(bucket, "/api/v1/research/projects/B-root/versions", { project_id: "B-a", title: "a-ver" });
    await post(bucket, "/api/v1/research/projects/B-root/versions", { project_id: "B-z", title: "z-ver" });
    await createContent(bucket, { content_id: "cb-a", content_type: "article", title: "x", project_id: "B-a", measurements: [measurement(5)] });
    await createContent(bucket, { content_id: "cb-z", content_type: "article", title: "y", project_id: "B-z", measurements: [measurement(5)] });

    const res = (await (await get(bucket, "/api/v1/research/projects/B-root/best-version")).json()) as {
      best_version: { project_id: string; version_label: string } | null;
    };
    expect(res.best_version?.version_label).toBe("a-ver");
    expect(res.best_version?.project_id).toBe("B-a");
  });
});

describe("PPR-16 projectHub aggregates by project_id (only tied content/citations/versions)", () => {
  it("hub bundles content with matching project_id, its citations and child versions", async () => {
    const bucket = new FakeR2Bucket();
    await createProject(bucket, { project_id: "H-1", title: "hub" });
    await createContent(bucket, { content_id: "in-1", content_type: "article", title: "in", project_id: "H-1" });
    await createContent(bucket, { content_id: "out-1", content_type: "article", title: "out" }); // no project_id
    await post(bucket, "/api/v1/research/projects/H-1/versions", { project_id: "H-1-v2", title: "hub-v2" });
    await post(bucket, "/api/v1/research/citations", {
      content_id: "in-1", provider_actor_id: "prov-x", source_session_id: "sess-x",
    });

    const hub = (await (await get(bucket, "/api/v1/research/projects/H-1")).json()) as {
      project: { project_id: string };
      contents: Array<{ content_id: string }>;
      citations: Array<{ content_id: string }>;
      versions: Array<{ project_id: string }>;
    };
    expect(hub.project.project_id).toBe("H-1");
    expect(hub.contents.map((c) => c.content_id)).toEqual(["in-1"]); // out-1 excluded
    expect(hub.citations.map((c) => c.content_id)).toEqual(["in-1"]);
    expect(hub.versions.map((v) => v.project_id)).toEqual(["H-1-v2"]);
  });

  it("returns 404 for an unknown project", async () => {
    const bucket = new FakeR2Bucket();
    expect((await get(bucket, "/api/v1/research/projects/nope")).status).toBe(404);
  });
});

describe("PPR-18 citation append-only + platinum reward (no punitive karma)", () => {
  it("grants a server-fixed amount on provide, 409 on same-key re-put, appends status=updated as a new event", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "cited-1", content_type: "article", title: "c" });

    // 批評家 major: クライアント指定の inflated contribution_points は無視され、サーバ固定額のみ付与。
    const provided = await post(bucket, "/api/v1/research/citations", {
      content_id: "cited-1", provider_actor_id: "prov-1", source_session_id: "sess-1", contribution_points: 999999999,
    });
    expect(provided.status).toBe(201);
    expect(((await provided.json()) as { contribution_points: number }).contribution_points).toBe(
      CONTRIBUTION_POINTS_PER_CITATION,
    );
    const store = new TruthStore(bucket);
    expect((await projectLedger(store, "prov-1")).platinum_coins).toBe(CONTRIBUTION_POINTS_PER_CITATION);

    // 同一 (content|provider|session|status|snapshot) の再 put = 409（冪等・二重付与しない）。
    const dup = await post(bucket, "/api/v1/research/citations", {
      content_id: "cited-1", provider_actor_id: "prov-1", source_session_id: "sess-1", contribution_points: 999999999,
    });
    expect(dup.status).toBe(409);
    expect((await projectLedger(store, "prov-1")).platinum_coins).toBe(CONTRIBUTION_POINTS_PER_CITATION); // no double grant

    // 不足キー充足 = status=updated は別イベント append（UPDATE 禁止・不変条項③）。報酬もサーバ固定額。
    const updated = await post(bucket, "/api/v1/research/citations", {
      content_id: "cited-1", provider_actor_id: "prov-1", source_session_id: "sess-1",
      status: "updated", match_snapshot: ["weight"], contribution_points: 2,
    });
    expect(updated.status).toBe(201);
    const led = await projectLedger(store, "prov-1");
    expect(led.platinum_coins).toBe(2 * CONTRIBUTION_POINTS_PER_CITATION); // provided + updated, 各固定額

    // 批評家 major#2: 貢献報酬で懲罰関数を呼んではならない ＝ karma count/value は不変。
    expect(led.karma_count).toBe(0);
    expect(led.karma_value).toBe(0);
  });

  it("rejects self-citation (provider == caller) so a user cannot mint platinum to themselves", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "self-1", content_type: "article", title: "s" });
    // content の actor_id = セッション principal（強制刻印）を投影から取得し、自分を provider に立てる。
    const me = ((await (await get(bucket, "/api/v1/research/content/self-1")).json()) as { actor_id: string }).actor_id;
    const res = await post(bucket, "/api/v1/research/citations", {
      content_id: "self-1", provider_actor_id: me, source_session_id: "sess-self",
    });
    expect(res.status).toBe(400);
    // 自己引用は 1 件も storage に落ちない ＝ 自己報酬 platinum も発券されない。
    expect((await projectLedger(new TruthStore(bucket), me)).platinum_coins).toBe(0);
  });

  it("rejects a citation missing required identity keys with 400", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/citations", { content_id: "x" });
    expect(res.status).toBe(400);
  });
});

describe("PPR-09 reanalysisManifest fact keys only + observed_at != committed_at", () => {
  async function seedContentWithObs(bucket: FakeR2Bucket): Promise<void> {
    await seedObs(bucket, "ihl.obs.photo.v1", "truth/ihl.obs.photo.v1/cap-1-p1.json", {
      photo_id: "p1", capture_id: "cap-1", actor_id: "actor-x",
      media_key: "media/photo/p1", content_type: "image/jpeg", size_bytes: 100, sha256: "a".repeat(64),
    });
    await seedObs(bucket, "ihl.obs.analysis.v1", "truth/ihl.obs.analysis.v1/cap-1-a1.json", {
      analysis_id: "run-1", capture_id: "cap-1", correction_semver: "1.0.0", is_manual_edit: false, actor_id: "actor-x",
      results: { scaleTemplateId: "tmpl-9", bpcmsEngineProfile: "bpcms-1" },
    });
    await createContent(bucket, {
      content_id: "obs-content", content_type: "article", title: "o",
      cited_session_ids: ["cap-1"], observed_at: "2026-01-01T00:00:00Z",
      measurements: [{ item: "len", value: 5, value_origin: "direct_observed", observed_at: "2026-01-01T00:00:00Z" }],
    });
  }

  it("aggregates fact keys (image key/scale/engine/run/hash) and is identical across calls", async () => {
    const bucket = new FakeR2Bucket();
    await seedContentWithObs(bucket);

    const m1 = (await (await get(bucket, "/api/v1/research/content/obs-content/reanalysis-manifest")).json()) as {
      facts: Array<Record<string, string>>;
    };
    expect(m1.facts).toHaveLength(1);
    expect(m1.facts[0]).toMatchObject({
      capture_id: "cap-1",
      imageR2Key: "media/photo/p1", // key string only — no binary is fetched
      scaleTemplateId: "tmpl-9",
      bpcmsEngineProfile: "bpcms-1",
      run_id: "run-1",
      input_hash: "a".repeat(64),
    });

    // 同一入力 → 同一マニフェスト（決定論）。
    const m2 = await (await get(bucket, "/api/v1/research/content/obs-content/reanalysis-manifest")).json();
    expect(m2).toEqual(m1);
  });

  it("bundle separates observed_at(data) from committed_at(envelope.time) and keeps value_origin", async () => {
    const bucket = new FakeR2Bucket();
    await seedContentWithObs(bucket);

    const b = (await (await get(bucket, "/api/v1/research/content/obs-content/bundle")).json()) as {
      observed_at: string; committed_at: string;
      measurements: Array<{ value_origin: string }>;
      facts: Array<unknown>;
    };
    expect(b.observed_at).toBe("2026-01-01T00:00:00Z");
    expect(b.committed_at).not.toBe(b.observed_at); // envelope.time は投稿時刻（now）で観測時刻と分離
    expect(b.committed_at.length).toBeGreaterThan(0);
    expect(b.measurements[0].value_origin).toBe("direct_observed");
    expect(b.facts).toHaveLength(1);
  });

  it("returns 404 for reanalysis-manifest of an unknown content", async () => {
    const bucket = new FakeR2Bucket();
    expect((await get(bucket, "/api/v1/research/content/ghost/reanalysis-manifest")).status).toBe(404);
  });
});
