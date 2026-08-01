// V3-KRM-35 — 貢献度(知識への貢献)と生存率(飼育技術の指標)の表示分離。
// RULING-2026-08-01-gen65-ihl-backbone.md §8:154-155「★貢献度は『知識への貢献』であって
// 『飼育技術のランキング』ではないと表示上も明確に分けること」。
// 生存率算出(S7)は未実装のため、economy-status 画面(screen-defs/economy-status.json)が
// 束ねる4本の GET API(/me/ledger・/me/contribution・/me/pt・/me/status)のレスポンスに
// survival/survival_rate 系キーが混入していないことを、規律ではなくテストで固定する。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { DEV_TOKEN, makeEnv } from "./helpers";

const AUTH = { headers: { Authorization: `Bearer ${DEV_TOKEN}` } };

// economy-status.json の各ノードが参照する source_path 一覧(V3-KRM-16)。
const ECONOMY_STATUS_ENDPOINTS = [
  "/api/v1/me/ledger",
  "/api/v1/me/contribution",
  "/api/v1/me/pt",
  "/api/v1/me/status",
];

function findSurvivalKeys(value: unknown, path = "$"): string[] {
  if (value === null || typeof value !== "object") return [];
  const hits: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/survival/i.test(key)) hits.push(`${path}.${key}`);
    hits.push(...findSurvivalKeys(child, `${path}.${key}`));
  }
  return hits;
}

describe("V3-KRM-35 economy-status APIs do not expose survival_rate (S7 未実装の固定)", () => {
  for (const endpoint of ECONOMY_STATUS_ENDPOINTS) {
    it(`${endpoint} response has no survival/survival_rate key (recursive scan)`, async () => {
      const res = await app.request(endpoint, AUTH, makeEnv());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(findSurvivalKeys(body)).toEqual([]);
    });
  }
});
