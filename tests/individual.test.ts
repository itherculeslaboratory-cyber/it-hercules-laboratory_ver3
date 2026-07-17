// C5 K1 個体系 TC (design-k1 §3 / V3-IND-01/02/04/12/13/15/21). Drives the real
// app through the auth gate (DEV_TOKEN bearer) and unit-tests the exported pure
// projections directly. Truth is append-only (put-if-absent 409); actor_id is
// force-stamped to the session principal (V3-AUT-17).
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId, ulid } from "@ihl/truth";
import {
  buildPedigree,
  projectName,
  projectCross,
  projectAuthenticity,
} from "../apps/api/src/individual-routes";
import { issueSessionToken } from "../apps/api/src/session";
import { DEV_TOKEN, FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function vec384(components: Record<number, number>): Float32Array {
  const v = new Float32Array(384);
  for (const [i, x] of Object.entries(components)) v[Number(i)] = x;
  return v;
}
async function seedEmbedding(bucket: FakeR2Bucket, captureId: string, vec: Float32Array) {
  const file = `embeddings/bin/${captureId}.bin`;
  await bucket.put(
    `embeddings/manifest/${captureId}.json`,
    JSON.stringify({ capture_id: captureId, embedding_dim: vec.length, embedding_file: file, vector_offset: 0 }),
  );
  await bucket.put(file, vec);
}

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function post(path: string, body: unknown, env: object, headers = AUTH_JSON) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
async function get(path: string, env: object) {
  return app.request(path, { headers: AUTH }, env);
}
async function createInd(env: object, body: Record<string, unknown> = {}): Promise<string> {
  const res = await post("/api/v1/individuals", body, env);
  return ((await res.json()) as { individual_id: string }).individual_id;
}

// Seed an obs-capture directly (valid envelope) so projections have observations.
function envOf(type: string, dataschema: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type,
    time: "2026-07-11T00:00:00Z",
    dataschema,
    provenance: { generator_kind: "human", actor_id: DEV_ACTOR },
    data,
  };
}

describe("IND-02 master(成長データ枠なし)+ subject_ref 解決", () => {
  it("作成→GET が成長データ枠を持たない", async () => {
    const { env } = ctx();
    const id = await createInd(env, { species: "Heteropteryx dilatata", actor_id: "attacker" });
    const body = (await (await get(`/api/v1/individuals/${id}`, env)).json()) as {
      master: Record<string, unknown>;
    };
    // actor_id force-stamped to session principal, not the forged "attacker".
    expect(body.master.actor_id).toBe(DEV_ACTOR);
    expect(body.master.species).toBe("Heteropteryx dilatata");
    // no growth枠: master carries only identity/label fields (schema additionalProperties:false).
    for (const forbidden of ["measurements", "weight", "growth", "size"]) {
      expect(forbidden in body.master).toBe(false);
    }
  });

  it("subject_ref 参照が実 observation record に解決", async () => {
    const { env } = ctx();
    const id = await createInd(env);
    const cap = await post(
      "/api/v1/observation/captures",
      { domain: "biology", subject_ref: `individual/${id}` },
      env,
    );
    const capId = ((await cap.json()) as { capture_id: string }).capture_id;
    const body = (await (await get(`/api/v1/individuals/${id}`, env)).json()) as {
      observations: { capture_id: string }[];
    };
    expect(body.observations.map((o) => o.capture_id)).toContain(capId);
  });

  it("存在しない個体 → 404", async () => {
    const { env } = ctx();
    expect((await get("/api/v1/individuals/nope", env)).status).toBe(404);
  });
});

describe("IND-01 血統ツリー(buildPedigree)", () => {
  it("多世代ツリーを再構成(A←B←C)", async () => {
    const { env } = ctx();
    const a = await createInd(env);
    const b = await createInd(env);
    const cc = await createInd(env);
    await post(`/api/v1/individuals/${a}/parents`, { parent_id: b, parent_role: "sire" }, env);
    await post(`/api/v1/individuals/${b}/parents`, { parent_id: cc, parent_role: "sire" }, env);
    const tree = (await (await get(`/api/v1/individuals/${a}/pedigree`, env)).json()) as {
      individual_id: string;
      parents: { individual_id: string; parent_role: string; known: boolean; parents: unknown[] }[];
    };
    expect(tree.individual_id).toBe(a);
    expect(tree.parents[0].individual_id).toBe(b);
    expect(tree.parents[0].parent_role).toBe("sire");
    const grand = tree.parents[0].parents as { individual_id: string; known: boolean }[];
    expect(grand[0].individual_id).toBe(cc);
    expect(grand[0].known).toBe(true);
  });

  it("欠損親(master 無し)→ known:false ノード", async () => {
    const { env, bucket } = ctx();
    const a = await createInd(env);
    await post(`/api/v1/individuals/${a}/parents`, { parent_id: "ghost", parent_role: "dam" }, env);
    const tree = await buildPedigree(new TruthStore(bucket), a);
    const dam = tree.parents.find((p) => p.parent_role === "dam");
    expect(dam?.individual_id).toBe("ghost");
    expect(dam?.known).toBe(false);
  });

  it("循環入力でも無限ループしない(P⇄Q)", async () => {
    const { env, bucket } = ctx();
    const p = await createInd(env);
    const q = await createInd(env);
    await post(`/api/v1/individuals/${p}/parents`, { parent_id: q, parent_role: "sire" }, env);
    await post(`/api/v1/individuals/${q}/parents`, { parent_id: p, parent_role: "sire" }, env);
    const tree = await buildPedigree(new TruthStore(bucket), p); // returns = terminates
    const back = tree.parents[0].parents[0]; // p seen again → circular leaf
    expect(back.circular).toBe(true);
  });

  it("同一 parent_role の二重登録 → 409(append-only)", async () => {
    const { env } = ctx();
    const a = await createInd(env);
    const b = await createInd(env);
    const first = await post(`/api/v1/individuals/${a}/parents`, { parent_id: b, parent_role: "sire" }, env);
    expect(first.status).toBe(201);
    const dup = await post(`/api/v1/individuals/${a}/parents`, { parent_id: b, parent_role: "sire" }, env);
    expect(dup.status).toBe(409);
  });
});

describe("IND-04 改名(projectName・当時名再現)", () => {
  const T1 = "2026-01-01T00:00:00Z";
  const T2 = "2026-02-01T00:00:00Z";
  const T3 = "2026-03-01T00:00:00Z";

  it("最新名 / at= で当時名を再現", async () => {
    const { env } = ctx();
    const id = await createInd(env);
    await post(`/api/v1/individuals/${id}/name`, { name: "n1", created_at: T1 }, env);
    await post(`/api/v1/individuals/${id}/name`, { name: "n2", created_at: T2 }, env);
    await post(`/api/v1/individuals/${id}/name`, { name: "n3", created_at: T3 }, env);
    const latest = (await (await get(`/api/v1/individuals/${id}/name`, env)).json()) as { name: string };
    expect(latest.name).toBe("n3");
    const at2 = (await (await get(`/api/v1/individuals/${id}/name?at=2026-02-15T00:00:00Z`, env)).json()) as { name: string };
    expect(at2.name).toBe("n2");
    const at1 = (await (await get(`/api/v1/individuals/${id}/name?at=2026-01-15T00:00:00Z`, env)).json()) as { name: string };
    expect(at1.name).toBe("n1");
  });

  it("同一 created_at の複数改名は envelope id(ULID)昇順で tie-break され、挿入順によらず決定論的に1つへ定まる", async () => {
    const { env, bucket } = ctx();
    const id = await createInd(env);
    const s = new TruthStore(bucket);
    const mk = (evId: string, name: string) => ({
      specversion: "1.0",
      id: evId,
      source: "apps/api",
      type: "ihl.ind.name_event.v1",
      time: T1,
      dataschema: "schemas/events/ind-name-event.schema.json",
      provenance: { generator_kind: "human", actor_id: DEV_ACTOR },
      data: { individual_id: id, name, actor_id: DEV_ACTOR, created_at: T1 },
    });
    // write the LEXICOGRAPHICALLY SMALLER envelope id LAST — if tie-break were
    // "insertion order" this would win, but projectName ties on envelope.id
    // ascending (a.ev.localeCompare(b.ev)), so the LARGER id must win regardless
    // of write order (projectName.ts comment: "name events share a ms").
    await s.putEventAt(`truth/ihl.ind.name_event.v1/${id}-k2.json`, mk("01ZZZZZZZZZZZZZZZZZZZZZZZZ", "large-id-name"));
    await s.putEventAt(`truth/ihl.ind.name_event.v1/${id}-k1.json`, mk("01AAAAAAAAAAAAAAAAAAAAAAAA", "small-id-name"));
    expect(await projectName(s, id)).toBe("large-id-name");
    expect(await projectName(s, id, T1)).toBe("large-id-name"); // at=T1 includes both (created_at <= at)
  });

  it("brand_template active=false 後も過去 name_event は再現できる", async () => {
    const { env, bucket } = ctx();
    const id = await createInd(env);
    await post(`/api/v1/individuals/${id}/name`, { name: "branded", created_at: T1, brand_template_id: "BT1" }, env);
    // logical delete of the brand = a NEW record with active:false (no UPDATE/DELETE).
    const del = await post("/api/v1/brand-templates", { brand_template_id: "BT1", pattern: "p", active: false }, env);
    expect(del.status).toBe(201);
    // past name still reproducible after the brand is deactivated.
    expect(await projectName(new TruthStore(bucket), id, T1)).toBe("branded");
  });
});

describe("IND-12 交配結果(projectCross・決定論)", () => {
  async function seedCross(env: object) {
    const pa = await createInd(env);
    const kids = [] as string[];
    for (let i = 0; i < 4; i++) kids.push(await createInd(env));
    for (const k of kids) {
      await post(`/api/v1/individuals/${k}/parents`, { parent_id: pa, parent_role: "sire" }, env);
    }
    const life = async (id: string, kind: string, detail?: unknown) =>
      post(`/api/v1/individuals/${id}/life-events`, { kind, at: "2026-04-01T00:00:00Z", detail }, env);
    await life(kids[0], "death");
    await life(kids[1], "eclosion", { success: true });
    await life(kids[2], "eclosion", { success: false });
    await life(kids[3], "birth");
    return pa;
  }

  it("死亡率/完品率/羽化不全率を決定論計算", async () => {
    const { env } = ctx();
    const pa = await seedCross(env);
    const r = (await (await get(`/api/v1/individuals/${pa}/cross`, env)).json()) as {
      cohort_size: number;
      rates: Record<string, number | null>;
    };
    expect(r.cohort_size).toBe(4);
    expect(r.rates.mortality).toBe(0.25);
    expect(r.rates.completion).toBe(0.25); // (2 eclosions - 1 failure)/4
    expect(r.rates.eclosion_failure).toBe(0.25);
    expect(r.rates.survival).toBe(0.75);
    expect(r.rates.hatch_rate).toBe(0.25);
    expect(r.rates.sex_ratio).toBeNull();
  });

  it("?metric= で率カードを差し替え・二度呼んで同値(決定論)", async () => {
    const { env, bucket } = ctx();
    const pa = await seedCross(env);
    const card = (await (await get(`/api/v1/individuals/${pa}/cross?metric=mortality`, env)).json()) as {
      metric: string;
      value: number;
    };
    expect(card).toEqual({ individual_id: pa, metric: "mortality", value: 0.25 });
    const s = new TruthStore(bucket);
    expect(await projectCross(s, pa, "mortality")).toEqual(await projectCross(s, pa, "mortality"));
  });

  it("ホーム直接不可: 個体経由でない /cross は無い(404)", async () => {
    const { env } = ctx();
    expect((await get("/api/v1/cross", env)).status).toBe(404);
  });
});

describe("IND-13 個体詳細(6 文化 + timeline を 1 レスポンスに集約)", () => {
  it("6 文化ブロック + timeline を返す", async () => {
    const { env } = ctx();
    const id = await createInd(env);
    await post(`/api/v1/individuals/${id}/life-events`, { kind: "birth", at: "2026-01-01T00:00:00Z" }, env);
    await post(`/api/v1/individuals/${id}/life-events`, { kind: "death", at: "2026-05-01T00:00:00Z" }, env);
    const body = (await (await get(`/api/v1/individuals/${id}`, env)).json()) as Record<string, unknown>;
    for (const key of ["timeline", "observations", "schedules", "templates", "data_sources", "market_offers", "improvements"]) {
      expect(key in body).toBe(true);
    }
    const tl = body.timeline as { kind: string; at: string }[];
    expect(tl.map((e) => e.kind)).toEqual(["birth", "death"]); // sorted by at
  });
});

describe("IND-15 名刺(bio-card / qr-batch)", () => {
  it("bio-card: QR 中身 = 個体 URL", async () => {
    const { env } = ctx();
    const id = await createInd(env, { species: "Extatosoma tiaratum" });
    const card = (await (await get(`/api/v1/individuals/${id}/bio-card`, env)).json()) as {
      species: string;
      qr_url: string;
    };
    expect(card.species).toBe("Extatosoma tiaratum");
    expect(card.qr_url).toBe(`/individuals/${id}`);
  });

  it("qr-batch: {100,500,1000} のみ受理・各 URL は個体 URL 形", async () => {
    const { env } = ctx();
    const ok = await post("/api/v1/individuals/qr-batch", { count: 100 }, env);
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { count: number; urls: string[] };
    expect(body.count).toBe(100);
    expect(body.urls).toHaveLength(100);
    expect(body.urls.every((u) => u.startsWith("/individuals/"))).toBe(true);
    const bad = await post("/api/v1/individuals/qr-batch", { count: 7 }, env);
    expect(bad.status).toBe(400);
  });
});

describe("IND-21 真正性(projectAuthenticity)", () => {
  it("画像 hash + event 連続性で continuity_score=1・登録数vs実在数照合", async () => {
    const { env, bucket } = ctx();
    const id = await createInd(env);
    const s = new TruthStore(bucket);
    // two captures, monotone growing weight, each with a sha256'd photo.
    // capId is deterministically ordered (cap0<cap1) so the growth series is stable.
    for (const [i, w] of [[0, 10], [1, 20]] as const) {
      const capId = `cap${i}`;
      await s.putEventAt(
        `truth/ihl.obs.capture.v1/${capId}.json`,
        envOf("ihl.obs.capture.v1", "schemas/events/obs-capture.schema.json", {
          capture_id: capId,
          actor_id: DEV_ACTOR,
          domain: "biology",
          subject_ref: `individual/${id}`,
          measurements: [{ item: "weight", kind: "number", value: w }],
        }),
      );
      const photoId = ulid();
      await s.putEventAt(
        `truth/ihl.obs.photo.v1/${capId}-${photoId}.json`,
        envOf("ihl.obs.photo.v1", "schemas/events/obs-photo.schema.json", {
          photo_id: photoId,
          capture_id: capId,
          actor_id: DEV_ACTOR,
          media_key: `media/photo/${photoId}`,
          content_type: "image/jpeg",
          size_bytes: 123,
          sha256: "a".repeat(64),
        }),
      );
    }
    await post(`/api/v1/individuals/${id}/life-events`, { kind: "birth", at: "2026-01-01T00:00:00Z" }, env);
    const auth = await projectAuthenticity(s, id);
    expect(auth!.continuity_score).toBe(1);
    expect(auth!.image_chain).toEqual({ photos: 2, with_sha256: 2, intact: true });
    expect(auth!.growth_monotonic).toBe(true);
    expect(auth!.registration.registered_events).toBe(1);
    expect(auth!.registration.evidenced_observations).toBe(2);
  });

  it("血統矛盾検知: self-parent を lineage_conflicts に載せる", async () => {
    const { env, bucket } = ctx();
    const id = await createInd(env);
    // ponytail: listing-text conflict is a later 波 (mkt-listing carries no lineage);
    // self-parent is a genuine blood-Truth contradiction detectable now.
    await post(`/api/v1/individuals/${id}/parents`, { parent_id: id, parent_role: "sire" }, env);
    const auth = await projectAuthenticity(new TruthStore(bucket), id);
    expect(auth!.lineage_conflicts.some((cf) => cf.type === "self_parent")).toBe(true);
  });
});

describe("V3-AIP-101 GET /individuals?q= (観測登録スライス1 F1 検索)", () => {
  it("q なしは本人の全件を返す", async () => {
    const { env } = ctx();
    await createInd(env, { local_label_text: "DHH-24-017", species: "Dynastes hercules" });
    await createInd(env, { local_label_text: "DHH-24-021", species: "Dynastes hercules" });
    const body = (await (await get("/api/v1/individuals", env)).json()) as {
      individuals: { individual_id: string; label: string; species: string | null }[];
    };
    expect(body.individuals).toHaveLength(2);
    expect(body.individuals.every((i) => i.species === "Dynastes hercules")).toBe(true);
  });

  it("q は local_label_text/species の部分一致(大小無視)", async () => {
    const { env } = ctx();
    const hit = await createInd(env, { local_label_text: "DHH-24-017", species: "Dynastes hercules" });
    await createInd(env, { local_label_text: "CL-26-002", species: "Extatosoma tiaratum" });
    const body = (await (await get("/api/v1/individuals?q=dhh-24", env)).json()) as {
      individuals: { individual_id: string; label: string }[];
    };
    expect(body.individuals.map((i) => i.individual_id)).toEqual([hit]);
    expect(body.individuals[0].label).toBe("DHH-24-017");
  });

  it("0件はそのまま空配列(行き止まりの検知はクライアント側)", async () => {
    const { env } = ctx();
    await createInd(env, { local_label_text: "DHH-24-017" });
    const body = (await (await get("/api/v1/individuals?q=ムナカタ", env)).json()) as { individuals: unknown[] };
    expect(body.individuals).toEqual([]);
  });

  it("最終観測(last_capture_at・代表計測値)を返す(磨き直し fix#2)", async () => {
    const { env, bucket } = ctx();
    const id = await createInd(env, { local_label_text: "DHH-24-017", species: "Dynastes hercules" });
    const s = new TruthStore(bucket);
    await s.putEventAt(
      `truth/ihl.obs.capture.v1/${ulid()}.json`,
      envOf("ihl.obs.capture.v1", "schemas/events/obs-capture.schema.json", {
        capture_id: ulid(),
        actor_id: DEV_ACTOR,
        domain: "biology",
        subject_ref: `individual/${id}`,
        measurements: [{ item: "weight", kind: "number", value: 82.5, unit: "g", value_origin: "direct_observed" }],
      }),
    );
    const body = (await (await get("/api/v1/individuals", env)).json()) as {
      individuals: { individual_id: string; last_capture_at: string | null; last_measurement_summary: string | null }[];
    };
    const row = body.individuals.find((i) => i.individual_id === id)!;
    expect(row.last_capture_at).toBe("2026-07-11T00:00:00Z");
    expect(row.last_measurement_summary).toBe("82.5g");
  });

  it("観測ゼロの個体は last_capture_at/last_measurement_summary が null", async () => {
    const { env } = ctx();
    const id = await createInd(env, { local_label_text: "DHH-24-020" });
    const body = (await (await get("/api/v1/individuals", env)).json()) as {
      individuals: { individual_id: string; last_capture_at: string | null; last_measurement_summary: string | null }[];
    };
    const row = body.individuals.find((i) => i.individual_id === id)!;
    expect(row.last_capture_at).toBeNull();
    expect(row.last_measurement_summary).toBeNull();
  });

  it("他 actor の個体は返さない(本人スコープ)", async () => {
    const { env, bucket } = ctx();
    const mine = await createInd(env, { local_label_text: "MINE" });
    // seed a second individual directly under a different actor_id (bypasses
    // the route's actor_id force-stamp, same technique as IND-21's fixtures).
    const s = new TruthStore(bucket);
    const otherId = ulid();
    await s.putEventAt(
      `truth/ihl.ind.master.v1/${otherId}.json`,
      envOf("ihl.ind.master.v1", "schemas/events/ind-master.schema.json", {
        individual_id: otherId,
        actor_id: "someone-else",
        local_label_text: "NOT-MINE",
        created_at: "2026-01-01T00:00:00Z",
      }),
    );
    const body = (await (await get("/api/v1/individuals", env)).json()) as {
      individuals: { individual_id: string }[];
    };
    expect(body.individuals.map((i) => i.individual_id)).toEqual([mine]);
  });

  // 検索スライスA(V3-AIP-101 obs-search) 拡張フィールド。
  it("latest_weight_g/latest_length_mm/capture_count を最新 capture から返す", async () => {
    const { env } = ctx();
    const id = await createInd(env, { local_label_text: "DHH-24-050", species: "Dynastes hercules" });
    await post(
      "/api/v1/observation/captures",
      {
        domain: "biology",
        subject_ref: `individual/${id}`,
        measurements: [
          { item: "weight", kind: "number", value: 90.2, unit: "g", value_origin: "direct_observed" },
          { item: "length", kind: "number", value: 65, unit: "mm", value_origin: "direct_observed" },
        ],
      },
      env,
    );
    const body = (await (await get("/api/v1/individuals", env)).json()) as {
      individuals: {
        individual_id: string;
        latest_weight_g: number | null;
        latest_length_mm: number | null;
        capture_count: number;
      }[];
    };
    const row = body.individuals.find((i) => i.individual_id === id)!;
    expect(row.latest_weight_g).toBe(90.2);
    expect(row.latest_length_mm).toBe(65);
    expect(row.capture_count).toBe(1);
  });

  it("capture_count はゼロ件の個体で 0、計測値は null", async () => {
    const { env } = ctx();
    const id = await createInd(env, { local_label_text: "DHH-24-051" });
    const body = (await (await get("/api/v1/individuals", env)).json()) as {
      individuals: { individual_id: string; capture_count: number; latest_weight_g: number | null }[];
    };
    const row = body.individuals.find((i) => i.individual_id === id)!;
    expect(row.capture_count).toBe(0);
    expect(row.latest_weight_g).toBeNull();
  });

  it("eclosion life-event の at を eclosion_at に返す", async () => {
    const { env } = ctx();
    const id = await createInd(env, { local_label_text: "DHH-24-052" });
    await post(`/api/v1/individuals/${id}/life-events`, { kind: "eclosion", at: "2026-06-01T00:00:00Z" }, env);
    const body = (await (await get("/api/v1/individuals", env)).json()) as {
      individuals: { individual_id: string; eclosion_at: string | null }[];
    };
    const row = body.individuals.find((i) => i.individual_id === id)!;
    expect(row.eclosion_at).toBe("2026-06-01T00:00:00Z");
  });

  it("thumbnail_path: 直近 capture に写真があれば URL、無ければ null", async () => {
    const { env } = ctx();
    const withPhoto = await createInd(env, { local_label_text: "DHH-24-053" });
    const cap = await post(
      "/api/v1/observation/captures",
      { domain: "biology", subject_ref: `individual/${withPhoto}` },
      env,
    );
    const captureId = ((await cap.json()) as { capture_id: string }).capture_id;
    const fd = new FormData();
    fd.append("capture_id", captureId);
    fd.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "p.png");
    const up = await app.request(
      "/api/v1/observation/upload",
      { method: "POST", headers: AUTH, body: fd },
      env,
    );
    const { photo_id } = (await up.json()) as { photo_id: string };

    const withoutPhoto = await createInd(env, { local_label_text: "DHH-24-054" });
    await post(
      "/api/v1/observation/captures",
      { domain: "biology", subject_ref: `individual/${withoutPhoto}` },
      env,
    );

    const body = (await (await get("/api/v1/individuals", env)).json()) as {
      individuals: { individual_id: string; thumbnail_path: string | null }[];
    };
    const rowWith = body.individuals.find((i) => i.individual_id === withPhoto)!;
    const rowWithout = body.individuals.find((i) => i.individual_id === withoutPhoto)!;
    expect(rowWith.thumbnail_path).toBe(`/api/v1/observation/${captureId}/thumbnail/${photo_id}`);
    expect(rowWithout.thumbnail_path).toBeNull();
  });
});

describe("V3-IND-14 個体一覧A1: species/stage/status フィルタ + sort/order", () => {
  it("life_status: 既定=larva、eclosion後=alive、pupa molt後=pupa、death後=dead、specimen後=specimen", async () => {
    const { env } = ctx();
    const larva = await createInd(env, { local_label_text: "LARVA" });
    const adult = await createInd(env, { local_label_text: "ADULT" });
    await post(`/api/v1/individuals/${adult}/life-events`, { kind: "eclosion", at: "2026-06-01T00:00:00Z" }, env);
    const pupa = await createInd(env, { local_label_text: "PUPA" });
    await post(`/api/v1/individuals/${pupa}/life-events`, { kind: "molt", at: "2026-06-01T00:00:00Z", detail: { to_stage: "pupa" } }, env);
    const dead = await createInd(env, { local_label_text: "DEAD" });
    await post(`/api/v1/individuals/${dead}/life-events`, { kind: "death", at: "2026-06-01T00:00:00Z" }, env);
    const specimen = await createInd(env, { local_label_text: "SPECIMEN" });
    await post(`/api/v1/individuals/${specimen}/life-events`, { kind: "death", at: "2026-06-01T00:00:00Z" }, env);
    await post(`/api/v1/individuals/${specimen}/life-events`, { kind: "specimen", at: "2026-06-02T00:00:00Z" }, env);

    const body = (await (await get("/api/v1/individuals", env)).json()) as {
      individuals: { individual_id: string; life_status: string }[];
    };
    const byId = new Map(body.individuals.map((i) => [i.individual_id, i.life_status]));
    expect(byId.get(larva)).toBe("larva");
    expect(byId.get(adult)).toBe("alive");
    expect(byId.get(pupa)).toBe("pupa");
    expect(byId.get(dead)).toBe("dead");
    expect(byId.get(specimen)).toBe("specimen");
  });

  it("survival_correction (最新) は死亡を打ち消し生存側の判定へ戻す", async () => {
    const { env } = ctx();
    const id = await createInd(env, {});
    await post(`/api/v1/individuals/${id}/life-events`, { kind: "death", at: "2026-06-01T00:00:00Z" }, env);
    await post(`/api/v1/individuals/${id}/life-events`, { kind: "survival_correction", at: "2026-06-02T00:00:00Z" }, env);
    const body = (await (await get("/api/v1/individuals", env)).json()) as {
      individuals: { individual_id: string; life_status: string }[];
    };
    expect(body.individuals.find((i) => i.individual_id === id)!.life_status).toBe("larva");
  });

  it("?species= は完全一致(大小無視)、?stage= はコード値完全一致", async () => {
    const { env } = ctx();
    const herc = await createInd(env, { local_label_text: "H1", species: "Dynastes hercules" });
    await createInd(env, { local_label_text: "H2", species: "Extatosoma tiaratum" });
    const stagedId = await createInd(env, { local_label_text: "H3", species: "Dynastes hercules" });
    await post(`/api/v1/individuals/${stagedId}/life-events`, { kind: "molt", at: "2026-06-01T00:00:00Z", detail: { to_stage: "third_late" } }, env);

    const bySpecies = (await (await get("/api/v1/individuals?species=dynastes%20hercules", env)).json()) as {
      individuals: { individual_id: string }[];
    };
    expect(bySpecies.individuals.map((i) => i.individual_id).sort()).toEqual([herc, stagedId].sort());

    const byStage = (await (await get("/api/v1/individuals?stage=third_late", env)).json()) as {
      individuals: { individual_id: string }[];
    };
    expect(byStage.individuals.map((i) => i.individual_id)).toEqual([stagedId]);
  });

  it("?status=dead は死亡個体のみ返す(生存個体を除外)", async () => {
    const { env } = ctx();
    const alive = await createInd(env, { local_label_text: "ALIVE" });
    const dead = await createInd(env, { local_label_text: "DEAD" });
    await post(`/api/v1/individuals/${dead}/life-events`, { kind: "death", at: "2026-06-01T00:00:00Z" }, env);
    const body = (await (await get("/api/v1/individuals?status=dead", env)).json()) as {
      individuals: { individual_id: string }[];
    };
    expect(body.individuals.map((i) => i.individual_id)).toEqual([dead]);
    void alive;
  });

  it("?sort=latest_weight_g&order=asc は体重昇順、null は方向によらず末尾", async () => {
    const { env } = ctx();
    const heavy = await createInd(env, { local_label_text: "HEAVY" });
    await post("/api/v1/observation/captures", { domain: "biology", subject_ref: `individual/${heavy}`, measurements: [{ item: "weight", kind: "number", value: 90, unit: "g" }] }, env);
    const light = await createInd(env, { local_label_text: "LIGHT" });
    await post("/api/v1/observation/captures", { domain: "biology", subject_ref: `individual/${light}`, measurements: [{ item: "weight", kind: "number", value: 30, unit: "g" }] }, env);
    const noWeight = await createInd(env, { local_label_text: "NO-WEIGHT" });

    const asc = (await (await get("/api/v1/individuals?sort=latest_weight_g&order=asc", env)).json()) as {
      individuals: { individual_id: string }[];
    };
    expect(asc.individuals.map((i) => i.individual_id)).toEqual([light, heavy, noWeight]);

    const desc = (await (await get("/api/v1/individuals?sort=latest_weight_g", env)).json()) as {
      individuals: { individual_id: string }[];
    };
    expect(desc.individuals.map((i) => i.individual_id)).toEqual([heavy, light, noWeight]);
  });

  it("次の予定(next_observation_at)は直近 schedule から返り、未知の sort 値は既定(individual_id 昇順)へフォールバック", async () => {
    const { env } = ctx();
    const id = await createInd(env, {});
    const res = await post("/api/v1/observation/schedule", { individual_id: id, stage: "first_to_second" }, env);
    expect(res.status).toBe(201);
    const body = (await (await get("/api/v1/individuals?sort=not_a_real_field", env)).json()) as {
      individuals: { individual_id: string; next_observation_at: string | null }[];
    };
    const row = body.individuals.find((i) => i.individual_id === id)!;
    expect(row.next_observation_at).not.toBeNull();
    expect(body.individuals.map((i) => i.individual_id)).toEqual(
      body.individuals.map((i) => i.individual_id).slice().sort(),
    );
  });
});

describe("V3-OBS-73 データエクスポート二層(facts.csv / photos.csv)", () => {
  it("facts.csv: 本人個体の構造化事実を返し、他 actor の個体は含まない", async () => {
    const { env, bucket } = ctx();
    const id = await createInd(env, { local_label_text: "DHH-24-090", species: "Dynastes hercules" });
    const s = new TruthStore(bucket);
    const otherId = ulid();
    await s.putEventAt(
      `truth/ihl.ind.master.v1/${otherId}.json`,
      envOf("ihl.ind.master.v1", "schemas/events/ind-master.schema.json", {
        individual_id: otherId,
        actor_id: "someone-else",
        created_at: "2026-01-01T00:00:00Z",
      }),
    );
    const res = await get("/api/v1/export/facts.csv", env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv.split("\r\n")[0]).toBe("individual_id,label,species,name,birth_or_hatch_date,source_type,created_at");
    expect(csv).toContain(id);
    expect(csv).toContain("DHH-24-090");
    expect(csv).not.toContain(otherId);
  });

  it("photos.csv: 本人個体の写真参照のみを含み、バイナリ本体は含まない(media_key/sha256のみ)", async () => {
    const { env } = ctx();
    const id = await createInd(env, { local_label_text: "DHH-24-091" });
    const cap = await post("/api/v1/observation/captures", { domain: "biology", subject_ref: `individual/${id}` }, env);
    const captureId = ((await cap.json()) as { capture_id: string }).capture_id;
    const fd = new FormData();
    fd.append("capture_id", captureId);
    fd.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "p.png");
    const up = await app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fd }, env);
    const { photo_id } = (await up.json()) as { photo_id: string };

    const res = await get("/api/v1/export/photos.csv", env);
    const csv = await res.text();
    const header = csv.split("\r\n")[0];
    expect(header).toBe("photo_id,capture_id,individual_id,media_key,content_type,size_bytes,sha256");
    expect(csv).toContain(photo_id);
    expect(csv).toContain(id);
    // no raw image bytes in a text/csv payload — just refs.
    expect(csv).not.toMatch(/[\x00-\x08]/); // no binary control bytes leaked through
  });

  it("空データでもヘッダのみの CSV を返す(空状態でも壊れない)", async () => {
    const { env } = ctx();
    const facts = await (await get("/api/v1/export/facts.csv", env)).text();
    expect(facts).toBe("individual_id,label,species,name,birth_or_hatch_date,source_type,created_at\r\n");
    const photos = await (await get("/api/v1/export/photos.csv", env)).text();
    expect(photos).toBe("photo_id,capture_id,individual_id,media_key,content_type,size_bytes,sha256\r\n");
  });
});

describe("V3-AIP-101 個体詳細スライスA: GET /individuals/{id}/profile", () => {
  async function capture(env: object, individualId: string, weight: number) {
    const cap = await post(
      "/api/v1/observation/captures",
      {
        domain: "biology",
        subject_ref: `individual/${individualId}`,
        measurements: [{ item: "weight", kind: "number", value: weight, unit: "g" }],
      },
      env,
    );
    return ((await cap.json()) as { capture_id: string }).capture_id;
  }

  it("親・きょうだい・子・観測・タイムラインを1レスポンスに集約", async () => {
    const { env } = ctx();
    const sire = await createInd(env, { local_label_text: "父" });
    const dam = await createInd(env, { local_label_text: "母" });
    await capture(env, sire, 145);
    await capture(env, dam, 130);

    const a = await createInd(env, { local_label_text: "子A" }); // 生存・羽化
    const b = await createInd(env, { local_label_text: "子B" }); // 死亡
    const cOther = await createInd(env); // 片親のみ(半きょうだい扱い・siblings対象外)
    for (const kid of [a, b]) {
      await post(`/api/v1/individuals/${kid}/parents`, { parent_id: sire, parent_role: "sire" }, env);
      await post(`/api/v1/individuals/${kid}/parents`, { parent_id: dam, parent_role: "dam" }, env);
    }
    await post(`/api/v1/individuals/${cOther}/parents`, { parent_id: sire, parent_role: "sire" }, env);

    await post(`/api/v1/individuals/${a}/life-events`, { kind: "molt", at: "2026-02-01T00:00:00Z", detail: { to_stage: "third_late" } }, env);
    await post(`/api/v1/individuals/${a}/life-events`, { kind: "eclosion", at: "2026-03-01T00:00:00Z" }, env);
    await capture(env, a, 82.5);
    await post(`/api/v1/individuals/${b}/life-events`, { kind: "death", at: "2026-02-05T00:00:00Z" }, env);
    await capture(env, b, 70);

    const body = (await (await get(`/api/v1/individuals/${a}/profile`, env)).json()) as {
      species: string | null;
      stage: string | null;
      status: string;
      parents: { sire?: { individual_id: string; label: string }; dam?: { individual_id: string; label: string } };
      siblings: { individual_id: string; label: string; dead: boolean; eclosed: boolean }[];
      children: unknown[];
      observations: { capture_id: string; time: string }[];
      life_events: { kind: string }[];
      parent_observations: { sire: { capture_id: string }[]; dam: { capture_id: string }[] };
      cohort_observations: { individual_id: string; weight_g: number | null }[];
    };

    expect(body.stage).toBe("third_late");
    expect(body.status).toBe("alive");
    expect(body.parents.sire?.individual_id).toBe(sire);
    expect(body.parents.sire?.label).toBe("父");
    expect(body.parents.dam?.individual_id).toBe(dam);
    expect(body.children).toEqual([]);
    expect(body.observations).toHaveLength(1);
    expect(body.observations[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T/); // グラフX軸用のenvelope.time合成
    expect(body.life_events.map((e) => e.kind)).toEqual(["molt", "eclosion"]);
    expect(body.parent_observations.sire).toHaveLength(1);
    expect(body.parent_observations.dam).toHaveLength(1);

    // siblings: 両親一致の b のみ(半きょうだい cOther は含まれない)。
    expect(body.siblings.map((s) => s.individual_id).sort()).toEqual([b]);
    const sibB = body.siblings.find((s) => s.individual_id === b)!;
    expect(sibB.dead).toBe(true);
    expect(sibB.eclosed).toBe(false);
    expect(body.cohort_observations.some((o) => o.individual_id === b && o.weight_g === 70)).toBe(true);
  });

  it("親カーブ欠損(購入個体): parents={}・parent_observations は空配列", async () => {
    const { env } = ctx();
    const id = await createInd(env, { local_label_text: "購入個体" });
    const body = (await (await get(`/api/v1/individuals/${id}/profile`, env)).json()) as {
      parents: Record<string, unknown>;
      parent_observations: { sire: unknown[]; dam: unknown[] };
      siblings: unknown[];
    };
    expect(body.parents).toEqual({});
    expect(body.parent_observations).toEqual({ sire: [], dam: [] });
    expect(body.siblings).toEqual([]);
  });

  it("survival_correction: 直近の訂正が death より新しければ alive に復元(append-only)", async () => {
    const { env } = ctx();
    const id = await createInd(env);
    await post(`/api/v1/individuals/${id}/life-events`, { kind: "death", at: "2026-02-05T00:00:00Z" }, env);
    let body = (await (await get(`/api/v1/individuals/${id}/profile`, env)).json()) as { status: string };
    expect(body.status).toBe("deceased");
    await post(`/api/v1/individuals/${id}/life-events`, { kind: "survival_correction", at: "2026-02-06T00:00:00Z" }, env);
    body = (await (await get(`/api/v1/individuals/${id}/profile`, env)).json()) as { status: string };
    expect(body.status).toBe("alive");
  });

  it("schedule: 次の目安(中立表示専用)を返す・未登録は null", async () => {
    const { env } = ctx();
    const id = await createInd(env);
    let body = (await (await get(`/api/v1/individuals/${id}/profile`, env)).json()) as {
      schedule: { next_observation_at: string } | null;
    };
    expect(body.schedule).toBeNull();
    await post(
      "/api/v1/observation/schedule",
      {
        individual_id: id,
        stage: "unspecified",
        from: "2026-07-01T00:00:00Z",
        template: { stage_interval_days: { unspecified: 45 } },
      },
      env,
    );
    body = (await (await get(`/api/v1/individuals/${id}/profile`, env)).json()) as {
      schedule: { next_observation_at: string } | null;
    };
    expect(body.schedule?.next_observation_at).toBe("2026-08-15T00:00:00.000Z");
  });

  it("未知の id は 404", async () => {
    const { env } = ctx();
    expect((await get("/api/v1/individuals/ghost/profile", env)).status).toBe(404);
  });
});

describe("V3-UIX-68 GET /users/{actor}/individuals(透明性の文化・他者の作品を全て見れる公開版)", () => {
  it("他 actor の作品一覧を本人用と同じ投影で返す(ログイン済みなら誰でも閲覧可)", async () => {
    const { env } = ctx();
    const aliceAuth = { Authorization: `Bearer ${await issueSessionToken("alice", SESSION_SECRET)}` };
    await app.request(
      "/api/v1/individuals",
      { method: "POST", headers: { ...aliceAuth, "content-type": "application/json" }, body: JSON.stringify({ local_label_text: "DHH-24-999", species: "Dynastes hercules" }) },
      env,
    );
    // bob(別 actor・自分は何も作っていない)が alice の公開ページを開く。
    const bobAuth = { Authorization: `Bearer ${await issueSessionToken("bob", SESSION_SECRET)}` };
    const res = await app.request("/api/v1/users/alice/individuals", { headers: bobAuth }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { individuals: { label: string }[] };
    expect(body.individuals.map((i) => i.label)).toEqual(["DHH-24-999"]);
    // bob 自身の一覧(本人スコープ)は空のまま — 他者閲覧が自分のスコープを汚染しない。
    const bobOwn = (await (await app.request("/api/v1/individuals", { headers: bobAuth }, env)).json()) as {
      individuals: unknown[];
    };
    expect(bobOwn.individuals).toEqual([]);
  });
});

describe("V3-UIX-82 GET /individuals/{id}/graph(血縁+画像類似の近さグラフ・決定論)", () => {
  it("血縁(親)と画像類似(cosine上位)を1つのnodes/edgesに統合する", async () => {
    const { env, bucket } = ctx();
    const child = await createInd(env, { local_label_text: "child" });
    const parent = await createInd(env, { local_label_text: "parent" });
    await post(`/api/v1/individuals/${child}/parents`, { parent_id: parent, parent_role: "sire" }, env);

    // child と similarKin は embedding がほぼ同方向(cos≈1)、遠い個体は直交(cos=0)。
    const s = new TruthStore(bucket);
    const capOf = async (individualId: string, vec: Float32Array) => {
      const capId = ulid();
      await s.putEventAt(
        `truth/ihl.obs.capture.v1/${capId}.json`,
        envOf("ihl.obs.capture.v1", "schemas/events/obs-capture.schema.json", {
          capture_id: capId,
          actor_id: DEV_ACTOR,
          domain: "biology",
          subject_ref: `individual/${individualId}`,
        }),
      );
      await seedEmbedding(bucket, capId, vec);
    };
    const similarKin = await createInd(env, { local_label_text: "similar" });
    const farOne = await createInd(env, { local_label_text: "far" });
    await capOf(child, vec384({ 0: 1 }));
    await capOf(similarKin, vec384({ 0: 1 }));
    await capOf(farOne, vec384({ 1: 1 }));

    const res = await get(`/api/v1/individuals/${child}/graph?top_k=1`, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      individual_id: string;
      nodes: { individual_id: string; kind: string; relation?: string }[];
      edges: { from: string; to: string; kind: string; weight: number }[];
    };
    expect(body.individual_id).toBe(child);
    expect(body.nodes.find((n) => n.individual_id === child)?.kind).toBe("self");
    expect(body.nodes.find((n) => n.individual_id === parent)?.kind).toBe("blood");
    expect(body.edges.some((e) => e.kind === "blood" && e.from === child && e.to === parent)).toBe(true);
    // top_k=1 なので similar は最も近い similarKin(cos≈1)のみ、farOne(cos=0)は入らない。
    expect(body.nodes.find((n) => n.individual_id === similarKin)?.kind).toBe("similar");
    expect(body.nodes.some((n) => n.individual_id === farOne)).toBe(false);
    const simEdge = body.edges.find((e) => e.kind === "similar" && e.to === similarKin)!;
    expect(simEdge.weight).toBeCloseTo(1, 5);
  });

  it("埋め込み無し個体は similar 空・血縁ノードのみ返す(壊れない)", async () => {
    const { env } = ctx();
    const id = await createInd(env, { local_label_text: "no-embedding" });
    const res = await get(`/api/v1/individuals/${id}/graph`, env);
    const body = (await res.json()) as { nodes: { individual_id: string; kind: string }[]; edges: unknown[] };
    expect(body.nodes).toEqual([{ individual_id: id, label: id, kind: "self" }]);
    expect(body.edges).toEqual([]);
  });
});
