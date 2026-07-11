// V3-SEC-52 — unconsented-cron GATE. scanWranglerCron flags a cron declared in
// a wrangler.toml [triggers] block unless it is in the consent allowlist; a toml
// with no crons is clean. The current apps/api/wrangler.toml declares one cron
// ("0 15 * * *", the C5 K3 monthly batch) which IS consented in
// config/consented-crons.json (design-k3 §2.6) — the GATE must be green.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scanWranglerCron, extractCrons } from "../scripts/check-cron.mjs";

const WITH_CRON = `name = "x"\nmain = "src/index.ts"\n[triggers]\ncrons = ["0 0 * * *"]\n`;
const NO_CRON = `name = "x"\nmain = "src/index.ts"\n[[r2_buckets]]\nbinding = "TRUTH"\n`;

describe("V3-SEC-52 scanWranglerCron(consent gate)", () => {
  it("flags a cron with an empty allowlist", () => {
    expect(scanWranglerCron(WITH_CRON, [])).toEqual(["0 0 * * *"]);
  });

  it("passes a cron that is in the allowlist", () => {
    expect(scanWranglerCron(WITH_CRON, ["0 0 * * *"])).toEqual([]);
  });

  it("passes a toml with no crons", () => {
    expect(extractCrons(NO_CRON)).toEqual([]);
    expect(scanWranglerCron(NO_CRON, [])).toEqual([]);
  });

  it("the current apps/api/wrangler.toml declares exactly the monthly batch cron", () => {
    const toml = readFileSync(fileURLToPath(new URL("../apps/api/wrangler.toml", import.meta.url)), "utf8");
    expect(extractCrons(toml)).toEqual(["0 15 * * *"]);
  });

  it("that declared cron is consented (config/consented-crons.json) → GATE green", () => {
    const toml = readFileSync(fileURLToPath(new URL("../apps/api/wrangler.toml", import.meta.url)), "utf8");
    const consent = JSON.parse(
      readFileSync(fileURLToPath(new URL("../config/consented-crons.json", import.meta.url)), "utf8"),
    );
    expect(scanWranglerCron(toml, consent.crons)).toEqual([]); // no unconsented crons
  });
});
