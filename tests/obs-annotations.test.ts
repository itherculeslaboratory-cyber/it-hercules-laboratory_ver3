// C5 K1 annotation TC (design-k1 §3 tests/obs-annotations) — OBS-46/47.
// LabelMe AST annotations are append-only: they round-trip, a manual annotation
// carries a value_origin tag, and there is NO edit route (an auto-measured value
// can never be mutated — 不変条項③).
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid } from "@ihl/truth";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, "content-type": "application/json" };

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function post(path: string, body: unknown, env: object, headers = AUTH_JSON) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env);
}

describe("OBS-46 annotation append + round-trip", () => {
  it("appends a LabelMe AST and it round-trips through Truth unchanged", async () => {
    const { bucket, env } = ctx();
    const captureId = ulid();
    const ast = { shapes: [{ label: "wing", points: [[1, 2], [3, 4]], shape_type: "polygon" }] };
    const res = await post("/api/v1/observation/annotations", { capture_id: captureId, ast, value_origin: "image_derived" }, env);
    expect(res.status).toBe(202);
    const { annotation_id } = (await res.json()) as { annotation_id: string };

    const stored = await new TruthStore(bucket).readEvent(`truth/ihl.obs.annotation.v1/${captureId}-${annotation_id}.json`);
    const data = stored!.data as { ast: unknown; capture_id: string; value_origin: string };
    expect(data.capture_id).toBe(captureId);
    expect(data.ast).toEqual(ast);
    expect(data.value_origin).toBe("image_derived"); // 手入力タグ付与
  });

  it("appending a second annotation to the same capture keeps both (append-only)", async () => {
    const { bucket, env } = ctx();
    const captureId = ulid();
    await post("/api/v1/observation/annotations", { capture_id: captureId, ast: { a: 1 } }, env);
    await post("/api/v1/observation/annotations", { capture_id: captureId, ast: { a: 2 } }, env);
    const all = await new TruthStore(bucket).listEvents(`truth/ihl.obs.annotation.v1/${captureId}-`);
    expect(all).toHaveLength(2);
  });
});

describe("OBS-47 append-only guardrails (no edit route)", () => {
  it("value_origin is validated against the frozen enum", async () => {
    const { env } = ctx();
    const res = await post("/api/v1/observation/annotations", { capture_id: ulid(), ast: {}, value_origin: "made_up" }, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("INVALID_VALUE_ORIGIN");
  });

  it("missing capture_id or non-object ast → 400", async () => {
    const { env } = ctx();
    expect((await post("/api/v1/observation/annotations", { ast: {} }, env)).status).toBe(400);
    expect((await post("/api/v1/observation/annotations", { capture_id: ulid(), ast: "not-obj" }, env)).status).toBe(400);
  });

  it("there is NO edit route: PUT/PATCH on an annotation is not found (自動計測値 修正不可)", async () => {
    const { env } = ctx();
    const captureId = ulid();
    const { annotation_id } = (await (await post("/api/v1/observation/annotations", { capture_id: captureId, ast: {} }, env)).json()) as { annotation_id: string };
    const put = await app.request(`/api/v1/observation/annotations/${annotation_id}`, { method: "PUT", headers: AUTH_JSON, body: "{}" }, env);
    expect(put.status).toBe(404);
    const patch = await app.request(`/api/v1/observation/annotations/${annotation_id}`, { method: "PATCH", headers: AUTH_JSON, body: "{}" }, env);
    expect(patch.status).toBe(404);
  });

  it("unauthenticated append → 401", async () => {
    const { env } = ctx();
    const res = await post("/api/v1/observation/annotations", { capture_id: ulid(), ast: {} }, env, { "content-type": "application/json" });
    expect(res.status).toBe(401);
  });
});
