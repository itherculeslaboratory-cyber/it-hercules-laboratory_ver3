// V3-KRM-28 観測commit成功時の研究貢献度フック(design-c5/round-16自走)。
// commit success -> axis=research contribution_event(source=observation):
// observation_saved(+5・毎回) / observation_with_photo(+3・写真ありなら追加加点) /
// individual_created(+10・POST /individuals 成功時)。
// サンドボックスCommunity Vote(FR-SBX-52)との連携は、SBX-52自体が本リポジトリに
// 未実装(連携先が存在しない)ため対象外(裁定不要・単なる未着手インフラ)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { deriveActorId, ulid } from "@ihl/truth";
import { projectContribution } from "../apps/api/src/contribution";
import { TruthStore } from "@ihl/truth";
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

describe("KRM-28 observation_saved(+5) on solid-observation/commit", () => {
  it("commit success appends a research-axis contribution_event(source=observation, +5)", async () => {
    const { bucket, env } = ctx();
    const res = await post("/api/v1/solid-observation/commit", { domain: "biology" }, env);
    expect(res.status).toBe(202);
    const p = await projectContribution(new TruthStore(bucket), DEV_ACTOR);
    expect(p.axes.research.score).toBe(5);
  });
});

describe("KRM-28 observation_with_photo(+3) additive when the capture already has a photo", () => {
  it("commit after an upload for the same capture_id -> +5 (saved) + 3 (with_photo) = 8", async () => {
    const { bucket, env } = ctx();
    const captureId = ulid();
    const fd = new FormData();
    fd.append("capture_id", captureId);
    fd.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "p.png");
    const up = await app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fd }, env);
    expect(up.status).toBe(202);

    const res = await post("/api/v1/solid-observation/commit", { capture_id: captureId, domain: "biology" }, env);
    expect(res.status).toBe(202);

    const p = await projectContribution(new TruthStore(bucket), DEV_ACTOR);
    expect(p.axes.research.score).toBe(8); // 5 + 3
  });

  it("commit with no prior photo upload -> only +5 (no with_photo bonus)", async () => {
    const { bucket, env } = ctx();
    const res = await post("/api/v1/solid-observation/commit", { domain: "biology" }, env);
    expect(res.status).toBe(202);
    const p = await projectContribution(new TruthStore(bucket), DEV_ACTOR);
    expect(p.axes.research.score).toBe(5);
  });
});

describe("KRM-28 individual_created(+10) on POST /individuals", () => {
  it("creating an individual master appends a research-axis contribution_event(+10)", async () => {
    const { bucket, env } = ctx();
    const res = await post("/api/v1/individuals", { species: "Rhinoceros sp." }, env);
    expect(res.status).toBe(201);
    const p = await projectContribution(new TruthStore(bucket), DEV_ACTOR);
    expect(p.axes.research.score).toBe(10);
  });

  it("two captures + one individual accumulate across sources (5 + 5 + 10 = 20)", async () => {
    const { bucket, env } = ctx();
    await post("/api/v1/solid-observation/commit", { domain: "biology" }, env);
    await post("/api/v1/solid-observation/commit", { domain: "biology" }, env);
    await post("/api/v1/individuals", { species: "Rhinoceros sp." }, env);
    const p = await projectContribution(new TruthStore(bucket), DEV_ACTOR);
    expect(p.axes.research.score).toBe(20);
  });
});
