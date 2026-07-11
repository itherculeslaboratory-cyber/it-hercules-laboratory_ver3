// PPR-17 / WIK-01 research agent batch（design-k5 §4）。generateTaskNodes は content(paper) 由来の
// 決定論タスク(同一 limitations→同一 task_id=sha1)、difficulty/priority ヒューリスティック、newspaper
// 生成を検証。distillWiki は同一入力→同一 wiki_node・board_summary→big_wiki 階層・append-only・
// LLM OFF スキップ(llm_calls=0 で決定論ノードは生成) を検証。全て put-if-absent で冪等。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";
import {
  generateTaskNodes,
  distillWiki,
  generateNewspaper,
  runBatchOnce,
} from "../apps/api/src/research-agent-batch";

const CONTENT_TYPE = "ihl.research.content.v1";
const TASK_TYPE = "ihl.research.task_node.v1";
const WIKI_TYPE = "ihl.research.wiki_node.v1";
const NOW = new Date("2026-07-11T21:00:00Z");

function section(text = "") {
  return { filled: text.length > 0, text };
}

async function seedPaper(
  s: TruthStore,
  o: {
    content_id: string;
    gap?: string;
    claims?: Record<string, unknown>[];
    conditions?: Record<string, unknown>;
    measurements?: Record<string, unknown>[];
    project_id?: string;
    title?: string;
  },
): Promise<void> {
  const data: Record<string, unknown> = {
    content_id: o.content_id,
    actor_id: "u1",
    content_type: "paper",
    title: o.title ?? o.content_id,
    created_at: "2026-07-01T00:00:00Z",
    schema_version: "1",
    completeness_pct: 50,
    sections: {
      purpose: section("purpose"),
      hypothesis: section("hypothesis"),
      conditions: section("conditions"),
      verification: section("verification"),
      phase: section("phase"),
      gap: section(o.gap ?? ""),
    },
  };
  if (o.claims) data.claims = o.claims;
  if (o.conditions) data.conditions = o.conditions;
  if (o.measurements) data.measurements = o.measurements;
  if (o.project_id) data.project_id = o.project_id;
  const res = await s.putEventAt(`truth/${CONTENT_TYPE}/${o.content_id}.json`, {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: CONTENT_TYPE,
    time: "2026-07-01T00:00:00Z",
    dataschema: "schemas/events/content.schema.json",
    provenance: { generator_kind: "human", actor_id: "u1" },
    data,
  });
  if (res.status !== "inserted") throw new Error(`seed failed: ${JSON.stringify(res)}`);
}

async function tasks(s: TruthStore): Promise<Record<string, unknown>[]> {
  return (await s.listEvents(`truth/${TASK_TYPE}/`)).map((e) => e.data as Record<string, unknown>);
}
async function wikiNodes(s: TruthStore): Promise<Record<string, unknown>[]> {
  return (await s.listEvents(`truth/${WIKI_TYPE}/`)).map((e) => e.data as Record<string, unknown>);
}

describe("PPR-17 generateTaskNodes deterministic + heuristics", () => {
  it("same limitation input yields the same task_id across runs (idempotent, sha1 key)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await seedPaper(s, { content_id: "P-1", gap: "More cold data needed" });

    const first = await generateTaskNodes(s, NOW);
    expect(first).toBeGreaterThanOrEqual(1); // limitation task created

    const before = await tasks(s);
    const second = await generateTaskNodes(s, NOW);
    expect(second).toBe(0); // same input → same task_id → put-if-absent conflict, no new node
    const after = await tasks(s);
    expect(after.length).toBe(before.length); // no duplicate node appended
    expect(after.filter((t) => t.source_kind === "limitation").length).toBe(1);
  });

  it("difficulty buckets by question length; limitation outranks next_question in priority", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const longGap = "A".repeat(130); // >120 chars → researcher bucket
    await seedPaper(s, {
      content_id: "P-2",
      gap: "More cold data needed", // short → beginner bucket
      claims: [{ claim_id: "cl-1", statement: "More cold data needed", status: "hypothesis" }],
    });
    await seedPaper(s, { content_id: "P-3", gap: longGap });
    await generateTaskNodes(s, NOW);
    const all = await tasks(s);

    const limitationShort = all.find((t) => t.source_kind === "limitation" && t.source_ref === "P-2")!;
    const nextQ = all.find((t) => t.source_kind === "next_question" && t.source_ref === "P-2")!;
    const limitationLong = all.find((t) => t.source_kind === "limitation" && t.source_ref === "P-3")!;

    expect(limitationShort.difficulty).toBe("beginner");
    expect(limitationLong.difficulty).toBe("researcher");
    // identical question text → base ordering decides: limitation(70) > next_question(40).
    expect(Number(limitationShort.priority)).toBeGreaterThan(Number(nextQ.priority));
  });

  it("data_gap task when a required condition key has no measurement", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await seedPaper(s, {
      content_id: "P-4",
      conditions: { temperature: { required: true, min: 20 }, humidity: { required: false } },
      measurements: [{ item: "humidity", value: 40, value_origin: "direct_observed" }],
    });
    await generateTaskNodes(s, NOW);
    const gaps = (await tasks(s)).filter((t) => t.source_kind === "data_gap");
    expect(gaps.length).toBe(1); // temperature required + unmeasured → gap; humidity not required → no gap
    expect(String(gaps[0].question)).toContain("temperature");
  });
});

describe("WIK-01 distillWiki deterministic hierarchy + LLM OFF skip", () => {
  it("builds board_summary -> big_wiki, is idempotent, and skips LLM when off", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await seedPaper(s, { content_id: "P-a", project_id: "proj-1", title: "Alpha" });
    await seedPaper(s, { content_id: "P-b", project_id: "proj-1", title: "Beta" });

    const r1 = await distillWiki(s, NOW, "off");
    expect(r1.board_summaries).toBeGreaterThanOrEqual(1);
    expect(r1.big_wikis).toBe(1);
    expect(r1.llm_calls).toBe(0); // LLM OFF → advisory enrichment skipped, deterministic nodes still built

    const levels = (await wikiNodes(s)).map((n) => n.level).sort();
    expect(levels).toContain("board_summary");
    expect(levels).toContain("big_wiki");

    // idempotent: same input → same node_id (sha1) → no new nodes on a second run.
    const before = (await wikiNodes(s)).length;
    const r2 = await distillWiki(s, NOW, "off");
    expect(r2.board_summaries).toBe(0);
    expect(r2.big_wikis).toBe(0);
    expect((await wikiNodes(s)).length).toBe(before);
  });

  it("runBatchOnce rejects llmMode!=off until real-key wiring lands (human gate, V3-FND invariant 1)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await expect(runBatchOnce(s, NOW, { llmMode: "on" })).rejects.toThrow(/human gate/);
  });
});

describe("PPR-17 newspaper generation + routes", () => {
  it("runBatchOnce generates a newspaper content; GET /research/newspaper projects the latest", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await seedPaper(s, { content_id: "P-n", gap: "Investigate feeding density effect" });

    const report = await runBatchOnce(s, NOW, { llmMode: "off" });
    expect(report.newspaper_id).not.toBeNull();
    expect(report.task_nodes).toBeGreaterThanOrEqual(1);
    expect(report.llm_mode).toBe("off");

    const res = await app.request(
      "/api/v1/research/newspaper",
      { method: "GET", headers: AUTH_HEADERS },
      makeEnv(bucket),
    );
    const body = (await res.json()) as { newspaper: { content_type: string; content_id: string } | null };
    expect(body.newspaper).not.toBeNull();
    expect(body.newspaper!.content_type).toBe("newspaper");
    expect(body.newspaper!.content_id).toBe(report.newspaper_id);
  });

  it("no newspaper is generated when there are no task nodes", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    expect(await generateNewspaper(s, NOW)).toBeNull();
  });
});

describe("PPR-17 manual task route (POST/GET /research/tasks)", () => {
  it("creates a task with deterministic id and 409s on identical re-post", async () => {
    const bucket = new FakeR2Bucket();
    const body = { source_kind: "limitation", source_ref: "P-x", question: "Why does molt fail in winter?" };
    const a = await app.request(
      "/api/v1/research/tasks",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) },
      makeEnv(bucket),
    );
    expect(a.status).toBe(201);
    const created = (await a.json()) as { task_id: string };

    const b = await app.request(
      "/api/v1/research/tasks",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) },
      makeEnv(bucket),
    );
    expect(b.status).toBe(409); // same (source_kind|source_ref|question) → same task_id → put-if-absent

    const tree = (await (
      await app.request("/api/v1/research/tasks", { method: "GET", headers: AUTH_HEADERS }, makeEnv(bucket))
    ).json()) as { items: Array<{ task_id: string }>; groups: Record<string, string[]> };
    expect(tree.items.map((t) => t.task_id)).toContain(created.task_id);
    expect(tree.groups._root).toContain(created.task_id); // no program_id → grouped under _root
  });

  it("rejects an unknown source_kind with 400", async () => {
    const bucket = new FakeR2Bucket();
    const res = await app.request(
      "/api/v1/research/tasks",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ source_kind: "bogus", source_ref: "r", question: "q" }) },
      makeEnv(bucket),
    );
    expect(res.status).toBe(400);
  });
});
