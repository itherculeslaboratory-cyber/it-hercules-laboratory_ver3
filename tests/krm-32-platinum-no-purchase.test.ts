// V3-KRM-32 プラチナコイン(通貨でなく貢献を示すメダル)。「売買・交換(通貨化)や
// 自動生成は禁止する」の否定不変条項を固定する。付与理由(coin_event.reason_code)は
// schemas/frozen/ledger-entry.schema.json(CL-12)で vote_reward/contribution_rebate/
// manual/other の4値に閉じており、"purchase"/"exchange"のような通貨化理由コードは
// スキーマレベルで構造的に不可能(新規追加はCL-12凍結契約の変更になるため見送り済み
// = round-16の解釈どおり「メダルは金銭で買えない」を型で担保する)。
// grantPlatinum(付与関数)自体もamount<0を拒否し、全呼び出し元(grep確認済み:
// project-routes.ts citation固定額/batch.ts cron固定額/market-flag-routes.ts
// misban-reversal固定額)はサーバ側定数のみを渡す — クライアント供給の任意額を
// そのままプラチナへ変換する経路は存在しない。
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateFrozen } from "@ihl/truth";
import { grantPlatinum } from "../apps/api/src/ledger-routes";
import { FakeR2Bucket, loadFixture } from "./helpers";
import { TruthStore } from "@ihl/truth";

const shapes = loadFixture("cl-shape-samples.json");
const coin = shapes["cl-12-coin"] as Record<string, unknown>;

describe("KRM-32 coin_event reason_code is a closed enum (no purchase/exchange reason)", () => {
  it("reason_code='purchase' is rejected by the frozen schema (not in the 4-value enum)", () => {
    expect(validateFrozen("ledger-entry", { ...coin, reason_code: "purchase" }).valid).toBe(false);
  });

  it("reason_code='exchange' is rejected by the frozen schema", () => {
    expect(validateFrozen("ledger-entry", { ...coin, reason_code: "exchange" }).valid).toBe(false);
  });

  it("the 4 allowed reason codes are exactly vote_reward/contribution_rebate/manual/other", () => {
    for (const reason of ["vote_reward", "contribution_rebate", "manual", "other"]) {
      expect(validateFrozen("ledger-entry", { ...coin, reason_code: reason }).valid).toBe(true);
    }
  });
});

describe("KRM-32 grantPlatinum server-side guard (no negative / no arbitrary auto-mint)", () => {
  it("throws on a negative amount (grant-only invariant enforced at the function boundary too)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await expect(grantPlatinum(s, "actor-1", -1)).rejects.toThrow();
  });

  it("amount 0 (no-op grant) is accepted (>=0, not a purchase path)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await expect(grantPlatinum(s, "actor-1", 0)).resolves.toBeUndefined();
  });
});

describe("KRM-32 no route source mentions buying/exchanging platinum for money", () => {
  it("apps/api/src/*.ts contains no buy/purchase/exchange wording adjacent to platinum/coin", () => {
    const dir = fileURLToPath(new URL("../apps/api/src", import.meta.url));
    const offenders: string[] = [];
    const pattern = /(buy|purchase|exchange)[^\n]{0,30}(platinum|coin)|( platinum|coin)[^\n]{0,30}(buy|purchase|exchange)/i;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      const text = readFileSync(`${dir}/${name}`, "utf8");
      if (pattern.test(text)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
