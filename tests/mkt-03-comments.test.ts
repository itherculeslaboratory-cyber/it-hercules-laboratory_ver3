// V3-MKT-03: マッチング前の公開面(商品詳細+公開Q&A+ほめボード)。既存の非公開ボード
// (matched以降・当事者2人のみ)は market-stage.test.ts が別途カバー — 本 TC は追加した
// 公開Q&A/ほめボードのみを検証する。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { AUTH_HEADERS, FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return app.request(
    `/api/v1/market/listings/${id}/transition`,
    { method: "POST", headers, body: JSON.stringify(body) },
    env,
  );
}
function postComment(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return app.request(
    `/api/v1/market/listings/${id}/comments`,
    { method: "POST", headers, body: JSON.stringify(body) },
    env,
  );
}
function getComments(env: object, id: string) {
  return app.request(`/api/v1/market/listings/${id}/comments`, { headers: AUTH_HEADERS }, env);
}

describe("V3-MKT-03 公開Q&A + ほめボード", () => {
  it("認証なし → 401", async () => {
    const res = await postComment(makeEnv(), {}, "L1", { kind: "question", body: "hi" });
    expect(res.status).toBe(401);
  });

  it("本文必須(空文字は 400)", async () => {
    const res = await postComment(makeEnv(), AUTH_HEADERS, "L1", { kind: "question", body: "" });
    expect(res.status).toBe(400);
  });

  it("誰でも質問/ほめを投稿でき、出品者だけが回答できる", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer", SESSION_SECRET));
    await transition(env, sellerH, "L1", { kind: "list_fixed" });

    const qRes = await postComment(env, buyerH, "L1", { kind: "question", body: "餌は何ですか?" });
    const q = (await qRes.json()) as { comment_id: string };
    expect(qRes.status).toBe(201);
    expect(q.comment_id).toBeTruthy();

    // 出品者以外が回答 → 403
    const forbidden = await postComment(env, buyerH, "L1", {
      kind: "answer",
      body: "違います",
      parent_comment_id: q.comment_id,
    });
    expect(forbidden.status).toBe(403);

    // 出品者の回答 → 201
    const answer = await postComment(env, sellerH, "L1", {
      kind: "answer",
      body: "人工飼料です",
      parent_comment_id: q.comment_id,
    });
    expect(answer.status).toBe(201);

    // 回答に parent_comment_id 必須
    const missingParent = await postComment(env, sellerH, "L1", { kind: "answer", body: "no parent" });
    expect(missingParent.status).toBe(400);

    // ほめボードは誰でも投稿可
    const praise = await postComment(env, buyerH, "L1", { kind: "praise", body: "綺麗な血統ですね!" });
    expect(praise.status).toBe(201);

    const list = (await (await getComments(env, "L1")).json()) as {
      questions: { kind: string; body: string }[];
      praise: { kind: string; body: string }[];
    };
    expect(list.questions.map((x) => x.kind)).toEqual(["question", "answer"]);
    expect(list.praise.length).toBe(1);
  });

  it("マッチング後(非公開ボード成立後)も公開Q&A/ほめボードは引き続き見える", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer", SESSION_SECRET));
    await transition(env, sellerH, "L1", { kind: "list_fixed" });
    await postComment(env, buyerH, "L1", { kind: "praise", body: "楽しみです" });
    await transition(env, sellerH, "L1", { kind: "match", counterparty: "buyer" });

    const list = (await (await getComments(env, "L1")).json()) as { praise: unknown[] };
    expect(list.praise.length).toBe(1);
  });
});
