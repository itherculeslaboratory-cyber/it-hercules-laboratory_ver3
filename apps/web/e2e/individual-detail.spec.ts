import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { makePng } from "./make-png";

// 個体・種(IND)ゾーン 5画面 本実装(承認済みmockup ind-forecast.html・R128 85点の
// 逐語採用+実データ配線)の実ブラウザ検証+目視ゲート用スクリーンショット。
// 家族(♂親+♀親→子3体・1体死亡・1体羽化)と好み学習イベントを実データで作り、
// 5画面(個体の詳細=中心/累代分析/バイオカード/マッチング/種の管理)を本物の
// wrangler(local R2)+next dev 経由で描画し、両テーマ(light/dark)×両幅(1280/390)で
// 撮る。旧UI(individual-profile ノード=pre-C9)のアサーションは新UI(IndDetailNode)へ
// 置換した(screen-def が variant=ind-detail に移行したため)。
const WEB = "http://127.0.0.1:3000";
// HQ レビューキューの evidence へ直接出力(カードが参照する4枚+各画面の代表)。
const SHOTS = "D:/claude/00-hq/review-queue/evidence/ind-impl";
mkdirSync(SHOTS, { recursive: true });

async function devLogin(page: Page) {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
}

// theme.js(public/assets/theme.js)は localStorage['hqTheme'] を読んで <html data-theme>
// を刻む。テーマを固定 → 再読込 → 各幅で fullPage 撮影(HANDOFF のスクショ規約)。
async function shootAll(page: Page, url: string, base: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      try {
        localStorage.setItem("hqTheme", t);
      } catch {
        /* blocked storage */
      }
    }, theme);
    for (const w of [1280, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${SHOTS}/${base}-${theme}-${w}.png`, fullPage: true });
    }
  }
}

test("IND 5画面: 実データ配線の実ブラウザ検証+両テーマ×両幅スクショ", async ({ page }) => {
  test.setTimeout(180_000);
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
      const capture = async (individualId: string, weight: number) =>
        post("/observation/captures", {
          domain: "biology",
          subject_ref: `individual/${individualId}`,
          measurements: [{ item: "weight", kind: "number", value: weight, unit: "g", value_origin: "direct_observed" }],
        });
      const uploadPhoto = async (captureId: string) => {
        const bin = atob(pngBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const fd = new FormData();
        fd.append("capture_id", captureId);
        fd.append("file", new Blob([bytes], { type: "image/png" }), "e2e.png");
        return fetch("/api/v1/observation/upload", { method: "POST", credentials: "include", body: fd }).then((r) => r.json());
      };

      const species = "ヘラクレスオオカブト";
      const sire = await post("/individuals", { local_label_text: `父レッド-${tag}`, species });
      const dam = await post("/individuals", { local_label_text: `母-${tag}`, species });
      await capture(sire.individual_id, 140);
      await capture(sire.individual_id, 150);
      await capture(dam.individual_id, 118);
      await capture(dam.individual_id, 124);

      const a = await post("/individuals", { local_label_text: `子A-${tag}`, species });
      const b = await post("/individuals", { local_label_text: `子B-${tag}`, species });
      const c = await post("/individuals", { local_label_text: `子C-${tag}`, species });
      for (const kid of [a, b, c]) {
        await post(`/individuals/${kid.individual_id}/parents`, { parent_id: sire.individual_id, parent_role: "sire" });
        await post(`/individuals/${kid.individual_id}/parents`, { parent_id: dam.individual_id, parent_role: "dam" });
      }
      await capture(a.individual_id, 30);
      await capture(a.individual_id, 45);
      await post(`/individuals/${a.individual_id}/life-events`, { kind: "birth", at: "2025-09-14T00:00:00Z" });
      await post(`/individuals/${a.individual_id}/life-events`, {
        kind: "molt",
        at: "2026-01-20T00:00:00Z",
        detail: { to_stage: "third_early" },
      });
      const capLast = await capture(a.individual_id, 62);
      await uploadPhoto(capLast.capture_id);
      await post(`/individuals/${a.individual_id}/life-events`, { kind: "eclosion", at: "2026-06-01T00:00:00Z" });

      await capture(b.individual_id, 28);
      await capture(b.individual_id, 40);
      await post(`/individuals/${b.individual_id}/life-events`, { kind: "death", at: "2026-02-01T00:00:00Z" });
      await capture(c.individual_id, 32);
      await capture(c.individual_id, 47);

      // 好み学習イベント(マッチング画面の convergence/ranking を populate)。
      const pref = async (itemId: string, kind: string, y: number, features: number[]) =>
        post("/match/preference", { item_id: itemId, kind, y, features });
      await pref(a.individual_id, "swipe", 1, [1, 0.8, 0.6]);
      await pref(c.individual_id, "swipe", 1, [0.9, 0.7, 0.5]);
      await pref(b.individual_id, "pass", -1, [0.2, 0.1, 0.1]);

      // 種マスタ+その種に紐づく観測(種の管理画面の平均体長/体重は
      // species_candidate 一致の観測から都度計算)。個体aの詳細を汚さないよう
      // subject_ref は合成(存在しない個体ref・stats は species_candidate だけ見る)。
      const sp1 = await post("/species", { name: "ヘラクレスオオカブト" });
      const sp2 = await post("/species", { name: "オオクワガタ" });
      const spCapture = async (speciesId: string, len: number, wt: number) =>
        post("/observation/captures", {
          domain: "biology",
          subject_ref: `individual/spsample-${tag}`,
          species_candidate: speciesId,
          species_confirmed_by: "user",
          measurements: [
            { item: "length", kind: "number", value: len, unit: "mm", value_origin: "direct_observed" },
            { item: "weight", kind: "number", value: wt, unit: "g", value_origin: "direct_observed" },
          ],
        });
      for (const [l, w] of [[145, 80], [151, 85], [148, 82]]) await spCapture(sp1.species_id, l, w);
      for (const [l, w] of [[74, 26], [78, 28]]) await spCapture(sp2.species_id, l, w);

      return {
        sireId: sire.individual_id as string,
        aId: a.individual_id as string,
      };
    },
    { tag, pngBase64 },
  );

  // ── 中心画面: 個体の詳細(子A・親あり・きょうだいあり・観測3点・写真・脱皮・羽化) ──
  await page.goto(`${WEB}/s/individual-detail?id=${seed.aId}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: /この子の「今」と「物語」/ })).toBeVisible();
  await expect(page.getByText("成長のぐあい")).toBeVisible();
  await expect(page.getByText("血統の確かさ")).toBeVisible();
  await expect(page.getByText("近い血の度合い(近交)")).toBeVisible();
  await expect(page.getByText("血縁レール(親 → 自分 → 子)")).toBeVisible();
  await expect(page.getByText("誕生(孵化)")).toBeVisible();
  await shootAll(page, `${WEB}/s/individual-detail?id=${seed.aId}`, "detail");

  // ── 累代分析(親sire・子3体を集計) ──
  await page.goto(`${WEB}/s/individual-detail?id=${seed.sireId}`);
  await page.waitForLoadState("networkidle");
  await page.goto(`${WEB}/s/cross?id=${seed.sireId}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/匹 を集計/)).toBeVisible();
  await expect(page.getByText("生存率")).toBeVisible();
  await shootAll(page, `${WEB}/s/cross?id=${seed.sireId}`, "cross");

  // ── バイオカード(子A) ──
  await page.goto(`${WEB}/s/bio-card?id=${seed.aId}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("まとめて印刷")).toBeVisible();
  await expect(page.getByRole("img", { name: /QRコード:/ })).toBeVisible();
  await shootAll(page, `${WEB}/s/bio-card?id=${seed.aId}`, "bio-card");

  // ── マッチング(好み学習の状況+順位) ──
  await page.goto(`${WEB}/s/match`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/好みに近い1匹を選ぶ/)).toBeVisible();
  await shootAll(page, `${WEB}/s/match`, "match");

  // ── 種の管理(観測から自動計算した平均) ──
  await page.goto(`${WEB}/s/species`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("扱う種の基礎データ")).toBeVisible();
  await expect(page.getByText("ヘラクレスオオカブト").first()).toBeVisible();
  await shootAll(page, `${WEB}/s/species`, "species");
});
