import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// T-66(design-individual-finder.md §1.2/§3/§5波2-3・V3-UIX-83後続波): 個体宇宙面
// (全個体星空)。individual-finder.spec.ts と同じ縮退(this run専用種タグで母集団
// を確定・実データを打鍵まで通す・目視ゲート用スクリーンショット)。finder→行選択
// →「★宇宙で見る」→宇宙遷移(?focus)→自動フォーカス(ノード選択+血統クラス付与)
// →血統chipクリックでジャンプ→individual-detail遷移、まで実ブラウザで通す。
// 3D宇宙面のクリック相当の手続きは、camera投影に依存しない実DOM(FinderDetailPanel
// のPedigreeChip・individual-finderと共用)経由で行う — pixel-perfect canvas click
// より決定論的で壊れにくい(brief許容: DOM状態assert優先)。
const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(SPEC_DIR, "..", "..", "..", "docs", "planning", "c9", "screens");
const shot = (page: Page, name: string, fullPage = false) =>
  page.screenshot({ path: resolve(SHOTS, `individual-universe-${name}.png`), fullPage });

async function devLogin(page: Page) {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
}

test("個体宇宙面: finder→行選択→宇宙遷移(?focus)→ノード選択→血統クラス付与→ジャンプ→個体詳細遷移", async ({ page }) => {
  await devLogin(page);
  const tag = Date.now().toString(36);

  const seed = await page.evaluate(
    async ({ tag }) => {
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

      const species = `E2E-UNIV-SP-${tag}`;
      const sireLabel = `E2E-UNIV-父-${tag}`;
      const damLabel = `E2E-UNIV-母-${tag}`;
      const childLabel = `E2E-UNIV-子-${tag}`;
      const grandLabel = `E2E-UNIV-孫-${tag}`;
      const fillerLabels = [0, 1, 2].map((i) => `E2E-UNIV-F${i + 1}-${tag}`);

      const sire = await post("/individuals", { local_label_text: sireLabel, species });
      const dam = await post("/individuals", { local_label_text: damLabel, species });
      const child = await post("/individuals", { local_label_text: childLabel, species });
      await post(`/individuals/${child.individual_id}/parents`, { parent_id: sire.individual_id, parent_role: "sire" });
      await post(`/individuals/${child.individual_id}/parents`, { parent_id: dam.individual_id, parent_role: "dam" });
      await capture(sire.individual_id, 40, 70);
      await capture(dam.individual_id, 20, 50);
      await capture(child.individual_id, 45, 80);

      // 孫(childの子)— 子孫方向の血統発光を確認するため。
      const grand = await post("/individuals", { local_label_text: grandLabel, species });
      await post(`/individuals/${grand.individual_id}/parents`, { parent_id: child.individual_id, parent_role: "sire" });
      await capture(grand.individual_id, 5, 15);

      // 近傍/座標分散用のfiller(血統なし単体)。
      const fillerLengths = [20, 30, 60];
      for (let i = 0; i < fillerLabels.length; i++) {
        const ind = await post("/individuals", { local_label_text: fillerLabels[i], species });
        await capture(ind.individual_id, 10, fillerLengths[i]);
      }

      return {
        species,
        sireLabel,
        damLabel,
        childId: child.individual_id as string,
        childLabel,
        grandLabel,
      };
    },
    { tag },
  );

  // 1. home → ファインダー → 種チップでこの run の母集団(6体)に確定 → child行を選択。
  await page.goto(`${WEB}/`);
  await page.getByRole("button", { name: "理想の個体を探す" }).click();
  await expect(page.getByRole("heading", { name: "個体ファインダー" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: seed.species }).click();
  await expect(page.getByText("7個体", { exact: true })).toBeVisible();
  await page.getByLabel(`${seed.childLabel} を選択`).click();
  await expect(page.getByRole("heading", { name: seed.childLabel })).toBeVisible();

  // 2. 「★ 宇宙で見る」は行選択時のみ有効 → クリックで宇宙面へ(?focus=childId)。
  const universeBtn = page.getByRole("button", { name: "★ 宇宙で見る" });
  await expect(universeBtn).toBeVisible();
  await universeBtn.click();
  await expect(page).toHaveURL(new RegExp(`/s/individual-universe\\?focus=${seed.childId}`));
  await expect(page.getByRole("heading", { name: "個体の宇宙" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  // 3. ?focus 受信で自動フォーカス(ノード選択+血統クラス付与) — バナー+右カラム
  //    詳細パネル(individual-finderと共用の FinderDetailPanel)に反映される。
  await expect(page.getByText(new RegExp(`個体ファインダーからフォーカス中.*${seed.childLabel}`))).toBeVisible();
  await expect(page.locator(".civ-universe-rightcol").getByRole("heading", { name: seed.childLabel })).toBeVisible();
  await expect(page.getByText(new RegExp(`選択中.*${seed.childLabel}.*先祖2.*子孫1`))).toBeVisible();

  // WebGL: 3d-force-graph が実際にキャンバスを作れたことを確認(フォールバック
  // 文言が出ていない・three.js が挿入する <canvas> が存在する)。
  await expect(page.locator(".civ-universe-fallback")).toHaveCount(0);
  await expect(page.locator(".civ-universe-canvas canvas")).toBeVisible();
  await shot(page, "focus-lineage", true);

  // 4. 血統: 先祖(♂/♀ chip)+子(孫への♂chip)が実データで出る。
  await expect(page.getByRole("button", { name: new RegExp(`♂ ${seed.sireLabel}`) })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`♀ ${seed.damLabel}`) })).toBeVisible();
  await expect(page.getByRole("button", { name: seed.grandLabel, exact: true })).toBeVisible();

  // 5. 「★この個体に近い」— 形質軸空間の近傍上位を切り出す(nearestByCoord)。
  const similarBtn = page.getByRole("button", { name: "★ この個体に近い" });
  await expect(similarBtn).toBeEnabled();
  await similarBtn.click();
  await expect(page.getByText(new RegExp(`${seed.childLabel} に近い \\d+体を表示中`))).toBeVisible();

  // 6. 血統chipのノードジャンプ(実DOM・individual-finderと同じ部品): 親♂をクリック
  //    → 詳細パネルが差し替わる(先祖なし=単体登録)。
  await page.getByRole("button", { name: new RegExp(`♂ ${seed.sireLabel}`) }).click();
  await expect(page.locator(".civ-universe-rightcol").getByRole("heading", { name: seed.sireLabel })).toBeVisible();
  await expect(page.getByText("先祖の記録はありません(単体登録)。")).toBeVisible();

  // 7. individual-detail 遷移: ジャンプ後の個体(親♂)で「詳細画面を開く」。
  await page.getByRole("button", { name: "詳細画面を開く" }).click();
  await expect(page.getByRole("heading", { name: "個体の詳細" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: seed.sireLabel })).toBeVisible();
});
