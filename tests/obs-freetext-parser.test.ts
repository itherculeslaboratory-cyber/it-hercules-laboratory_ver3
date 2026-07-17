// V3-OBS-61: deterministic freetext observation parser (pure function TC +
// POST /observation/parse-freetext route TC).
import { describe, expect, it } from "vitest";
import { parseObservationFreetext } from "../apps/api/src/freetext-parser";
import app from "../apps/api/src/index";
import { DEV_TOKEN, makeEnv } from "./helpers";

const AUTH_JSON = { Authorization: `Bearer ${DEV_TOKEN}`, "content-type": "application/json" };
async function post(path: string, body: unknown, headers = AUTH_JSON) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, makeEnv());
}

describe("OBS-61 parseObservationFreetext (pure, deterministic)", () => {
  it("extracts date/individual/temperature/humidity/horn/food from one line", () => {
    const r = parseObservationFreetext("2026-07-17 個体DHH-24 温度28.5℃ 湿度62% 胸角45mm エサ ゼリー");
    expect(r.date).toBe("2026-07-17");
    expect(r.individual_id).toBe("DHH-24");
    expect(r.measurements).toEqual([
      { item: "temperature", value: 28.5, unit: "℃" },
      { item: "humidity", value: 62, unit: "%" },
      { item: "horn_length", value: 45, unit: "mm" },
    ]);
    expect(r.food).toBe("ゼリー");
    expect(r.matched).toBe(true);
  });

  it("accepts a JP-style date (年月日) and normalizes to ISO", () => {
    const r = parseObservationFreetext("2026年7月5日 個体X 温度25度");
    expect(r.date).toBe("2026-07-05");
    expect(r.measurements[0]).toEqual({ item: "temperature", value: 25, unit: "℃" });
  });

  it("individual with 個体ID: prefix and no other fields", () => {
    const r = parseObservationFreetext("個体ID:HH-1");
    expect(r.individual_id).toBe("HH-1");
    expect(r.measurements).toEqual([]);
    expect(r.matched).toBe(true);
  });

  it("empty/unrecognized text → matched:false, every field null/empty", () => {
    const r = parseObservationFreetext("特に何もありません");
    expect(r).toEqual({ date: null, individual_id: null, measurements: [], food: null, matched: false });
  });

  it("partial input (temperature only) sets only that measurement", () => {
    const r = parseObservationFreetext("今日は暑い、31.2℃だった");
    expect(r.measurements).toEqual([{ item: "temperature", value: 31.2, unit: "℃" }]);
    expect(r.date).toBeNull();
    expect(r.individual_id).toBeNull();
    expect(r.matched).toBe(true);
  });
});

describe("OBS-61 POST /observation/parse-freetext route", () => {
  it("returns the parsed JSON for a valid text body", async () => {
    const res = await post("/api/v1/observation/parse-freetext", { text: "個体DHH-1 温度27℃" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { individual_id: string; measurements: unknown[] };
    expect(body.individual_id).toBe("DHH-1");
    expect(body.measurements).toHaveLength(1);
  });

  it("empty text → 400 MISSING_TEXT", async () => {
    const res = await post("/api/v1/observation/parse-freetext", { text: "" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "MISSING_TEXT" });
  });

  it("unauthenticated → 401 (no bypass of the session gate)", async () => {
    const res = await app.request(
      "/api/v1/observation/parse-freetext",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "個体X" }) },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });
});
