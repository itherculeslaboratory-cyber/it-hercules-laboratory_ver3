// C7 背骨S8 TC: 貢献度への接続(V3-KRM-35・design R0801-f383db §4.5・
// RULING-2026-08-01-gen75-hqrulings.md R75-1/R75-2/R75-3)。
// completeness_ratio(S7)× evidence_grade(R75-1)× 条件群逓減(R75-2)を
// POST /individuals/{id}/life-events の発火点(writeLifeEvent→
// appendCohortTerminalContribution)経由で検証する。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { evidenceGrade } from "../apps/api/src/contribution";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, "content-type": "application/json" };
const V_BASE = 10; // CONTRIB_INDIVIDUAL_CREATED(economy-constants.ts)を再利用(ユーザー例示「一匹につき10貢献度」と一致)。
const DEATH_DETAIL = (stage: string) => ({ at_stage: stage, terminal_observation: { weight_g: 0.4 } });

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function post(path: string, body: unknown, env: object) {
  return app.request(path, { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
}
async function get(path: string, env: object) {
  return app.request(path, { headers: AUTH }, env);
}
async function createClutch(env: object, body: Record<string, unknown> = {}): Promise<string> {
  const res = await post("/api/v1/clutches", { harvested_at: "2026-07-12", initial_count: 10, ...body }, env);
  expect(res.status).toBe(201);
  return ((await res.json()) as { clutch_id: string }).clutch_id;
}
async function promote(env: object, clutchId: string, count: number): Promise<string[]> {
  const res = await post(`/api/v1/clutches/${clutchId}/promote`, { count, death_count: 0, at: "2026-08-01T00:00:00Z" }, env);
  expect(res.status).toBe(201);
  return ((await res.json()) as { individual_ids: string[] }).individual_ids;
}
async function researchScore(env: object): Promise<number> {
  const res = await get("/api/v1/me/contribution", env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { axes: { research: { score: number } } };
  return body.axes.research.score;
}
async function completenessRatio(env: object, clutchId: string): Promise<number> {
  const res = await get(`/api/v1/clutches/${clutchId}/completeness`, env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { completeness_ratio: number };
  return body.completeness_ratio;
}

describe("evidenceGrade(kind, detail) 単体 — R75-1 A=1.0/B=0.5/C=0.1 の等級判定", () => {
  it("death + terminal_observation あり → B(環境系列判定=Aは見送り・R75-1)", () => {
    expect(evidenceGrade("death", { at_stage: "second", terminal_observation: { weight_g: 1 } })).toBe("B");
  });
  it("death + terminal_observation 欠落(スキーマ導入前の旧データ相当) → C", () => {
    expect(evidenceGrade("death", { at_stage: "second" })).toBe("C");
    expect(evidenceGrade("death", undefined)).toBe("C");
  });
  it("eclosion → A(直接観測=最強の終端証拠)", () => {
    expect(evidenceGrade("eclosion", undefined)).toBe("A");
  });
  it("lost → C(申告のみ・観測ゼロ、R75-1の定義そのもの)", () => {
    expect(evidenceGrade("lost", undefined)).toBe("C");
  });
});

describe("S8 ① 未説明個体があると payout が下がる(completeness_ratio<1 が実際に掛かる)", () => {
  it("2匹promote・1匹だけ終端(死亡)・もう1匹は未終端 → ratio=0.5・delta=v_base×1×gradeB(0.5)×0.5", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 2 });
    const ids = await promote(env, id, 2);
    const before = await researchScore(env);
    await post(`/api/v1/individuals/${ids[0]}/life-events`, { kind: "death", at: "2026-08-05T00:00:00Z", detail: DEATH_DETAIL("second") }, env);
    const after = await researchScore(env);
    const ratio = await completenessRatio(env, id);
    expect(ratio).toBe(0.5); // 1 explained / 2 denominator(もう1匹は生存中=未終端)
    expect(after - before).toBeCloseTo(V_BASE * 1 * 0.5 * 0.5, 6); // n=1: (1+log2 1)=1 ・grade B=0.5・ratio=0.5
  });

  it("同条件で1匹しかいない(=ratio=1)場合と比べ、上のratio=0.5の方が明確に低いdeltaになる", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 1 });
    const ids = await promote(env, id, 1);
    const before = await researchScore(env);
    await post(`/api/v1/individuals/${ids[0]}/life-events`, { kind: "death", at: "2026-08-05T00:00:00Z", detail: DEATH_DETAIL("second") }, env);
    const after = await researchScore(env);
    const ratio = await completenessRatio(env, id);
    expect(ratio).toBe(1);
    const fullDelta = after - before;
    expect(fullDelta).toBeCloseTo(V_BASE * 1 * 0.5 * 1, 6); // = 5
    expect(fullDelta).toBeGreaterThan(V_BASE * 1 * 0.5 * 0.5); // 上のratio=0.5ケース(=2.5)より大きい
  });
});

describe("S8 ② 初齢(first)の終端は対象外(R75-3)", () => {
  it("at_stage='first'の死亡はpayoutイベントを生まない(研究スコアが変化しない)", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 1 });
    const ids = await promote(env, id, 1);
    const before = await researchScore(env);
    const res = await post(`/api/v1/individuals/${ids[0]}/life-events`, { kind: "death", at: "2026-08-05T00:00:00Z", detail: DEATH_DETAIL("first") }, env);
    expect(res.status).toBe(201); // life-event自体は正常に記録される(除外されるのはpayoutのみ)
    const after = await researchScore(env);
    expect(after).toBe(before);
  });
});

describe("S8 ③ 等級Cが満額にならない(grade_coef=0.1)", () => {
  // ★判断(報告書に記載): S6のスキーマif/thenが kind=death に detail.terminal_observation を
  // 必須化しているため、現在のHTTP経路では「terminal_observation欠落=grade C」の死亡は
  // スキーマ検証で弾かれ、生きたデータとしては作れない(evidenceGrade単体テストで論理は
  // 別途検証済み)。schemaが要求しない kind="lost" を「申告のみ=grade C」の生きた実例として使う。
  it("lost(grade C=0.1)は同条件のdeath(grade B=0.5)より明確に小さい・満額(grade A相当)にはならない", async () => {
    const { env: envB } = ctx();
    const clutchB = await createClutch(envB, { initial_count: 1 });
    const idsB = await promote(envB, clutchB, 1);
    const beforeB = await researchScore(envB);
    await post(`/api/v1/individuals/${idsB[0]}/life-events`, { kind: "death", at: "2026-08-05T00:00:00Z", detail: DEATH_DETAIL("second") }, envB);
    const deltaB = (await researchScore(envB)) - beforeB;

    const { env: envC } = ctx();
    const clutchC = await createClutch(envC, { initial_count: 1 });
    const idsC = await promote(envC, clutchC, 1);
    const beforeC = await researchScore(envC);
    await post(`/api/v1/individuals/${idsC[0]}/life-events`, { kind: "lost", at: "2026-08-05T00:00:00Z" }, envC);
    const deltaC = (await researchScore(envC)) - beforeC;

    expect(deltaB).toBeCloseTo(V_BASE * 1 * 0.5 * 1, 6); // grade B = 5
    expect(deltaC).toBeCloseTo(V_BASE * 1 * 0.1 * 1, 6); // grade C = 1
    expect(deltaC).toBeLessThan(deltaB);
    expect(deltaC).toBeLessThan(V_BASE * 1 * 1.0 * 1); // grade A(満額)の1/10であり満額にならない
  });
});

describe("S8 ④ 同一条件群のn件目が逓減する(R75-2・条件群=clutch_id×kind×at_stage)", () => {
  it("n=1の単価 > n=10の単価。ratioがほぼ1で安定する条件下で10件合計は v_base×(1+log2 10)×ratio に一致する", async () => {
    const { env } = ctx();
    // count層で1000匹分をあらかじめ攻略済みにしておき(attrition)、残り10匹だけを
    // 個体層でeclosionさせる → ratio=(1000+i)/1010 は 0.9901→1.0 とほぼ一定に保てる
    // (個体10匹だけの終端進行が自分自身のratioを大きく揺らさないようにする実験設計)。
    const id = await createClutch(env, { initial_count: 1010 });
    await post(`/api/v1/clutches/${id}/events`, { kind: "attrition", death_count: 1000, at: "2026-07-01T00:00:00Z" }, env);
    const ids = await promote(env, id, 10);

    const deltas: number[] = [];
    const ratios: number[] = [];
    let prevScore = await researchScore(env);
    for (let i = 0; i < 10; i++) {
      const day = String(i + 1).padStart(2, "0");
      const res = await post(`/api/v1/individuals/${ids[i]}/life-events`, { kind: "eclosion", at: `2026-08-${day}T00:00:00Z` }, env);
      expect(res.status).toBe(201);
      const cur = await researchScore(env);
      deltas.push(cur - prevScore);
      prevScore = cur;
      ratios.push(await completenessRatio(env, id));
    }

    // 各ステップの実測ratioで期待値を独立に再計算(ハードコードした数字への当てはめではなく
    // 実装と同じ式を別途組み立てて突合する検算)。grade=A(eclosion)=1.0。
    for (let i = 0; i < 10; i++) {
      const n = i + 1;
      const fPrev = n > 1 ? 1 + Math.log2(n - 1) : 0;
      const fCur = 1 + Math.log2(n);
      const expected = V_BASE * (fCur - fPrev) * 1.0 * ratios[i];
      expect(deltas[i]).toBeCloseTo(expected, 6);
    }

    // n=1(単価)とn=10(単価)を比較 → 明確に逓減している。
    expect(deltas[0]).toBeGreaterThan(deltas[9]);

    // 10件合計 ≒ v_base × (1+log2 10) × ratio(R75-2 検算・ratioがほぼ1で安定するため
    // 単純化した確定値=43.2193…に近い値になることを2%許容差で確認)。
    const total = deltas.reduce((a, b) => a + b, 0);
    const idealTotal = V_BASE * (1 + Math.log2(10)) * 1.0; // = 43.2193(ratio=1と仮定した理論値)
    expect(total).toBeGreaterThan(idealTotal * 0.97);
    expect(total).toBeLessThanOrEqual(idealTotal);
    expect(idealTotal).toBeCloseTo(43.2193, 3);
  });
});
