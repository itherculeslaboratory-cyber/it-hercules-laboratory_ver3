import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { makePng } from "./make-png";

// T-63 波1(design-individual-finder.md §2.3/§4): 個体ファインダー(一覧+絞り込み
// +個体詳細パネル+血統)。home→ファインダー→フィルタ(種チップ)→sort(体長列
// ヘッダ・昇降トグル)→プリセット(体長上位10%・実データ分位点)→行選択→詳細
// パネル(実測形質+写真)→血統(先祖chip/子chip・ノードジャンプ)→individual-detail
// 遷移を実ブラウザで打鍵まで通す(目視ゲート用スクリーンショット)。obs-search.spec
// と同じ縮退: R2 append-only で過去run分が累積するため種にこの run 専用タグを
// 振って母集団を確定し、プリセットの分位点計算もこの母集団(種チップ後)に対して
// 行われるので件数アサーションが決定的になる。
const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(SPEC_DIR, "..", "..", "..", "docs", "planning", "c9", "screens");
const shot = (page: Page, name: string, fullPage = false) =>
  page.screenshot({ path: resolve(SHOTS, `individual-finder-${name}.png`), fullPage });

async function devLogin(page: Page) {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
}

test("個体ファインダー: home→フィルタ→sort→プリセット→行選択→詳細パネル→血統→個体詳細遷移", async ({ page }) => {
  await devLogin(page);
  const tag = Date.now().toString(36);
  const pngBase64 = makePng().toString("base64");

  const seed = await page.evaluate(
    async ({ tag, pngBase64 }) => {
      const post = async (path: string, body: unknown) =>
        fetch(`/api/v1${path}`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).then((r) => r.json());
      const capture = async (individualId: string, weight: number, length: number) =>
        post("/observation/captures", {
          domain: "biology",
          subject_ref: `individual/${individualId}`,
          measurements: [
            { item: "weight", kind: "number", value: weight, unit: "g", value_origin: "direct_observed" },
            { item: "length", kind: "number", value: length, unit: "mm", value_origin: "direct_observed" },
          ],
        });
      const uploadPhoto = async (captureId: string) => {
        const bin = atob(pngBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const fd = new FormData();
        fd.append("capture_id", captureId);
        fd.append("file", new Blob([bytes], { type: "image/png" }), "e2e.png");
        return fetch("/api/v1/observation/upload", { method: "POST", credentials: "include", body: fd }).then((r) =>
          r.json(),
        );
      };

      const species = `E2E-FINDER-SP-${tag}`;
      const sireLabel = `E2E-FINDER-父-${tag}`;
      const damLabel = `E2E-FINDER-母-${tag}`;
      const aLabel = `E2E-FINDER-01-${tag}`;
      const gLabel = `E2E-FINDER-子-${tag}`;
      const fillerLengths = [20, 30, 40, 50];
      const fillerLabels = fillerLengths.map((n, i) => `E2E-FINDER-F${i + 1}-${tag}`);

      const sire = await post("/individuals", { local_label_text: sireLabel, species });
      const dam = await post("/individuals", { local_label_text: damLabel, species });

      // A(体長80mm=母集団最大) — sire/dam に血統リンク+実写真1枚。
      const a = await post("/individuals", { local_label_text: aLabel, species });
      await post(`/individuals/${a.individual_id}/parents`, { parent_id: sire.individual_id, parent_role: "sire" });
      await post(`/individuals/${a.individual_id}/parents`, { parent_id: dam.individual_id, parent_role: "dam" });
      const aCap = await capture(a.individual_id, 45, 80);
      await uploadPhoto(aCap.capture_id as string);

      // G = A の子(体長15mm=母集団最小)。
      const g = await post("/individuals", { local_label_text: gLabel, species });
      await post(`/individuals/${g.individual_id}/parents`, { parent_id: a.individual_id, parent_role: "sire" });
      await capture(g.individual_id, 5, 15);

      // 分位点計算のための中間値(20/30/40/50mm・血統なし単体)。
      for (let i = 0; i < fillerLengths.length; i++) {
        const ind = await post("/individuals", { local_label_text: fillerLabels[i], species });
        await capture(ind.individual_id, 10, fillerLengths[i]);
      }

      return { species, sireId: sire.individual_id as string, sireLabel, damLabel, aId: a.individual_id as string, aLabel, gLabel };
    },
    { tag, pngBase64 },
  );

  // 1. ファインダー(レンダラ版)へ直接遷移。R52(caseB7実物採用・T-67)でhomeの
  //    「理想の個体を探す」は /finder/finder.html(静的ページ)へ張り替え済み
  //    (screen-defs/home.json)。このレンダラ版画面自体は「触らず残す」対象の
  //    ままなので、本specは直接URLで到達性・挙動を検証し続ける。
  await page.goto(`${WEB}/s/individual-finder`);
  await expect(page.getByRole("heading", { name: "個体ファインダー" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  // 2. フィルタ: 種チップでこの run の8体(sire+dam+A+G+filler4)に母集団を確定。
  await page.getByRole("button", { name: seed.species }).click();
  await expect(page.getByText("8個体", { exact: true })).toBeVisible();
  await shot(page, "filtered", true);

  // 3. sort: 体長ヘッダクリックで desc(母集団最大=A・80mm)。thead 内に絞って
  //    プリセットチップ「体長 上位10%」ボタンとの名前衝突を避ける。
  const lengthHeaderBtn = page.locator("thead").getByRole("button", { name: /体長/ });
  await lengthHeaderBtn.click();
  await expect(page.locator("tbody tr").first()).toContainText(seed.aLabel);
  // 再クリックで asc(母集団最小=G・15mm)。
  await lengthHeaderBtn.click();
  await expect(page.locator("tbody tr").first()).toContainText(seed.gLabel);

  // 4. プリセット: 体長上位10%(この8体の分位点=約65mm)→ Aのみ残る。
  await page.getByRole("button", { name: "体長 上位10%" }).click();
  await expect(page.getByText("1個体", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText(seed.aLabel);

  // 5. 行選択 → 詳細パネル(実測形質+写真)。
  await page.getByLabel(`${seed.aLabel} を選択`).click();
  await expect(page.getByRole("heading", { name: seed.aLabel })).toBeVisible();
  await expect(page.getByText("体長 80mm", { exact: true })).toBeVisible();
  await expect(page.getByText("体重 45g", { exact: true })).toBeVisible();
  await expect(page.getByText("観測回数 1回", { exact: true })).toBeVisible();
  const detailThumb = page.locator(".civ-finder-detail .civ-profile-thumb");
  await expect(detailThumb).toBeVisible();
  await expect
    .poll(() => detailThumb.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // 6. 血統: 先祖(♂/♀ chip)+子(chip)が実データで出る。
  await expect(page.getByRole("button", { name: new RegExp(`♂ ${seed.sireLabel}`) })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`♀ ${seed.damLabel}`) })).toBeVisible();
  await expect(page.getByRole("button", { name: seed.gLabel, exact: true })).toBeVisible();
  await shot(page, "detail-pedigree", true);

  // 7. 血統chipのノードジャンプ: 親♂をクリック→詳細パネルが差し替わる(先祖なし)。
  await page.getByRole("button", { name: new RegExp(`♂ ${seed.sireLabel}`) }).click();
  await expect(page.getByRole("heading", { name: seed.sireLabel })).toBeVisible();
  await expect(page.getByText("先祖の記録はありません(単体登録)。")).toBeVisible();

  // 8. individual-detail 遷移: ジャンプ後の個体(親♂)で「詳細画面を開く」。
  await page.getByRole("button", { name: "詳細画面を開く" }).click();
  await expect(page.getByRole("heading", { name: "個体の詳細" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: seed.sireLabel })).toBeVisible();
});
