// 束E第1段(E1)— 横断検索 route(design R0801-c618a6-REPORT-2026-08-01-g78-b3think.md
// §2 案1・§2-1)。index/receipt/<date>/ の IndexEntry(既存の受領索引・新規ストレージ0)を
// 日付プレフィックス単位で走査する GET /api/v1/search を検証する。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid } from "@ihl/truth";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv, makeEnvelope } from "./helpers";
//
// g80-vis1(design R0801-7b17da §2-3 案C'補強2「初期設定は拒否」)で E1 の対象型は
// 「可視性の判定規則が確立している型」= capture(ihl.obs.capture.v1)だけに絞られた
// (cross-search-routes.ts VISIBILITY_RULED_TYPES)。よってこのファイルの固定フィクスチャ
// (旧 KNOWN_TYPE=pt_event)は capture へ差し替えた — pt_event は現在の許可リスト外であり
// 元のテスト意図(「既知dataschemaならヒットする」の一般検証)を capture で引き継ぐ。
const KNOWN_SCHEMA = "schemas/events/obs-capture.schema.json";
const KNOWN_TYPE = "ihl.obs.capture.v1";

function knownEnvelope(overrides: Record<string, unknown> = {}) {
  const captureId = ulid();
  return makeEnvelope({
    type: KNOWN_TYPE,
    dataschema: KNOWN_SCHEMA,
    subject: "individual/golden-1",
    provenance: { generator_kind: "human", actor_id: "actor-1" },
    data: {
      capture_id: captureId,
      actor_id: "actor-1",
      domain: "biology",
      visibility: "public", // g80-vis1: 既定拒否の対象外にするため明示(private/uid_linkedの回帰は e1-search-visibility.test.ts)
    },
    ...overrides,
  });
}

describe("GET /api/v1/search — E1 横断検索 第1段", () => {
  it("未認証は401", async () => {
    const { env } = { env: makeEnv() };
    const res = await app.request("/api/v1/search", { method: "GET" }, env);
    expect(res.status).toBe(401);
  });

  // store.putEvent は received_at を new Date()(壁時計・今)で刻む(store.ts:71)ため、
  // 索引の日付プレフィックスは実行時点の「今日」になる。from/to はテスト実行日に合わせる。
  const today = new Date().toISOString().slice(0, 10);

  it("q(フリーテキスト)が text_repr 部分一致でヒットする", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const env = makeEnv(bucket);
    await store.putEvent(knownEnvelope());

    const res = await app.request(`/api/v1/search?q=golden-1&from=${today}&to=${today}`, {
      method: "GET",
      headers: AUTH_HEADERS,
    }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; results: { subject: string }[] };
    expect(body.count).toBe(1);
    expect(body.results[0].subject).toBe("individual/golden-1");
  });

  it("type/subject/actor_id フィルタが効く", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const env = makeEnv(bucket);
    await store.putEvent(knownEnvelope());
    await store.putEvent(
      knownEnvelope({ subject: "individual/other-2", provenance: { generator_kind: "human", actor_id: "actor-2" } }),
    );

    const byActor = await app.request(
      `/api/v1/search?actor_id=actor-2&from=${today}&to=${today}`,
      { method: "GET", headers: AUTH_HEADERS },
      env,
    );
    const byActorBody = (await byActor.json()) as { count: number; results: { actor_id: string }[] };
    expect(byActorBody.count).toBe(1);
    expect(byActorBody.results[0].actor_id).toBe("actor-2");

    const bySubject = await app.request(
      `/api/v1/search?subject=individual%2Fgolden-1&from=${today}&to=${today}`,
      { method: "GET", headers: AUTH_HEADERS },
      env,
    );
    const bySubjectBody = (await bySubject.json()) as { count: number };
    expect(bySubjectBody.count).toBe(1);
  });

  it("未知型(dataschema無し)は text_repr=null で q 検索にヒットせず、type フィルタでも拾えない(g80-vis1補強2: 可視性規則の無い型は既定拒否)", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const env = makeEnv(bucket);
    // makeEnvelope() 既定は dataschema 無し → buildTextRepr は null を返す(index-entry.ts)。
    // かつ型 ihl.test.sample.v1 は VISIBILITY_RULED_TYPES(cross-search-routes.ts)に
    // 無いため、type フィルタで明示的に狙っても行ごと出ない(g80-vis1以前は出ていた —
    // これが設計上の「正直な代償」= 検索対象が当面capture型に狭まる)。
    await store.putEvent(makeEnvelope());

    const res = await app.request(
      `/api/v1/search?q=anything&from=${today}&to=${today}`,
      { method: "GET", headers: AUTH_HEADERS },
      env,
    );
    const body = (await res.json()) as { count: number; unknown_type_note: string; visibility_scope_note: string };
    expect(body.count).toBe(0);
    expect(body.unknown_type_note).toMatch(/text_repr is null/);
    expect(body.visibility_scope_note).toMatch(/capture events/);

    const byType = await app.request(
      `/api/v1/search?type=ihl.test.sample.v1&from=${today}&to=${today}`,
      { method: "GET", headers: AUTH_HEADERS },
      env,
    );
    const byTypeBody = (await byType.json()) as { count: number };
    expect(byTypeBody.count).toBe(0);
  });

  it("日付プレフィックス単位で走査し、範囲外の日付は含まれない", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const env = makeEnv(bucket);
    // putEvent は received_at を「今」で刻むため、索引キーの日付を直接制御できない
    // (store.ts:71)。よって index/receipt/ のオブジェクトを直接2日ぶん書き、
    // 日付プレフィックス走査そのものを検証する(受領索引のスキーマは §1-3 実測どおり)。
    const inRange = {
      event_id: "evt-in", type: KNOWN_TYPE, subject: "individual/in-range", actor_id: "actor-1",
      payload_key: "truth/x/evt-in.json", payload_bytes: 1, event_hash: "h1",
      received_at: "2026-07-10T00:00:00.000Z", claimed_at: null, sig_alg: null, key_id: null,
      sig: null, signed_bytes_sha256: null, sig_verified: null,
      text_repr: "[pt_event] type=ihl.economy.pt_event.v1 subject=individual/in-range", text_repr_v: 1,
    };
    const outOfRange = { ...inRange, event_id: "evt-out", subject: "individual/out-of-range", text_repr: "[pt_event] subject=individual/out-of-range" };
    await bucket.put(`index/receipt/2026-07-10/1-evt-in.json`, JSON.stringify(inRange), { onlyIf: { etagDoesNotMatch: "*" } });
    await bucket.put(`index/receipt/2026-07-05/1-evt-out.json`, JSON.stringify(outOfRange), { onlyIf: { etagDoesNotMatch: "*" } });

    const res = await app.request(
      "/api/v1/search?from=2026-07-10&to=2026-07-10",
      { method: "GET", headers: AUTH_HEADERS },
      env,
    );
    const body = (await res.json()) as { count: number; results: { subject: string }[] };
    expect(body.count).toBe(1);
    expect(body.results[0].subject).toBe("individual/in-range");
  });

  it("1000件天井: 1プレフィックスに1000件ちょうど在ると truncated=true をその日付について正直に返す", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const date = "2026-07-10";
    for (let i = 0; i < 1000; i++) {
      const entry = {
        event_id: `evt-${i}`, type: KNOWN_TYPE, subject: `individual/x-${i}`, actor_id: "actor-1",
        payload_key: `truth/x/evt-${i}.json`, payload_bytes: 1, event_hash: `h${i}`,
        received_at: `${date}T00:00:00.000Z`, claimed_at: null, sig_alg: null, key_id: null,
        sig: null, signed_bytes_sha256: null, sig_verified: null, text_repr: null, text_repr_v: 1,
      };
      await bucket.put(`index/receipt/${date}/${i}-evt-${i}.json`, JSON.stringify(entry), {
        onlyIf: { etagDoesNotMatch: "*" },
      });
    }

    const res = await app.request(`/api/v1/search?from=${date}&to=${date}`, { method: "GET", headers: AUTH_HEADERS }, env);
    const body = (await res.json()) as { truncated: boolean; truncated_dates: string[]; count: number };
    expect(body.truncated).toBe(true);
    expect(body.truncated_dates).toEqual([date]);
    expect(body.count).toBe(1000);
  });

  it("期間指定を省くと既定=直近7日になる(from/to が省略時に補完される)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const res = await app.request("/api/v1/search", { method: "GET", headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { query: { from: string; to: string } };
    const days = (Date.parse(`${body.query.to}T00:00:00.000Z`) - Date.parse(`${body.query.from}T00:00:00.000Z`)) / 86_400_000;
    expect(days).toBe(6); // 7日窓 = from〜to inclusive で差は6日
  });

  it("90日を超える範囲は400(全期間の素朴な走査を書かない・完了条件)", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/api/v1/search?from=2026-01-01&to=2026-06-01",
      { method: "GET", headers: AUTH_HEADERS },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_QUERY");
  });

  it("from が YYYY-MM-DD 形式でないと400", async () => {
    const env = makeEnv();
    const res = await app.request("/api/v1/search?from=2026-7-1&to=2026-07-10", { method: "GET", headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(400);
  });

  it("append-only: 同一subjectの新旧イベントが両方ヒットし、畳まないことをdedup_noteが明示する", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const date = "2026-07-10";
    const older = {
      event_id: "evt-old", type: KNOWN_TYPE, subject: "individual/rev", actor_id: "actor-1",
      payload_key: "truth/x/evt-old.json", payload_bytes: 1, event_hash: "h-old",
      received_at: `${date}T00:00:00.000Z`, claimed_at: null, sig_alg: null, key_id: null,
      sig: null, signed_bytes_sha256: null, sig_verified: null,
      text_repr: "[pt_event] subject=individual/rev delta=1", text_repr_v: 1,
    };
    const newer = { ...older, event_id: "evt-new", event_hash: "h-new", received_at: `${date}T01:00:00.000Z`, text_repr: "[pt_event] subject=individual/rev delta=2" };
    await bucket.put(`index/receipt/${date}/0-evt-old.json`, JSON.stringify(older), { onlyIf: { etagDoesNotMatch: "*" } });
    await bucket.put(`index/receipt/${date}/1-evt-new.json`, JSON.stringify(newer), { onlyIf: { etagDoesNotMatch: "*" } });

    const res = await app.request(`/api/v1/search?subject=individual%2Frev&from=${date}&to=${date}`, { method: "GET", headers: AUTH_HEADERS }, env);
    const body = (await res.json()) as { count: number; results: { event_id: string }[]; dedup_note: string };
    expect(body.count).toBe(2);
    expect(body.results.map((r) => r.event_id).sort()).toEqual(["evt-new", "evt-old"]);
    expect(body.dedup_note).toMatch(/append-only/);
  });
});
