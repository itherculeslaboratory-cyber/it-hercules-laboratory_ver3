import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// V3-AIP-101 個体詳細スライスA(individual-detail・c7-wireframes-core5 §4 F1/F2)。
// 家族(♂親+♀親に観測2点ずつ→子3体に観測2〜3点・1体死亡・1体は親リンク無しの
// 単体個体)を実データで作り、d1(子個体=判断3指標フル: チャート親破線+コホート
// 帯・血統健全度・近交リスク・血縁レール)→d2(親リンク無し=ⓘ帯+算定不能の
// 第一級表示)→d3(血縁chipタップで親に差替+パンくず)→d4(タイムライン+値を
// 訂正の展開)を実ブラウザで打鍵まで通す(目視ゲート用スクリーンショット4枚)。
const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(SPEC_DIR, "..", "..", "..", "docs", "planning", "c7", "screens");
const shot = (page: Page, name: string, fullPage = false) =>
  page.screenshot({ path: resolve(SHOTS, `individual-detail-${name}.png`), fullPage });

async function devLogin(page: Page) {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
}

test("個体詳細スライスA: 判断3指標→親カーブ欠損→血縁chip差替→タイムライン訂正", async ({ page }) => {
  await devLogin(page);
  const tag = Date.now().toString(36);

  const seed = await page.evaluate(async ({ tag }) => {
    const post = async (path: string, body: unknown) =>
      fetch(`/api/v1${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
    const capture = async (individualId: string, weight: number) =>
      post("/observation/captures", {
        domain: "biology",
        subject_ref: `individual/${individualId}`,
        measurements: [{ item: "weight", kind: "number", value: weight, unit: "g", value_origin: "direct_observed" }],
      });

    const sireLabel = `E2E-IND-父-${tag}`;
    const damLabel = `E2E-IND-母-${tag}`;
    const aLabel = `E2E-IND-子A-${tag}`;
    const bLabel = `E2E-IND-子B-${tag}`;
    const cLabel = `E2E-IND-子C-${tag}`;
    const zLabel = `E2E-IND-単体Z-${tag}`;

    const sire = await post("/individuals", { local_label_text: sireLabel });
    const dam = await post("/individuals", { local_label_text: damLabel });
    await capture(sire.individual_id, 140);
    await capture(sire.individual_id, 150);
    await capture(dam.individual_id, 118);
    await capture(dam.individual_id, 124);

    const a = await post("/individuals", { local_label_text: aLabel });
    const b = await post("/individuals", { local_label_text: bLabel });
    const c = await post("/individuals", { local_label_text: cLabel });
    for (const kid of [a, b, c]) {
      await post(`/individuals/${kid.individual_id}/parents`, { parent_id: sire.individual_id, parent_role: "sire" });
      await post(`/individuals/${kid.individual_id}/parents`, { parent_id: dam.individual_id, parent_role: "dam" });
    }

    await capture(a.individual_id, 30);
    await capture(a.individual_id, 45);
    await capture(a.individual_id, 62);
    await post(`/individuals/${a.individual_id}/life-events`, { kind: "eclosion", at: new Date().toISOString() });

    await capture(b.individual_id, 28);
    await capture(b.individual_id, 40);
    await post(`/individuals/${b.individual_id}/life-events`, { kind: "death", at: new Date().toISOString() });

    await capture(c.individual_id, 32);
    await capture(c.individual_id, 47);

    // 親リンク無しの単体個体(購入個体相当) — 親カーブ欠損の第一級状態(d2)。
    const z = await post("/individuals", { local_label_text: zLabel });
    await capture(z.individual_id, 55);

    return {
      sireId: sire.individual_id as string,
      aId: a.individual_id as string,
      zId: z.individual_id as string,
      sireLabel,
      damLabel,
      aLabel,
      bLabel,
      cLabel,
    };
  }, { tag });

  // ── d1: 子個体(親あり・きょうだいあり)= 判断3指標フル ──────────────────
  await page.goto(`${WEB}/s/individual-detail?id=${seed.aId}`);
  await expect(page.getByRole("heading", { name: "個体の詳細" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: seed.aLabel })).toBeVisible();

  // 成長チャート: 親♂/親♀の破線凡例+コホート(きょうだい2匹・観測4点)帯。
  await expect(page.locator(".civ-growth-chart-svg")).toBeVisible();
  await expect(page.getByText("┄┄ 親♂")).toBeVisible();
  await expect(page.getByText("┈┈ 親♀")).toBeVisible();
  await expect(page.getByText(/▧ 同腹帯\(n=4\)/)).toBeVisible();

  // 血統健全度: 同腹3匹(a+b+c)・死亡率33%(b死亡)・羽化到達33%(aのみ羽化)。
  await expect(page.getByText("同腹 3匹")).toBeVisible();
  await expect(page.getByText(/死亡率 33%/)).toBeVisible();
  await expect(page.getByText(/羽化到達 33%/)).toBeVisible();

  // 近交リスク: sire/damは互いに無関係(共通祖先なし)なので F=0(算定は可能)。
  await expect(page.getByText("F = 0.0000")).toBeVisible();

  // 血縁レール: 親♂/♀chip・死亡きょうだいは(死亡)付き・生存きょうだいは通常表示。
  await expect(page.getByRole("button", { name: new RegExp(`♂ ${seed.sireLabel}`) })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`♀ ${seed.damLabel}`) })).toBeVisible();
  await expect(page.getByRole("button", { name: `${seed.bLabel}(死亡)`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: seed.cLabel, exact: true })).toBeVisible();
  await shot(page, "d1");

  // ── d2: 親リンク無しの単体個体 = ⓘ帯+算定不能の第一級表示 ──────────────
  await page.goto(`${WEB}/s/individual-detail?id=${seed.zId}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/ⓘ 親データ無し/)).toBeVisible();
  await expect(page.getByText("同腹集計なし(単体登録)")).toBeVisible();
  await expect(page.getByText("算定不能(血統データ無し)")).toBeVisible();
  await expect(page.getByText("血縁情報なし(単体登録)")).toBeVisible();
  await shot(page, "d2");

  // ── d3: 血縁chipタップで対象個体を親に差替(パンくず「前の個体に戻る」)──
  await page.goto(`${WEB}/s/individual-detail?id=${seed.aId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: new RegExp(`♂ ${seed.sireLabel}`) }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: seed.sireLabel })).toBeVisible();
  await expect(page.getByRole("button", { name: "← 前の個体に戻る" })).toBeVisible();
  await shot(page, "d3");

  // ── d4: 変化点タイムライン+「値を訂正」展開状態 ─────────────────────────
  await page.goto(`${WEB}/s/individual-detail?id=${seed.aId}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "変化点タイムライン" })).toBeVisible();
  await expect(page.getByText(/62g/)).toBeVisible();
  await expect(page.getByText(/\+17\.0g/)).toBeVisible(); // 62g - 45g(前回)のΔ
  await page.getByRole("button", { name: /値を訂正/ }).first().click();
  await expect(page.getByText("記録値 62g → 訂正後の値")).toBeVisible();
  await shot(page, "d4", true);
});
