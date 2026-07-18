import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { makePng } from "./make-png";

// T-67(R52裁定・caseB7実物採用): apps/web/public/finder/{finder,universe}.html —
// 原型(00-hq/dashboard/mockups/caseB7)のレイアウト/操作感そのまま・データだけ
// 実API配線(individual-finder.spec.ts / individual-universe.spec.ts と同じ縮退:
// dev-login固定actorにR2が積み上がるため、この run 専用の種タグで母集団を種族
// チップから確定する)。home→finder.html→sort→行選択→「★宇宙で見る」(別タブ)→
// universe.html(?focus)→血統発光(DOM状態)→詳細ジャンプ→individual-detail 着地
// まで実ブラウザで打鍵する。
const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(SPEC_DIR, "..", "..", "..", "docs", "planning", "c9", "screens");
const shot = (page: Page, name: string, fullPage = false) =>
  page.screenshot({ path: resolve(SHOTS, `finder-pro-${name}.png`), fullPage });

async function devLogin(page: Page) {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
}

test("caseB7実物: home→finder.html→sort→行選択→宇宙で見る→血統発光→詳細画面遷移", async ({ page, context }) => {
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

      const species = `E2E-FPRO-SP-${tag}`;
      const sireLabel = `E2E-FPRO-父-${tag}`;
      const damLabel = `E2E-FPRO-母-${tag}`;
      const childLabel = `E2E-FPRO-子-${tag}`;
      const grandLabel = `E2E-FPRO-孫-${tag}`;
      const fillerLabel = `E2E-FPRO-中-${tag}`;

      const sire = await post("/individuals", { local_label_text: sireLabel, species });
      const dam = await post("/individuals", { local_label_text: damLabel, species });
      const child = await post("/individuals", { local_label_text: childLabel, species });
      await post(`/individuals/${child.individual_id}/parents`, { parent_id: sire.individual_id, parent_role: "sire" });
      await post(`/individuals/${child.individual_id}/parents`, { parent_id: dam.individual_id, parent_role: "dam" });
      const childCap = await capture(child.individual_id, 45, 80); // 母集団最大(体長80mm)
      await uploadPhoto(childCap.capture_id as string);

      const grand = await post("/individuals", { local_label_text: grandLabel, species }); // 子孫(体長15mm=最小)
      await post(`/individuals/${grand.individual_id}/parents`, { parent_id: child.individual_id, parent_role: "sire" });
      await capture(grand.individual_id, 5, 15);

      const filler = await post("/individuals", { local_label_text: fillerLabel, species }); // 単体(体長50mm=中間)
      await capture(filler.individual_id, 10, 50);
      await capture(sire.individual_id, 40, 70);
      await capture(dam.individual_id, 20, 50);

      return {
        species,
        sireLabel,
        damLabel,
        childId: child.individual_id as string,
        childLabel,
        grandLabel,
        fillerLabel,
      };
    },
    { tag, pngBase64 },
  );

  // 1. home → 「理想の個体を探す」(R52導線: href直リンク) → finder.html。
  await page.goto(`${WEB}/`);
  await page.getByRole("link", { name: "理想の個体を探す" }).click();
  await expect(page).toHaveURL(/\/finder\/finder\.html$/);
  await expect(page.getByText("理想個体ファインダー")).toBeVisible();

  // 2. 種族チップでこの run の5体(sire+dam+子+孫+filler)に母集団を確定。
  await page.getByRole("button", { name: seed.species }).click();
  await expect(page.locator('.tabulator-row')).toHaveCount(5);
  await shot(page, "filtered", true);

  // 3. sort: 初期表示は体長降順(R52 CREED②)= 母集団最大(子・80mm)が先頭。
  await expect(page.locator('.tabulator-row').first()).toContainText(seed.childLabel);
  const lengthHeader = page.locator('[role="columnheader"]', { hasText: "体長" });
  await lengthHeader.click(); // desc→asc トグル = 母集団最小(孫・15mm)が先頭
  await expect(page.locator('.tabulator-row').first()).toContainText(seed.grandLabel);
  await lengthHeader.click(); // asc→desc に戻す
  await expect(page.locator('.tabulator-row').first()).toContainText(seed.childLabel);

  // 4. 体長 上位10%プリセット: 現在の母集団(5体)の実データ分位点 → 子のみ残る。
  await page.getByRole("button", { name: "体長 上位10%" }).click();
  await expect(page.locator('.tabulator-row')).toHaveCount(1);
  await expect(page.locator('.tabulator-row').first()).toContainText(seed.childLabel);
  await page.getByRole("button", { name: "フィルタ解除" }).click();
  await page.getByRole("button", { name: seed.species }).click();
  await expect(page.locator('.tabulator-row')).toHaveCount(5);

  // 5. 行選択 → 「★宇宙で見る」有効化。
  // Tabulatorの行間にはリサイズハンドル(.tabulator-col-resize-handle)が挟まって
  // おり、行の中心点をクリックするとそこに当たり選択が発火しないことがあるため
  // 実在するセル(.tabulator-cell)を明示してクリックする。
  const childRow = page.locator('.tabulator-row', { hasText: seed.childLabel });
  await childRow.locator(".tabulator-cell").first().click();
  await expect(page.locator("#selinfo")).toContainText(seed.childLabel);
  const universeBtn = page.getByRole("button", { name: "★ 宇宙で見る" });
  await expect(universeBtn).toBeEnabled();

  // 6. 「★宇宙で見る」は原型どおり別タブでuniverse.html(?focus=childId)を開く。
  const [uni] = await Promise.all([context.waitForEvent("page"), universeBtn.click()]);
  await uni.waitForLoadState("networkidle");
  await expect(uni).toHaveURL(new RegExp(`/finder/universe\\.html\\?focus=${seed.childId}`));

  // 7. ?focus 受信で自動フォーカス(ノード選択+血統クラス付与) — バナー+右カラム
  //    詳細パネルに反映される(実データ・実写真)。
  await expect(uni.getByText(new RegExp(`個体ファインダーからフォーカス中.*${seed.childLabel}`))).toBeVisible();
  await expect(uni.locator("#detail .d-name")).toHaveText(seed.childLabel);
  await expect(uni.locator("#selinfo")).toContainText(`先祖2 · 子孫1`);
  await expect(uni.locator("#lineageLegend")).toBeVisible();
  const thumb = uni.locator("#detail .d-img img");
  await expect(thumb).toBeVisible();
  await expect
    .poll(() => thumb.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // WebGL: 3d-force-graphが実際にキャンバスを作れたこと(フォールバック文言が
  // 出ていない・three.jsが挿入するcanvasが存在する)。
  await expect(uni.locator("#fallback")).toBeHidden();
  await expect(uni.locator("#graph3d canvas")).toBeVisible();
  await shot(uni, "focus-lineage", true);

  // 8. 血統: 先祖(sire/dam)+子孫(孫)が実データで出る。
  await expect(uni.locator("#detail .d-rel")).toContainText(seed.sireLabel);
  await expect(uni.locator("#detail .d-rel")).toContainText(seed.damLabel);
  await expect(uni.locator("#detail .d-rel")).toContainText(seed.grandLabel);

  // 9. 血統chipのノードジャンプ: 親(sire)をクリック→詳細パネルが差し替わる(先祖なし)。
  //    force: 原型CSS(#mockbadge・変更禁止)は右下固定バッジで#detail下端と同じ
  //    コーナーに重なる(caseB7原型からそのままの既存の隅)。長い実行列でTruthが
  //    積み上がり#detailのスクロール量が変わるとバッジの直下にリンクが来ることが
  //    ある。レイアウトは変えない(R52 CREED)ためテスト側でforce-clickする。
  await uni.locator("#detail .d-link", { hasText: seed.sireLabel }).click({ force: true });
  await expect(uni.locator("#detail .d-name")).toHaveText(seed.sireLabel);
  await expect(uni.locator("#detail .d-rel")).toContainText("記録なし・初代");

  // 10. individual-detail 遷移: ジャンプ後の個体(親sire)で「詳細画面を開く」。
  await uni.getByRole("button", { name: "詳細画面を開く" }).click();
  await expect(uni).toHaveURL(/\/s\/individual-detail/);
  await expect(uni.getByRole("heading", { name: "個体の詳細" })).toBeVisible();
  await uni.waitForLoadState("networkidle");
  await expect(uni.getByRole("heading", { name: seed.sireLabel })).toBeVisible();
});
