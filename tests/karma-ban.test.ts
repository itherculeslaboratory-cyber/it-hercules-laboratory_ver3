// KRM-04 永久 BAN TC（design-k3 §4）。karma_value ≤ -100 で BAN。login（session 発行）
// 時に 403・R2 イベントは削除せず保持（可逆・投影判定）・免罪符（カウント -1）は BAN を
// 解かない（value 逆操作しないため）。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId, ulid } from "@ihl/truth";
import {
  KARMA_TYPE,
  grantKarmaCountIncrease,
  isBanned,
} from "../apps/api/src/ledger-routes";
import { PT_TYPE } from "../apps/api/src/contribution";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}`, ...JSON_HEADERS };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

async function mintPt(bucket: FakeR2Bucket, actorId: string, amount: number) {
  const id = ulid();
  await new TruthStore(bucket).putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: PT_TYPE,
    time: "2026-07-11T00:00:00Z",
    dataschema: "schemas/events/economy-pt-event.schema.json",
    provenance: { generator_kind: "human", actor_id: actorId },
    data: {
      pt_event_id: id,
      actor_id: actorId,
      delta: amount,
      reason_code: "mint",
      created_at: "2026-07-11T00:00:00Z",
      schema_version: "1",
    },
  });
}

describe("KRM-04 isBanned（karma_value ≤ -100）", () => {
  it("累犯で value がクランプ下限に達すると BAN", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await grantKarmaCountIncrease(s, DEV_ACTOR, 10); // fibPenalty(0,10)=143 → clamp -100
    expect(await isBanned(s, DEV_ACTOR)).toBe(true);
  });

  it("通常ユーザー（value > -100）は BAN でない", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await grantKarmaCountIncrease(s, DEV_ACTOR, 3); // value -4
    expect(await isBanned(s, DEV_ACTOR)).toBe(false);
    // 無履歴（value 0）も非 BAN。
    expect(await isBanned(s, await deriveActorId("clean@ihl.local"))).toBe(false);
  });
});

describe("KRM-04 login（session 発行）時の BAN ゲート", () => {
  it("BAN ユーザーの /verify は 403（session を発行しない）", async () => {
    const email = "banned@ihl.local";
    const bannedActor = await deriveActorId(email);
    const bucket = new FakeR2Bucket();
    await grantKarmaCountIncrease(new TruthStore(bucket), bannedActor, 10); // → BAN
    const env = { ...makeEnv(bucket), IHL_DEV_EXPOSE_MAGIC_TOKEN: "1" };

    const ml = await app.request(
      "/api/v1/auth/magic-link",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email }) },
      env,
    );
    const { dev_magic_token } = (await ml.json()) as { dev_magic_token: string };
    const vr = await app.request(
      "/api/v1/auth/verify",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ token: dev_magic_token }) },
      env,
    );
    expect(vr.status).toBe(403);
  });

  it("非 BAN ユーザーの /verify は 200", async () => {
    const email = "ok@ihl.local";
    const env = { ...makeEnv(), IHL_DEV_EXPOSE_MAGIC_TOKEN: "1" };
    const ml = await app.request(
      "/api/v1/auth/magic-link",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email }) },
      env,
    );
    const { dev_magic_token } = (await ml.json()) as { dev_magic_token: string };
    const vr = await app.request(
      "/api/v1/auth/verify",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ token: dev_magic_token }) },
      env,
    );
    expect(vr.status).toBe(200);
  });
});

describe("KRM-04 BAN は可逆・R2 保持・免罪符で解けない", () => {
  it("BAN 判定で R2 イベントは削除されない（保持）", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await grantKarmaCountIncrease(s, DEV_ACTOR, 10);
    const before = (await s.listEvents(`truth/${KARMA_TYPE}/`)).length;
    await isBanned(s, DEV_ACTOR);
    const after = (await s.listEvents(`truth/${KARMA_TYPE}/`)).length;
    expect(after).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  it("免罪符（カウント -1）は value を戻さず BAN を解かない", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const s = new TruthStore(bucket);
    await grantKarmaCountIncrease(s, DEV_ACTOR, 10); // count10, value -100 → BAN
    await mintPt(bucket, DEV_ACTOR, 100);
    expect(await isBanned(s, DEV_ACTOR)).toBe(true);

    // DEV_TOKEN 経路は per-request BAN 判定をしない（既発行相当・後波）ため購入到達可。
    const res = await app.request("/api/v1/shop/indulgence", { method: "POST", headers: AUTH }, env);
    expect(res.status).toBe(201); // カウントは減るが…
    expect(await isBanned(s, DEV_ACTOR)).toBe(true); // value 不変ゆえ依然 BAN
  });
});
