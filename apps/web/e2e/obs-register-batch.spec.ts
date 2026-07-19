import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// V3-AIP-101 観測登録スライス2(c7-wireframes-core5 §F3/F4/F5/F6・バッチ)。
// F3(割り出し・クラッチ一括)→F4(まとめて記録: フィルタ・そろそろプリセレクト・
// 計測グリッド・クラッチ照合/昇格)→F5b(バッチ確認: サマリ+注意行)→F6b(バッチ
// 完了: Δ+次の目安+クラッチ結果)を実ブラウザで打鍵まで通す(目視ゲート用
// スクリーンショット5枚)。バックエンド(クラッチ/batch-commit/occupancy start-end
// /individuals拡張)はコミット 2329559 で完成済み — このテストはフロントの結線
// を検証する。
const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(SPEC_DIR, "..", "..", "..", "docs", "planning", "c7", "screens");
const shot = (page: Page, name: string) =>
  page.screenshot({ path: resolve(SHOTS, `obs-register-v4a-${name}.png`), fullPage: true });

async function devLogin(page: Page) {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
}

test("観測登録スライス2: F3(割り出し)→F4(まとめて記録)→F5b(確認)→F6b(完了)", async ({ page }) => {
  await devLogin(page);

  // 1. 個体4体(棚2つ・ステージ違い・うち2体は前回capture付き)+クラッチ2件
  //    (照合用72匹・昇格用8匹)を API で seed。この run 専用ラベルで一意にする。
  const tag = Date.now().toString(36);
  const seed = await page.evaluate(async (tag) => {
    const post = async (path: string, body: unknown) =>
      fetch(`/api/v1${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());

    const shelfA = await post("/placements", { label: `E2E-棚A-${tag}` });
    const shelfB = await post("/placements", { label: `E2E-棚B-${tag}` });

    const makeIndividual = async (label: string, placementId: string, stage: string) => {
      const ind = await post("/individuals", { local_label_text: label, species: "Dynastes hercules" });
      await post("/occupancy", { placement_id: placementId, subject_ref: `individual/${ind.individual_id}` });
      await post(`/individuals/${ind.individual_id}/life-events`, { kind: "molt", at: new Date().toISOString(), detail: { to_stage: stage } });
      return ind.individual_id as string;
    };

    const ind1 = await makeIndividual(`E2E-BATCH-017-${tag}`, shelfA.placement_id, "third_late");
    await post("/observation/captures", {
      domain: "biology",
      subject_ref: `individual/${ind1}`,
      measurements: [{ item: "weight", kind: "number", value: 82.5, unit: "g", value_origin: "direct_observed" }],
    });
    const ind2 = await makeIndividual(`E2E-BATCH-025-${tag}`, shelfA.placement_id, "third_mid");
    await post("/observation/captures", {
      domain: "biology",
      subject_ref: `individual/${ind2}`,
      measurements: [{ item: "weight", kind: "number", value: 59.3, unit: "g", value_origin: "direct_observed" }],
    });
    // ind3/ind4: 一度もお世話記録がない(=最終お世話 null)→「そろそろ」プリセレクト対象。
    const ind3 = await makeIndividual(`E2E-BATCH-031-${tag}`, shelfB.placement_id, "third_early");
    const ind4 = await makeIndividual(`E2E-BATCH-040-${tag}`, shelfB.placement_id, "adult");

    const clutchA = await post("/clutches", {
      harvested_at: new Date().toISOString().slice(0, 10),
      initial_count: 72,
      species: "Dynastes hercules",
      container_label: `E2E-CLA-${tag}`,
    });
    const clutchB = await post("/clutches", {
      harvested_at: new Date().toISOString().slice(0, 10),
      initial_count: 8,
      species: "Dynastes hercules",
      container_label: `E2E-CLB-${tag}`,
    });

    return {
      shelfALabel: shelfA.label as string,
      ind1Label: `E2E-BATCH-017-${tag}`,
      ind3Label: `E2E-BATCH-031-${tag}`,
      ind4Label: `E2E-BATCH-040-${tag}`,
      clutchAId: clutchA.clutch_id as string,
      clutchBId: clutchB.clutch_id as string,
    };
  }, tag);
  expect(seed.clutchAId).toBeTruthy();
  expect(seed.clutchBId).toBeTruthy();

  // 2. F3: 割り出し(親は後からリンク・匹数94・抜き取り計測10匹/21g→平均2.1g).
  await page.goto(`${WEB}/s/obs-register-clutch`);
  await expect(page.getByRole("heading", { name: "割り出し — 新しいクラッチ" })).toBeVisible();
  await page.getByRole("radio", { name: "親は後からリンク" }).check();
  await page.getByLabel(/匹数/).fill("94");
  await page.getByRole("button", { name: /抜き取り計測/ }).click();
  await page.getByLabel("匹まとめて載せる").fill("10");
  await page.getByLabel("総重量(g)").fill("21");
  await expect(page.getByText("平均 2.1g(自動計算)")).toBeVisible();
  await shot(page, "f3");
  await page.getByRole("button", { name: "確認へ →" }).click();
  await expect(page.getByRole("heading", { name: "保存しました" })).toBeVisible();
  await expect(page.getByText("現在 94匹")).toBeVisible();
  await expect(page.getByText(/抜き取り10匹の平均 2\.1g/)).toBeVisible();

  // 3. F4: まとめて記録(フィルタ・そろそろプリセレクト・グリッド入力・
  //    クラッチ照合72→68・昇格8体).
  await page.getByRole("button", { name: "まとめて記録へ" }).click();
  await expect(page.getByRole("heading", { name: "まとめて記録" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  // フィルタ: 棚Aで絞ると一覧行は2件だけになる(計測グリッドはチェック済みを
  // 引き続き表示する設計なので、一覧行=civ-roster-row でスコープして確認).
  await page.getByLabel("棚で絞り込み").selectOption({ label: seed.shelfALabel });
  await expect(page.locator("li.civ-roster-row", { hasText: seed.ind1Label })).toHaveCount(1);
  await expect(page.locator("li.civ-roster-row", { hasText: seed.ind3Label })).toHaveCount(0);
  await page.getByLabel("棚で絞り込み").selectOption({ index: 0 }); // フィルタ解除

  // そろそろ: 一度もお世話記録がない2体がプリセレクト済み(R2 は append-only
  // で過去の run 分も累積するため、件数は"2件以上"の中立表現の存在だけ確認
  // し、実体は個々のチェック状態で検証する).
  await expect(page.getByText(/そろそろ: \d+件\(前回から間隔が空いている子\)/)).toBeVisible();
  await expect(page.getByLabel(`${seed.ind3Label} を選択`)).toBeChecked();
  await expect(page.getByLabel(`${seed.ind4Label} を選択`)).toBeChecked();
  await expect(page.getByLabel(`${seed.ind1Label} を選択`)).not.toBeChecked();

  // グリッド入力: ind1 を追加選択し、体重を前回比マイナスに(注意行を作る).
  await page.getByLabel(`${seed.ind1Label} を選択`).check();
  await page.getByLabel(`${seed.ind1Label} 体重g`).fill("80.0");
  await expect(page.getByText("-2.5g")).toBeVisible();

  // クラッチ照合(72→68・死亡4)とクラッチ昇格(8体)を同時に開いた状態でスクショ.
  const clutchARow = page.locator("li.civ-roster-row", { hasText: `E2E-CLA-${tag}` });
  const clutchBRow = page.locator("li.civ-roster-row", { hasText: `E2E-CLB-${tag}` });
  await clutchARow.getByRole("button", { name: "匹数を照合…" }).click();
  await clutchBRow.getByRole("button", { name: "個別容器へ分割(昇格)…" }).click();
  await shot(page, "f4b");

  await clutchARow.getByLabel("今日数えた数").fill("68");
  await clutchARow.getByRole("button", { name: "確認へ積む" }).click();
  await expect(clutchARow.getByText("匹数を照合済み: 72→68匹(死亡4)")).toBeVisible();

  await clutchBRow.getByLabel("今日カップに分けた数").fill("8");
  await clutchBRow.getByRole("button", { name: "昇格する" }).click();
  await expect(clutchBRow.getByText("8体を個体化しました")).toBeVisible();

  // 昇格は他の一括操作(move等)と同じくローカルにステージされるだけで、
  // この時点ではまだ API に書き込まれない(F4 即時POSTの廃止契約)— API を
  // 直接叩いて current_count が発行前の 8 のまま不変であることを確認する。
  const clutchBBeforeSave = await page.evaluate(
    (id) => fetch(`/api/v1/clutches/${id}`, { credentials: "include" }).then((r) => r.json()),
    seed.clutchBId,
  );
  expect(clutchBBeforeSave.current_count).toBe(8);

  await shot(page, "f4");
  await page.getByRole("button", { name: "確認へ →" }).click();

  // 4. F5b: サマリ+注意行(Δマイナス)。計測件数は R2 が append-only で過去の
  //    run 分の「そろそろ」対象個体も累積プリセレクトされるため中立表現の
  //    存在だけを確認する(実体はΔ行の内容で検証)。
  await expect(page.getByRole("heading", { name: "確認" })).toBeVisible();
  await expect(page.getByText(/✓ 計測 \d+件/)).toBeVisible();
  await expect(page.getByText(/✓ クラッチ照合 1件/)).toBeVisible();
  await expect(page.getByText(/✓ クラッチ昇格 1件/)).toBeVisible();
  await expect(page.getByText(/この1件だけ見てください/)).toBeVisible();
  await expect(page.getByText(new RegExp(`${seed.ind1Label}.*-2\\.5g`))).toBeVisible();
  await shot(page, "f5b");
  const saveButton = page.getByRole("button", { name: /件を一括保存/ });
  await saveButton.click();

  // 5. F6b: Δ+次の目安+クラッチ結果.
  await expect(page.getByRole("heading", { name: "保存しました — 今日の成長" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(new RegExp(`${seed.ind1Label}`))).toBeVisible();
  await expect(page.getByText("-2.5g")).toBeVisible();
  await expect(page.getByText(/72→68匹\(死亡4\)/)).toBeVisible();
  await expect(page.getByText(/8体を昇格/)).toBeVisible();
  await expect(page.getByText(/✓ 次の目安 登録済み — \d+件/)).toBeVisible();
  await shot(page, "f6b");

  // 一括保存が完了して初めて昇格が反映される(遅延コミットの契約): 保存前は
  // current_count=8 のままだったのが、保存後は 8 体分の個体化で 0 になる。
  const clutchBAfterSave = await page.evaluate(
    (id) => fetch(`/api/v1/clutches/${id}`, { credentials: "include" }).then((r) => r.json()),
    seed.clutchBId,
  );
  expect(clutchBAfterSave.current_count).toBe(0);
});
