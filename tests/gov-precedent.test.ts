// Precedent 判例 TC(design-c5.md §K6 §4 / V3-GOV-12)。dispute close で precedent が R2 append・
// projectPrecedents が q/tag 検索・precedent が CiteRef(type=precedent)で citeUrl 引用可能・
// R2 DELETE なし(元 dispute の open event も残存)。it 名は ASCII。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { citeUrl } from "../apps/api/src/plaza-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

async function openAndClose(env: ReturnType<typeof makeEnv>, close: Record<string, unknown>) {
  const opened = (await (await app.request(
    "/api/v1/gov/disputes",
    { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ category: "market", respondent_id: "bob" }) },
    env,
  )).json()) as { dispute_id: string };
  const closed = (await (await app.request(
    `/api/v1/gov/disputes/${opened.dispute_id}/close`,
    { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(close) },
    env,
  )).json()) as { precedent_id: string };
  return { disputeId: opened.dispute_id, precedentId: closed.precedent_id };
}
async function search(env: ReturnType<typeof makeEnv>, query: string) {
  const res = await app.request(`/api/v1/gov/precedents${query}`, { headers: AUTH_HEADERS }, env);
  return ((await res.json()) as { precedents: { precedent_id: string }[] }).precedents;
}

describe("gov precedent on dispute close (GOV-12)", () => {
  it("appends a precedent to R2 when a dispute is closed", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const { precedentId } = await openAndClose(env, { title: "no refund after use", summary: "buyer used the item" });
    expect(precedentId).toBeTruthy();
    // R2 append: exactly one precedent object now exists.
    const keys = [...bucket.objects.keys()].filter((k) => k.startsWith("truth/ihl.gov.precedent.v1/"));
    expect(keys.length).toBe(1);

    const detail = await app.request(`/api/v1/gov/precedents/${precedentId}`, { headers: AUTH_HEADERS }, env);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { precedent: { category: string; title: string } };
    expect(body.precedent.category).toBe("market"); // inherited from the dispute
    expect(body.precedent.title).toBe("no refund after use");
  });

  it("searches precedents by full-text q and by tag", async () => {
    const env = makeEnv();
    const a = await openAndClose(env, { title: "shipping delay", summary: "seller shipped late", tags: ["logistics"] });
    const b = await openAndClose(env, { title: "wrong species label", summary: "misidentified taxon", tags: ["taxonomy"] });

    const byText = await search(env, "?q=misidentified");
    expect(byText.map((p) => p.precedent_id)).toContain(b.precedentId);
    expect(byText.map((p) => p.precedent_id)).not.toContain(a.precedentId);

    const byTag = await search(env, "?tag=logistics");
    expect(byTag.map((p) => p.precedent_id)).toContain(a.precedentId);
    expect(byTag.map((p) => p.precedent_id)).not.toContain(b.precedentId);
  });

  it("is citable via a precedent CiteRef and does not DELETE the source dispute", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const { disputeId, precedentId } = await openAndClose(env, { title: "t", summary: "s" });

    // CiteRef(type=precedent) resolves to a stable URL.
    expect(citeUrl({ type: "precedent", id: precedentId })).toBe(`/gov/precedents/${precedentId}`);

    // append-only: the dispute open event survives close (no R2 DELETE).
    const disputeKeys = [...bucket.objects.keys()].filter((k) => k.startsWith(`truth/ihl.gov.dispute.v1/${disputeId}/`));
    expect(disputeKeys.length).toBeGreaterThanOrEqual(2); // open + close
    const view = await app.request(`/api/v1/gov/disputes/${disputeId}`, { headers: AUTH_HEADERS }, env);
    expect(view.status).toBe(200);
  });

  it("rejects close without title/summary (precedent is not LLM-derived)", async () => {
    const env = makeEnv();
    const opened = (await (await app.request(
      "/api/v1/gov/disputes",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ category: "board", respondent_id: "bob" }) },
      env,
    )).json()) as { dispute_id: string };
    const res = await app.request(
      `/api/v1/gov/disputes/${opened.dispute_id}/close`,
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ title: "only a title" }) },
      env,
    );
    expect(res.status).toBe(400);
  });
});
