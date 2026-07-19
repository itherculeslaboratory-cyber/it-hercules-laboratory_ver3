import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// V3-AIP-101 検索スライスA(obs-search・c7-wireframes-core5 §2 のトーン/語彙の
// み流用)。F1(着地・保存検索チップ)→F2(絞り込み展開・体長レンジ確定)→0件
// 緩和バー→保存検索の保存/再適用→バスケット選択→計測グリッドへのハンドオフ
// (obs-register-batch へプリセレクト付き遷移)を実ブラウザで打鍵まで通す
// (目視ゲート用スクリーンショット4枚)。R2 は append-only で過去の run 分が
// 累積するため、種(species)にこの run 専用タグを振って母集団を8体に確定
// し、以降の件数アサーションはその母集団に対して行う(obs-register-batch.spec
// と同じ縮退)。
const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(SPEC_DIR, "..", "..", "..", "docs", "planning", "c7", "screens");
// f1(絞り込み前・母集団が過去run累積で巨大)と basket(下部固定バスケット)は
// fullPage だと Playwright のフルページ合成が position:fixed 要素をページ中腹に
// 描き直す/巨大な壁になるアーティファクトが出るため viewport のみで撮る
// (目視ゲート向けの評価: fullPage=true は f2/zero のように短いページでのみ有効)。
const shot = (page: Page, name: string, fullPage = true) =>
  page.screenshot({ path: resolve(SHOTS, `obs-search-${name}.png`), fullPage });

async function devLogin(page: Page) {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
}

// 1x1 透明 PNG(最小の実 JPEG/PNG バイト列) — サムネ生成(jSquash)が実際に
// デコードできる実画像でテストする(thumbnail_path の表示コードパスも踏む)。
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("検索スライスA: 着地→絞り込み(体長レンジ)→0件緩和→保存検索→バスケット→計測グリッドへ", async ({ page }) => {
  await devLogin(page);

  const tag = Date.now().toString(36);
  const speciesTag = `E2E-SEARCH-SP-${tag}`;

  const seed = await page.evaluate(
    async ({ tag, speciesTag, tinyPngB64 }) => {
      const post = async (path: string, body: unknown) =>
        fetch(`/api/v1${path}`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).then((r) => r.json());

      const shelfA = await post("/placements", { label: `E2E-SEARCH-棚A-${tag}` });
      const shelfB = await post("/placements", { label: `E2E-SEARCH-棚B-${tag}` });

      type Spec = { label: string; stage: string; shelf: string; weight?: number; length?: number };
      const specs: Spec[] = [
        { label: `E2E-SEARCH-01-${tag}`, stage: "third_late", shelf: shelfA.placement_id, weight: 10, length: 40 },
        { label: `E2E-SEARCH-02-${tag}`, stage: "third_mid", shelf: shelfA.placement_id, weight: 20, length: 50 },
        { label: `E2E-SEARCH-03-${tag}`, stage: "third_early", shelf: shelfA.placement_id, weight: 30, length: 60 },
        { label: `E2E-SEARCH-04-${tag}`, stage: "adult", shelf: shelfA.placement_id, weight: 40, length: 70 },
        { label: `E2E-SEARCH-05-${tag}`, stage: "adult", shelf: shelfB.placement_id, weight: 50, length: 80 },
        { label: `E2E-SEARCH-06-${tag}`, stage: "pupa", shelf: shelfB.placement_id, weight: 60, length: 90 },
        { label: `E2E-SEARCH-07-${tag}`, stage: "prepupa", shelf: shelfB.placement_id, weight: 70, length: 100 },
        { label: `E2E-SEARCH-08-${tag}`, stage: "second", shelf: shelfB.placement_id }, // 観測ゼロ
      ];

      const ids: string[] = [];
      let ind1CaptureId = "";
      for (const s of specs) {
        const ind = await post("/individuals", { local_label_text: s.label, species: speciesTag });
        const id = ind.individual_id as string;
        ids.push(id);
        await post("/occupancy", { placement_id: s.shelf, subject_ref: `individual/${id}` });
        await post(`/individuals/${id}/life-events`, { kind: "molt", at: new Date().toISOString(), detail: { to_stage: s.stage } });
        if (s.weight != null && s.length != null) {
          const cap = await post("/observation/captures", {
            domain: "biology",
            subject_ref: `individual/${id}`,
            measurements: [
              { item: "weight", kind: "number", value: s.weight, unit: "g", value_origin: "direct_observed" },
              { item: "length", kind: "number", value: s.length, unit: "mm", value_origin: "direct_observed" },
            ],
          });
          if (s.label.endsWith(`01-${tag}`)) ind1CaptureId = cap.capture_id as string;
        }
        if (s.label.includes("04-") || s.label.includes("05-")) {
          await post(`/individuals/${id}/life-events`, { kind: "eclosion", at: "2026-06-01T00:00:00Z" });
        }
      }

      // ind1 の capture に実写真を1枚添付(thumbnail_path の表示コードパス確認).
      if (ind1CaptureId) {
        const bytes = Uint8Array.from(atob(tinyPngB64), (c) => c.charCodeAt(0));
        const fd = new FormData();
        fd.append("capture_id", ind1CaptureId);
        fd.append("file", new Blob([bytes], { type: "image/png" }), "p.png");
        await fetch("/api/v1/observation/upload", { method: "POST", credentials: "include", body: fd });
      }

      return {
        ids,
        shelfALabel: shelfA.label as string,
        labels: specs.map((s) => s.label),
      };
    },
    { tag, speciesTag, tinyPngB64: TINY_PNG_B64 },
  );
  expect(seed.ids).toHaveLength(8);

  // 1. 着地: 保存フィルタなし → 全件表示(件数は R2 累積で変動するので存在
  //    確認のみ)。
  await page.goto(`${WEB}/s/obs-search`);
  await expect(page.getByRole("heading", { name: "検索" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/\d+個体 \/ \d+枚/)).toBeVisible();
  await shot(page, "f1", false);

  // 絞り込みを開き、種/ステージ/棚チップが実在庫の値(プレースホルダでない)
  // で描画されていることを確認する。
  await page.getByRole("button", { name: /絞り込み/ }).click();
  await expect(page.getByRole("button", { name: new RegExp(speciesTag) })).toBeVisible();
  await expect(page.getByRole("button", { name: /成虫/ })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(seed.shelfALabel) })).toBeVisible();

  // 種チップでこの run の8体だけに母集団を確定する(以降のアサーションが
  // 決定的になる)。
  await page.getByRole("button", { name: new RegExp(speciesTag) }).click();
  await expect(page.getByText("8個体 / 7枚")).toBeVisible();

  // 2. 体長 70±5 → ind4(length=70)だけが該当 → 1個体。
  await page.getByLabel("体長(mm)").fill("70");
  await page.getByLabel("体長の幅").fill("5");
  await page.getByLabel("体長の幅").press("Tab");
  await expect(page.getByText("1個体 / 1枚")).toBeVisible();
  await shot(page, "f2");

  // 3. 0件になる組み合わせへ押し込む → 緩和バーが1タップ導線を出す。
  await page.getByLabel("体長(mm)").fill("9999");
  await page.getByLabel("体長の幅").fill("1");
  await page.getByLabel("体長の幅").press("Tab");
  await expect(page.getByText("0個体 / 0枚")).toBeVisible();
  await expect(page.getByRole("button", { name: /体長の範囲を外す/ })).toBeVisible();
  await shot(page, "zero");

  // 4. 緩和バーの1タップで復帰 → 母集団8体に戻る。
  await page.getByRole("button", { name: /体長の範囲を外す/ }).click();
  await expect(page.getByText("8個体 / 7枚")).toBeVisible();

  // 5. 現在条件(種フィルタのみ)を保存検索チップとして保存.
  const savedName = `E2E-検索条件-${tag}`;
  page.once("dialog", (dialog) => dialog.accept(savedName));
  await page.getByRole("button", { name: "＋今の条件を保存" }).click();
  await expect(page.getByRole("button", { name: savedName, exact: true })).toBeVisible();

  // 条件を変える(ステージ「成虫」を追加)→ 保存チップに未保存(✱)が付く.
  await page.getByRole("button", { name: /^成虫\(/ }).click();
  await expect(page.getByRole("button", { name: `${savedName} ✱`, exact: true })).toBeVisible();

  // 保存チップに戻る → 保存時の条件(ステージ解除)が再適用される.
  await page.getByRole("button", { name: `${savedName} ✱`, exact: true }).click();
  await expect(page.getByText("8個体 / 7枚")).toBeVisible();
  await expect(page.getByRole("button", { name: savedName, exact: true })).toBeVisible();

  // 6. 3個体をチェック → バスケットに3チップ.
  for (const label of [seed.labels[0], seed.labels[1], seed.labels[2]]) {
    await page.getByLabel(`${label} を選択`).check();
  }
  await expect(page.locator(".civ-basket-chip")).toHaveCount(3);
  await shot(page, "basket", false);

  // 7. 計測グリッドへ → obs-register-batch に同じ3体がプリセレクト済みで遷移.
  await page.getByRole("button", { name: /計測グリッドへ/ }).click();
  await expect(page.getByRole("heading", { name: "まとめて記録" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  for (const label of [seed.labels[0], seed.labels[1], seed.labels[2]]) {
    await expect(page.getByLabel(`${label} を選択`)).toBeChecked();
  }
});
