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
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

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
});
