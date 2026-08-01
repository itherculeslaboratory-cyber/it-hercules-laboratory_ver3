// 背骨S4(V3-OBS-75 / D-2)— ihl.obs.cadence.v1 宣言 + 穴の導出。
// 完了条件(設計R0801-f383db §7 S4行の逐語): ①宣言どおり出せば穴0
// ②1回飛ばすと穴1 ③effective_from を過去にした宣言で過去の穴が消えないこと。
// ①②③は deriveCadenceGaps(純関数)を直接叩く — 壁時計に依存させないため
// (実サーバは putEvent 入口で now() を刻むので、間隔=時間のテストを実サーバ経由で
// 書くと秒単位でflakyになる)。route自体の配線確認(index.tsを触らず obsRoutes へ
// 相乗りできていること)は末尾の統合テスト1本で別途確認する。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { deriveCadenceGaps } from "../apps/api/src/cadence-routes";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH_JSON = { Authorization: `Bearer ${DEV_TOKEN}`, "content-type": "application/json" };

const HOURLY = {
  stream_kind: "env_telemetry",
  subject_id: "device/dev-1",
  expected_interval_s: 3600,
  tolerance_s: 60,
  effective_from: "2026-01-01T00:00:00.000Z",
  received_at: "2026-01-01T00:00:00.000Z",
};

describe("deriveCadenceGaps — 完了条件①②③(純関数・決定論)", () => {
  it("① 宣言どおり出せば穴0(00:00〜03:00の4スロット全部満たす)", () => {
    const asOf = "2026-01-01T03:00:00.000Z";
    const received = [
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T01:00:00.000Z",
      "2026-01-01T02:00:00.000Z",
      "2026-01-01T03:00:00.000Z",
    ];
    const result = deriveCadenceGaps([HOURLY], received, asOf);
    expect(result.cadence_declared).toBe(true);
    expect(result.gap_count).toBe(0);
    expect(result.gaps).toEqual([]);
  });

  it("② 1回(01:00)飛ばすと穴1", () => {
    const asOf = "2026-01-01T03:00:00.000Z";
    const received = [
      "2026-01-01T00:00:00.000Z",
      // 01:00 を飛ばす
      "2026-01-01T02:00:00.000Z",
      "2026-01-01T03:00:00.000Z",
    ];
    const result = deriveCadenceGaps([HOURLY], received, asOf);
    expect(result.gap_count).toBe(1);
    expect(result.gaps).toEqual([{ slot: "2026-01-01T01:00:00.000Z" }]);
  });

  it("③ 後発の宣言が effective_from を過去に遡らせても、先発の宣言が支配していた期間の穴は消えない", () => {
    // 先発宣言A: 01-01T00:00〜 毎時。01:00 の提出を飛ばす(②と同じ穴)。
    // 後発宣言B: 01-02T00:00 に受領(received_at)。effective_from を A と同じ
    // 01-01T00:00 まで遡らせ、かつ間隔を極端に緩く(ほぼ穴が出ない設定)申告する
    // ことで、Aの期間の穴を後から「無かったこと」にしようとする攻撃を模す。
    const declA = HOURLY;
    const declB = {
      stream_kind: "env_telemetry",
      subject_id: "device/dev-1",
      expected_interval_s: 999_999_999, // ほぼ無穴になる緩い間隔
      tolerance_s: 0,
      effective_from: "2026-01-01T00:00:00.000Z", // ★遡及狙い
      received_at: "2026-01-02T00:00:00.000Z", // 実際に宣言が届いたのはここ
    };
    const asOf = "2026-01-02T02:00:00.000Z";
    const received = [
      "2026-01-01T00:00:00.000Z",
      // 01:00 を飛ばす(Aの期間の穴)
      "2026-01-01T02:00:00.000Z",
    ];
    const result = deriveCadenceGaps([declA, declB], received, asOf);
    // Bの遡及申告があっても、01-01T01:00 の穴はそのまま残る。
    expect(result.gaps.map((g) => g.slot)).toContain("2026-01-01T01:00:00.000Z");
    // かつ B の支配区間は B自身の received_at(01-02T00:00)以降からしか始まらない
    // ことの裏取り: A単独で計算した時と同じ穴が 01-01 側に出ている(Bに侵食されない)。
    const boundary = "2026-01-02T00:00:00.000Z";
    const aloneResult = deriveCadenceGaps([declA], received, boundary);
    expect(result.gaps.filter((g) => g.slot < boundary)).toEqual(aloneResult.gaps.filter((g) => g.slot < boundary));
  });

  it("宣言が無い subject は cadence_declared:false(穴ゼロとは別物)", () => {
    const result = deriveCadenceGaps([], [], "2026-01-01T00:00:00.000Z");
    expect(result).toEqual({ cadence_declared: false, gap_count: 0, gaps: [] });
  });
});

describe("POST/GET /observation/cadence — 配線確認(index.ts不触・obsRoutesへの相乗り)", () => {
  function ctx() {
    const bucket = new FakeR2Bucket();
    return { bucket, env: makeEnv(bucket) };
  }

  it("宣言を append でき、GET .../gaps が届く(index.tsを増やさず app.route(\"/api/v1\", obsRoutes) 経由で解決)", async () => {
    const { env } = ctx();
    const declareRes = await app.request(
      "/api/v1/observation/cadence",
      {
        method: "POST",
        headers: AUTH_JSON,
        body: JSON.stringify({
          stream_kind: "env_telemetry",
          subject_id: "device/wire-test",
          expected_interval_s: 3600,
          tolerance_s: 60,
          effective_from: "2026-01-01T00:00:00.000Z",
        }),
      },
      env,
    );
    expect(declareRes.status).toBe(202);

    const gapsRes = await app.request(
      "/api/v1/observation/cadence/device%2Fwire-test/gaps?as_of=2026-01-01T00:00:00.000Z",
      { method: "GET", headers: AUTH_JSON },
      env,
    );
    expect(gapsRes.status).toBe(200);
    const body = (await gapsRes.json()) as { cadence_declared: boolean; subject_id: string };
    expect(body.cadence_declared).toBe(true);
    expect(body.subject_id).toBe("device/wire-test");
  });

  it("未認証は401(observation系routeと同じ認証ゲートを通る)", async () => {
    const { env } = ctx();
    const res = await app.request(
      "/api/v1/observation/cadence",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      env,
    );
    expect(res.status).toBe(401);
  });
});
