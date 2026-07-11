// PPR-13 canonical mapping / category（design-k5 §4）。mapping_event は Q番号↔専門DB 対応の
// append-only（qid__target_db 合成キー・同一対応の再 put=409）。target_db は DOMAIN_API_MAP
// オフライン対応表で domain 妥当性検証（外部 API 実クエリは §6 人間ゲート・ここは表を読むだけ）。
// category は domain 必須の親子木で append し、categoryTree 投影が木を組む。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";
import { DOMAIN_API_MAP } from "../apps/api/src/research-constants";

function post(bucket: FakeR2Bucket, path: string, body: unknown): Promise<Response> {
  return app.request(path, { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, makeEnv(bucket));
}
function get(bucket: FakeR2Bucket, path: string): Promise<Response> {
  return app.request(path, { method: "GET", headers: AUTH_HEADERS }, makeEnv(bucket));
}

describe("PPR-13 canonical mapping append-only + DOMAIN_API_MAP validation", () => {
  it("DOMAIN_API_MAP constant carries the frozen correspondence table", () => {
    expect(DOMAIN_API_MAP.biology).toContain("GBIF");
    expect(DOMAIN_API_MAP.medicine).toContain("ICD-11");
    expect(DOMAIN_API_MAP.ai).toContain("HuggingFace");
  });

  it("valid mapping inserts; identical qid+target_db re-put returns 409 (append-only)", async () => {
    const bucket = new FakeR2Bucket();
    const body = { wikidata_qid: "Q12345", target_db: "GBIF", target_id: "5216933", domain: "biology" };
    const a = await post(bucket, "/api/v1/research/canonical/mapping", body);
    expect(a.status).toBe(201);
    expect((await a.json()).mapping_id).toBe("Q12345__GBIF");

    const b = await post(bucket, "/api/v1/research/canonical/mapping", body);
    expect(b.status).toBe(409); // same qid__target_db → put-if-absent 409

    // a different target_db for the same qid is a distinct correspondence → 201.
    const c = await post(bucket, "/api/v1/research/canonical/mapping", {
      wikidata_qid: "Q12345", target_db: "NCBI", target_id: "8342", domain: "biology",
    });
    expect(c.status).toBe(201);
  });

  it("target_db outside DOMAIN_API_MAP[domain] is rejected 400 (offline table read)", async () => {
    const bucket = new FakeR2Bucket();
    // GBIF is not a medicine target_db → rejected.
    const res = await post(bucket, "/api/v1/research/canonical/mapping", {
      wikidata_qid: "Q1", target_db: "GBIF", target_id: "x", domain: "medicine",
    });
    expect(res.status).toBe(400);
  });

  it("GET /research/canonical/mapping/:qid projects all target_dbs for that qid", async () => {
    const bucket = new FakeR2Bucket();
    await post(bucket, "/api/v1/research/canonical/mapping", { wikidata_qid: "Q7", target_db: "GBIF", target_id: "a", domain: "biology" });
    await post(bucket, "/api/v1/research/canonical/mapping", { wikidata_qid: "Q7", target_db: "NCBI", target_id: "b", domain: "biology" });
    const res = (await (await get(bucket, "/api/v1/research/canonical/mapping/Q7")).json()) as {
      mappings: Array<{ target_db: string }>;
    };
    expect(res.mappings.map((m) => m.target_db)).toEqual(["GBIF", "NCBI"]); // target_db 昇順決定論
  });
});

describe("PPR-13 category parent-child tree (domain required)", () => {
  it("rejects a category with no domain (subspecies dedup guard)", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/categories", { category_id: "c-x", label: "Snakes" });
    expect(res.status).toBe(400);
  });

  it("appends root + child and categoryTree nests the child under the root", async () => {
    const bucket = new FakeR2Bucket();
    const root = await post(bucket, "/api/v1/research/categories", { category_id: "cat-root", label: "Biology", domain: "biology" });
    expect(root.status).toBe(201);
    const child = await post(bucket, "/api/v1/research/categories", {
      category_id: "cat-child", label: "Serpentes", domain: "biology", parent_category_id: "cat-root",
    });
    expect(child.status).toBe(201);

    const tree = (await (await get(bucket, "/api/v1/research/categories")).json()) as {
      tree: Array<{ category_id: string; children: Array<{ category_id: string }> }>;
    };
    expect(tree.tree.map((n) => n.category_id)).toEqual(["cat-root"]); // only root at top level
    expect(tree.tree[0].children.map((n) => n.category_id)).toEqual(["cat-child"]);
  });

  it("same category_id re-put returns 409 (append-only)", async () => {
    const bucket = new FakeR2Bucket();
    await post(bucket, "/api/v1/research/categories", { category_id: "dup", label: "L", domain: "biology" });
    const again = await post(bucket, "/api/v1/research/categories", { category_id: "dup", label: "L2", domain: "biology" });
    expect(again.status).toBe(409);
  });
});
