// KRM-21/04 プロフィール TC（design-k3 §4）。3 指標（Karma/Contribution/Market）個別
// 返却・研究スコアは Contribution 配下（独立 4 番目にしない）・public_safety の非公開設定
// 拒否・intl_trust 0-100・BAN 公開表示（KRM-04）。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId, ulid } from "@ihl/truth";
import {
  projectProfile, canSetPrivate, PUBLIC_SAFETY_FIELDS, CONFIGURABLE_FIELDS,
} from "../apps/api/src/profile-routes";
import { appendKarma } from "../apps/api/src/ledger-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const DEV_ACTOR = await deriveActorId("dev@ihl.local");

async function seedContribution(s: TruthStore, actor: string, axis: string, delta: number): Promise<void> {
  const id = ulid();
  const res = await s.putEvent({
    specversion: "1.0", id, source: "apps/api", type: "ihl.economy.contribution_event.v1",
    time: "2026-07-11T00:00:00Z", dataschema: "schemas/events/economy-contribution-event.schema.json",
    provenance: { generator_kind: "human", actor_id: actor },
    data: {
      contribution_event_id: id, node_id: "node-1", actor_id: actor, axis, delta,
      source: "manual", created_at: "2026-07-11T00:00:00Z", schema_version: "1",
    },
  });
  if (res.status !== "inserted") throw new Error(`seed contribution failed: ${res.status}`);
}

describe("KRM-21 canSetPrivate（public_safety は非公開設定拒否）", () => {
  it("public_safety フィールドは全て非公開設定不可", () => {
    for (const f of PUBLIC_SAFETY_FIELDS) expect(canSetPrivate(f)).toBe(false);
  });
  it("国/言語/文化/自己紹介/アイコンのみ公開設定可", () => {
    for (const f of CONFIGURABLE_FIELDS) expect(canSetPrivate(f)).toBe(true);
    expect(canSetPrivate("karma")).toBe(false);
  });
});

describe("KRM-21 projectProfile（3 指標個別・研究スコアは Contribution 配下）", () => {
  it("Karma / Contribution / Market を個別に返し、research_score は contribution.axes.research", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await seedContribution(s, DEV_ACTOR, "research", 4200);
    const p = await projectProfile(s, DEV_ACTOR);
    // 3 指標が独立キーで存在（研究は 4 番目の独立指標にしない）。
    expect(p.karma).toBeDefined();
    expect(p.contribution).toBeDefined();
    expect(p.market).toBeDefined();
    expect((p as Record<string, unknown>).research).toBeUndefined(); // 独立 research 指標なし
    expect(p.contribution.research_score).toBe(4200);
    expect(p.contribution.axes.research.score).toBe(4200);
  });

  it("intl_trust は 0-100 に収まる", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const def = await projectProfile(s, DEV_ACTOR);
    expect(def.intl_trust).toBeGreaterThanOrEqual(0);
    expect(def.intl_trust).toBeLessThanOrEqual(100);
    expect(def.intl_trust).toBe(50); // karma 0 → 50
    await appendKarma(s, DEV_ACTOR, "value", -100, "dispute"); // value=-100
    const low = await projectProfile(s, DEV_ACTOR);
    expect(low.intl_trust).toBe(0); // 下限クランプ
  });

  it("BAN 公開表示: karma_value≤-100 で ban=true", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await appendKarma(s, DEV_ACTOR, "value", -100, "dispute");
    const p = await projectProfile(s, DEV_ACTOR);
    expect(p.karma.ban).toBe(true);
    expect(p.karma.value).toBe(-100);
  });
});

describe("GET /api/v1/me/profile + /users/{actor}/profile + /me/status", () => {
  it("認証なしは 401", async () => {
    expect((await app.request("/api/v1/me/profile", {}, makeEnv())).status).toBe(401);
  });

  it("/me/profile は本人の 3 指標を返す", async () => {
    const bucket = new FakeR2Bucket();
    await seedContribution(new TruthStore(bucket), DEV_ACTOR, "development", 300);
    const res = await app.request("/api/v1/me/profile", { headers: AUTH_HEADERS }, makeEnv(bucket));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actor_id: string; contribution: { axes: { development: { score: number } } } };
    expect(body.actor_id).toBe(DEV_ACTOR);
    expect(body.contribution.axes.development.score).toBe(300);
  });

  it("/users/{actor}/profile は公開ビュー（BAN 公開表示）", async () => {
    const bucket = new FakeR2Bucket();
    await appendKarma(new TruthStore(bucket), "banned-user", "value", -100, "dispute");
    const res = await app.request("/api/v1/users/banned-user/profile", { headers: AUTH_HEADERS }, makeEnv(bucket));
    const body = (await res.json()) as { karma: { ban: boolean } };
    expect(body.karma.ban).toBe(true);
  });

  it("/me/status は統合ステータス + append-only 履歴を返す", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await seedContribution(s, DEV_ACTOR, "capital", 50);
    await appendKarma(s, DEV_ACTOR, "count", 1, "dispute");
    const res = await app.request("/api/v1/me/status", { headers: AUTH_HEADERS }, makeEnv(bucket));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { karma: unknown; history: { kind: string }[] };
    expect(body.karma).toBeDefined();
    const kinds = body.history.map((h) => h.kind);
    expect(kinds).toContain("contribution");
    expect(kinds).toContain("karma");
  });
});
