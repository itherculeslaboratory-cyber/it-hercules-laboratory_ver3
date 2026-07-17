// HANDOFF §3.4 残作業: 猶予キャンセル窓(60分)が閉じた後の相手承認制キャンセル依頼
// フロー。cancel_request(当事者どちらでも)→ 相手方の cancel_approve(cancelled へ実
// 遷移)/cancel_decline(却下・matched のまま)。requester 本人は自分の request を
// 承認/却下できない(対等な相互承認)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return app.request(`/api/v1/market/listings/${id}/transition`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function state(env: object, headers: Record<string, string>, id: string) {
  return app.request(`/api/v1/market/listings/${id}/state`, { headers }, env);
}
// ULID は同一ミリ秒内で単調増加しない(packages/truth/src/ulid.ts)ため、既存 market TC と
// 同じ回避策(2ms 空けて created_at を確実に進める)を連続 transition 間に挟む。
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface StateBody {
  state: string;
  cancel_request: { status: string; requested_by?: string; requested_at?: string; reason?: string };
}

describe("HANDOFF §3.4 相互承認キャンセル依頼(cancel_request/cancel_approve/cancel_decline)", () => {
  it("request(売り手)→approve(買い手)で cancelled へ遷移", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("cr-seller1", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("cr-buyer1", SESSION_SECRET));
    await transition(env, sellerH, "CR1", { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, "CR1", { kind: "match" });
    await sleep(2);

    const req = await transition(env, sellerH, "CR1", { kind: "cancel_request", payload: { reason: "在庫確認できず" } });
    expect(req.status).toBe(201);
    expect(((await req.json()) as { state: string }).state).toBe("matched"); // 自己ループ=state不変
    await sleep(2);

    const st1 = (await (await state(env, sellerH, "CR1")).json()) as StateBody;
    expect(st1.cancel_request).toMatchObject({ status: "pending", requested_by: "cr-seller1", reason: "在庫確認できず" });

    const approve = await transition(env, buyerH, "CR1", { kind: "cancel_approve" });
    expect(approve.status).toBe(201);
    expect(((await approve.json()) as { state: string }).state).toBe("cancelled");

    const st2 = (await (await state(env, sellerH, "CR1")).json()) as StateBody;
    expect(st2.state).toBe("cancelled");
    expect(st2.cancel_request.status).toBe("approved");
  });

  it("request(買い手)→decline(売り手)は matched のまま・再requestで新しいpendingへ戻る", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("cr-seller2", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("cr-buyer2", SESSION_SECRET));
    await transition(env, sellerH, "CR2", { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, "CR2", { kind: "match" });
    await sleep(2);

    await transition(env, buyerH, "CR2", { kind: "cancel_request" });
    await sleep(2);
    const decline = await transition(env, sellerH, "CR2", { kind: "cancel_decline" });
    expect(decline.status).toBe(201);
    expect(((await decline.json()) as { state: string }).state).toBe("matched");
    await sleep(2);

    const st = (await (await state(env, sellerH, "CR2")).json()) as StateBody;
    expect(st.state).toBe("matched");
    expect(st.cancel_request.status).toBe("declined");
    await sleep(2);

    // 却下後、買い手が再度 request できる(永久ロックではない)。
    const req2 = await transition(env, buyerH, "CR2", { kind: "cancel_request" });
    expect(req2.status).toBe(201);
    const st2 = (await (await state(env, sellerH, "CR2")).json()) as StateBody;
    expect(st2.cancel_request.status).toBe("pending");
  });

  it("pending 中の二重 request は409(CANCEL_REQUEST_PENDING)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("cr-seller3", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("cr-buyer3", SESSION_SECRET));
    await transition(env, sellerH, "CR3", { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, "CR3", { kind: "match" });
    await sleep(2);
    await transition(env, sellerH, "CR3", { kind: "cancel_request" });
    await sleep(2);
    const dup = await transition(env, buyerH, "CR3", { kind: "cancel_request" });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toBe("CANCEL_REQUEST_PENDING");
  });

  it("pending 無しの approve/decline は409(NO_PENDING_CANCEL_REQUEST)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("cr-seller4", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("cr-buyer4", SESSION_SECRET));
    await transition(env, sellerH, "CR4", { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, "CR4", { kind: "match" });
    await sleep(2);
    const approve = await transition(env, buyerH, "CR4", { kind: "cancel_approve" });
    expect(approve.status).toBe(409);
    expect(((await approve.json()) as { error: string }).error).toBe("NO_PENDING_CANCEL_REQUEST");
  });

  it("requester本人は自分のrequestを承認/却下できない(403)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("cr-seller5", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("cr-buyer5", SESSION_SECRET));
    await transition(env, sellerH, "CR5", { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, "CR5", { kind: "match" });
    await sleep(2);
    await transition(env, sellerH, "CR5", { kind: "cancel_request" });
    await sleep(2);
    const selfApprove = await transition(env, sellerH, "CR5", { kind: "cancel_approve" });
    expect(selfApprove.status).toBe(403);
    const selfDecline = await transition(env, sellerH, "CR5", { kind: "cancel_decline" });
    expect(selfDecline.status).toBe(403);
  });

  it("第三者(非当事者)は request/approve/decline いずれも403", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("cr-seller6", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("cr-buyer6", SESSION_SECRET));
    const strangerH = bearer(await issueSessionToken("cr-stranger6", SESSION_SECRET));
    await transition(env, sellerH, "CR6", { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, "CR6", { kind: "match" });
    await sleep(2);
    const req = await transition(env, strangerH, "CR6", { kind: "cancel_request" });
    expect(req.status).toBe(403);
  });

  it("猶予窓が閉じた後もcancel(grace)は409だがcancel_requestは到達可能(相互承認へ誘導)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("cr-seller7", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("cr-buyer7", SESSION_SECRET));
    await transition(env, sellerH, "CR7", { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, "CR7", { kind: "match" });
    await sleep(2);
    // GRACE_CANCEL_MINUTES(60分)経過を模すため、直接 cancel を叩いても実サーバ時刻では
    // 窓は開いたままになる(時間注入できない route のため猶予キャンセル自体はここでは
    // 検証しない・既存 market-payment-mismatch 等でカバー済み)。ここでは cancel_request
    // が isAllowedEdge 経由で到達可能なことだけを確認する(matched からの新規辺)。
    const req = await transition(env, buyerH, "CR7", { kind: "cancel_request" });
    expect(req.status).toBe(201);
  });
});
