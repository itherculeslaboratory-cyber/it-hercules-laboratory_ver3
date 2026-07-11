// C5 K1 target navigator TC (design-k1 §3 tests/targets) — OBS-02/03.
// Three deterministic paths to a QID: name substring / yes-no binary search
// (7〜12 問収束) / tree navigation. The search only PROPOSES candidates — it
// never confirms a species (確定は commit の user ゲート; AI は書けない).
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { DEV_TOKEN, makeEnv } from "./helpers";
import { NAVIGATOR_TARGET_QUESTIONS } from "../apps/api/src/observation-constants";

const AUTH_JSON = { Authorization: `Bearer ${DEV_TOKEN}`, "content-type": "application/json" };
async function post(path: string, body: unknown, headers = AUTH_JSON) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, makeEnv());
}
async function get(path: string) {
  return app.request(path, { headers: { Authorization: `Bearer ${DEV_TOKEN}` } }, makeEnv());
}

describe("OBS-02 target catalog", () => {
  it("catalog is a family→genus→species tree with QIDs", async () => {
    const res = await get("/api/v1/observation/targets/catalog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      size: number;
      question_bounds: { min: number; max: number };
      families: { family: string; genera: { genus: string; species: { qid: string }[] }[] }[];
    };
    expect(body.size).toBeGreaterThan(0);
    expect(body.question_bounds).toEqual(NAVIGATOR_TARGET_QUESTIONS);
    expect(body.families[0].genera[0].species[0].qid).toMatch(/^Q\d+$/);
  });
});

describe("OBS-02 name substring path", () => {
  it("returns candidates with QID + taxonomy, and never a confirmed flag", async () => {
    const res = await post("/api/v1/observation/targets/search", { mode: "name", query: "Genus01 species3" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: { qid: string; scientific_name: string; taxonomy: { family: string } }[] };
    expect(body.candidates.length).toBeGreaterThanOrEqual(1);
    const hit = body.candidates.find((c) => c.scientific_name === "Genus01 species3")!;
    expect(hit.qid).toMatch(/^Q\d+$/);
    expect(hit.taxonomy.family).toBe("Family0");
    // 候補提示と確定分離: no confirmation field is ever emitted by search.
    expect(JSON.stringify(body)).not.toContain("confirmed");
  });

  it("empty query → 400", async () => {
    const res = await post("/api/v1/observation/targets/search", { mode: "name", query: "" });
    expect(res.status).toBe(400);
  });
});

describe("OBS-02 yes-no binary search (7〜12 問収束)", () => {
  it("converges to a single QID within the question bound", async () => {
    // catalog size N; the client replays the answers that isolate a chosen leaf.
    const cat = (await (await get("/api/v1/observation/targets/catalog")).json()) as { size: number };
    const N = cat.size;
    const T = 100; // target leaf index
    let lo = 0;
    let hi = N;
    const answers: boolean[] = [];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const a = T >= mid;
      answers.push(a);
      if (a) lo = mid;
      else hi = mid;
    }
    const res = await post("/api/v1/observation/targets/search", { mode: "yesno", answers });
    const body = (await res.json()) as { resolved: { qid: string; taxonomy: object } | null; questions_asked: number };
    expect(body.resolved).not.toBeNull();
    expect(body.resolved!.qid).toBe(`Q${9000000 + T}`);
    expect(body.questions_asked).toBeGreaterThanOrEqual(NAVIGATOR_TARGET_QUESTIONS.min);
    expect(body.questions_asked).toBeLessThanOrEqual(NAVIGATOR_TARGET_QUESTIONS.max);
  });

  it("an incomplete answer set returns the next question, not a resolution", async () => {
    const res = await post("/api/v1/observation/targets/search", { mode: "yesno", answers: [true, false] });
    const body = (await res.json()) as { resolved: unknown; question: { pivot: string; remaining: number } };
    expect(body.resolved).toBeNull();
    expect(body.question.pivot).toMatch(/^Genus/);
    expect(body.question.remaining).toBeGreaterThan(1);
  });
});

describe("OBS-02 tree navigation path", () => {
  it("walks family → genus → species to a leaf QID", async () => {
    const families = (await post("/api/v1/observation/targets/search", { mode: "tree", path: [] }));
    const fb = (await families.json()) as { children: string[] };
    expect(fb.children).toContain("Family0");

    const genera = await post("/api/v1/observation/targets/search", { mode: "tree", path: ["Family0"] });
    expect(((await genera.json()) as { children: string[] }).children).toContain("Genus00");

    const leaf = await post("/api/v1/observation/targets/search", { mode: "tree", path: ["Family0", "Genus00", "Genus00 species0"] });
    const lb = (await leaf.json()) as { resolved: { qid: string; taxonomy: { species: string } } };
    expect(lb.resolved.qid).toBe("Q9000000");
    expect(lb.resolved.taxonomy.species).toBe("Genus00 species0");
  });
});

describe("OBS-02 auth + validation", () => {
  it("unauthenticated → 401", async () => {
    const res = await app.request(
      "/api/v1/observation/targets/search",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "name", query: "x" }) },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("unknown mode → 400", async () => {
    const res = await post("/api/v1/observation/targets/search", { mode: "telepathy" });
    expect(res.status).toBe(400);
  });
});
