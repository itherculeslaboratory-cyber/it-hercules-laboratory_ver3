import { test, expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { makePng } from "./make-png";

// design-c2 §7 E2E. ONE real-browser walkthrough of the whole observation
// lifecycle (the explicit §7 scenario), driven through the ScreenDef Renderer
// against the real worker + R2-local, authenticated by the in-screen dev-login
// button whose HttpOnly session cookie flows same-origin via the Next rewrite
// (next.config.mjs). A 2nd suite hits the API directly to pin the fine-grained
// Truth semantics (sha256 / actor stamping / media round-trip) the UI doesn't
// assert field-by-field.

const API = "http://127.0.0.1:8787";
const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(SPEC_DIR, "..", "..", "..", "docs", "planning", "c2", "e2e-screenshots");
const shot = (page: Page, name: string) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) });

// Append-only R2 persists across runs, so pin this run to a fresh individual —
// history-count assertions must see only what THIS run wrote.
const bareId = `e2e-${Date.now().toString(36)}`;
const subjectRef = `individual/${bareId}`;

test("browser walkthrough: dev-login → capture(+photo) → detail → individual → QR → /qr resume → 2nd capture", async ({
  page,
}) => {
  // 1. login screen → in-screen dev-login button (V3-AUT-05). The button POSTs
  //    /auth/dev-login same-origin; the Set-Cookie session then authenticates
  //    every protected call below purely through the browser cookie jar.
  await page.goto(`${WEB}/s/login`);
  await expect(page.getByRole("heading", { name: "IHL にログイン" })).toBeVisible();
  await expect(page.getByRole("button", { name: "開発トークンでログイン" })).toBeVisible();
  await shot(page, "01-login");
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
  await shot(page, "02-home");

  // 2. home → obs-entry 直行(V3-UIX-02 3クリック導線・K4)。domain は obs-entry が
  //    自前収集するため domain-select 画面はガイド用の並行導線(リンク存在のみ確認)。
  await expect(page.getByRole("link", { name: "ドメインから選んで始める" })).toBeVisible();
  await page.getByRole("button", { name: "観測を始める" }).click();
  await expect(page.getByRole("heading", { name: "観測を記録する" })).toBeVisible();
  await shot(page, "03-obs-entry-direct");
  // Gate on hydration before submitting: a click before the client bundle
  // attaches onSubmit does a native GET form submit (no capture is created).
  await page.waitForLoadState("networkidle");
  await shot(page, "04-obs-entry-empty");

  // 3. fill the capture form: domain + measurement + species + sire/dam + the
  //    subject individual (V3-IND-01) + attach a script-generated PNG.
  await page.getByLabel("観測ドメイン").selectOption("biology");
  await page.getByLabel("種の候補").fill("Dynastes hercules");
  await page.getByLabel("計測項目").fill("体長");
  await page.getByLabel("計測値").fill("65");
  await page.getByLabel("対象個体 ID").fill(subjectRef);
  await page.getByLabel("父個体 ID").fill("individual/sire-001");
  await page.getByLabel("母個体 ID").fill("individual/dam-001");
  await page.getByLabel("写真").setInputFiles({ name: "e2e.png", mimeType: "image/png", buffer: makePng() });
  await shot(page, "05-obs-entry-filled");

  // 4. submit via the mandatory confirm step (OBS-25, K1): 確認へ進む → obs-confirm
  //    → 登録する → 2-stage POST (capture then photo upload) → obs-detail
  await page.getByRole("button", { name: "確認へ進む" }).click();
  await expect(page.getByRole("heading", { name: "観測を確認する" })).toBeVisible();
  await page.waitForLoadState("networkidle"); // hydration gate before commit (see step 2)
  await shot(page, "05b-obs-confirm");
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("heading", { name: "観測の詳細" })).toBeVisible();
  const capture1Id = new URL(page.url()).searchParams.get("id")!;
  expect(capture1Id).toBeTruthy();

  // obs-detail renders the REAL projection (design-c2 §3.2), not a mock.
  await expect(page.getByText("ドメイン: biology")).toBeVisible();
  await expect(page.getByText(/体長: 65/)).toBeVisible();
  const photo = page.locator("img.civ-image").first();
  await expect(photo).toBeVisible();
  // the photo blob actually round-tripped (naturalWidth>0 ⇒ image decoded).
  await expect
    .poll(() => photo.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await shot(page, "06-obs-detail");

  // 5. follow the real link (href carries the bare individual id from the
  //    projection) → individual-detail lists this individual's observation.
  const indLink = page.getByRole("link", { name: "個体詳細を開く" });
  await expect(indLink).toHaveAttribute("href", `/s/individual-detail?id=${bareId}`);
  await indLink.click();
  await expect(page.getByRole("heading", { name: "個体の詳細" })).toBeVisible();
  // individual-detail's species badge comes from the individual MASTER record
  // (profile.species), not the capture's species_candidate — and this subject_ref
  // was never explicitly registered via POST /individuals, so no master exists
  // here (design-k1 individual-routes.ts projectIndividualProfile). The change-
  // point timeline (TimelineRow, renderer.tsx) also never re-prints the raw
  // measurement item text — only value+unit (see individual-detail.spec.ts d4's
  // `/62g/` check) — and this obs-entry flow attaches no unit, so the visible
  // token is the bare value. Scope to the timeline list to avoid matching "65"
  // elsewhere (e.g. inside the generated id).
  await expect(page.locator(".civ-timeline").getByText("65")).toBeVisible();

  // 6. issue a QR label; the qr-code node renders the freshly-issued token.
  await page.getByRole("button", { name: "QR ラベルを発行する" }).click();
  const qr = page.getByRole("img", { name: /QRコード:/ });
  await expect.poll(() => qr.getAttribute("aria-label")).toMatch(/QRコード: [A-Za-z0-9_-]{20,200}/);
  const token = (await qr.getAttribute("aria-label"))!.replace("QRコード: ", "").trim();
  await shot(page, "07-individual-detail");

  // 7. open the physical label target /qr/<token> → resolves to the individual.
  await page.goto(`${WEB}/qr/${token}`);
  await expect(page.getByRole("heading", { name: "個体が見つかりました" })).toBeVisible();
  await expect(page.getByText(`個体 ID: ${bareId}`)).toBeVisible();
  await shot(page, "08-qr-resume");

  // 8. resume → create a 2nd observation in the same individual context.
  await page.getByRole("button", { name: "この個体で観測を続ける" }).click();
  await expect(page.getByRole("heading", { name: "観測を記録する" })).toBeVisible();
  await page.waitForLoadState("networkidle"); // hydration gate (see step 2)
  await page.getByLabel("観測ドメイン").selectOption("biology");
  await page.getByLabel("計測項目").fill("体重");
  await page.getByLabel("計測値").fill("32");
  await page.getByLabel("対象個体 ID").fill(subjectRef);
  await page.getByRole("button", { name: "確認へ進む" }).click();
  await expect(page.getByRole("heading", { name: "観測を確認する" })).toBeVisible();
  await page.waitForLoadState("networkidle"); // hydration gate before commit (see step 4)
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("heading", { name: "観測の詳細" })).toBeVisible();
  const capture2Id = new URL(page.url()).searchParams.get("id")!;
  await expect(page.getByText(/体重: 32/)).toBeVisible();
  await shot(page, "09-obs-detail-2");

  // 9. the individual history now shows BOTH captures — persisted in real Truth.
  await page.goto(`${WEB}/s/individual-detail?id=${bareId}`);
  const timeline = page.locator(".civ-timeline");
  await expect(timeline.getByText("65")).toBeVisible();
  await expect(timeline.getByText("32")).toBeVisible();

  // Enumerate Truth keys via a same-origin authenticated read (proves the
  // browser cookie authenticates; yields photo_id for the key list).
  const detail = await page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/observation/${id}`, { credentials: "include" });
    return (await r.json()) as { photos: Array<{ photo_id: string }> };
  }, capture1Id);
  const photoId = detail.photos[0].photo_id;
  const truthKeys = {
    capture_1: `truth/ihl.obs.capture.v1/${capture1Id}.json`,
    photo_event: `truth/ihl.obs.photo.v1/${capture1Id}-${photoId}.json`,
    photo_blob: `media/photo/${photoId}`,
    qr: `truth/ihl.ind.qr.v1/${token}.json`,
    capture_2: `truth/ihl.obs.capture.v1/${capture2Id}.json`,
  };
  expect(detail.photos).toHaveLength(1);
  console.log("E2E_INDIVIDUAL_ID=" + bareId);
  console.log("E2E_TRUTH_KEYS_JSON=" + JSON.stringify(truthKeys));
});

test("API semantics guard: magic-link auth → capture → photo → detail → QR resume → 2nd capture", async () => {
  const anon: APIRequestContext = await request.newContext({ baseURL: API });
  // Fresh individual per run (append-only R2 persists) so the history count is
  // exactly what this suite writes.
  const individualId = `api-${Date.now().toString(36)}`;

  const mlRes = await anon.post("/api/v1/auth/magic-link", { data: { email: "E2E@IHL.Local" } });
  expect(mlRes.status()).toBe(202);
  const ml = await mlRes.json();
  expect(ml.sent).toBe(true);
  expect(typeof ml.dev_magic_token).toBe("string");

  const verifyRes = await anon.post("/api/v1/auth/verify", { data: { token: ml.dev_magic_token } });
  expect(verifyRes.status()).toBe(200);
  const actorId = (await verifyRes.json()).actor_id;

  const setCookie = verifyRes.headersArray().find((h) => h.name.toLowerCase() === "set-cookie");
  expect(setCookie, "verify must Set-Cookie ihl_session").toBeTruthy();
  const cookie = setCookie!.value;
  expect(cookie).toMatch(/^ihl_session=/);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  const sessionToken = cookie.slice("ihl_session=".length).split(";")[0];
  expect(sessionToken).toMatch(/^v1\./);

  const api: APIRequestContext = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${sessionToken}` },
  });

  const sess = await api.get("/api/v1/auth/session");
  expect(await sess.json()).toEqual({ authenticated: true, actor_id: actorId });
  expect((await anon.get(`/api/v1/individuals/${individualId}/observations`)).status()).toBe(401);
  await anon.dispose();

  const cap1Res = await api.post("/api/v1/observation/captures", {
    data: {
      domain: "biology",
      subject_ref: `individual/${individualId}`,
      sire_id: "individual/sire-001",
      dam_id: "individual/dam-001",
      species_candidate: "Dynastes hercules",
      species_confirmed_by: "user",
      measurements: [{ item: "体長", kind: "number", value: 65, unit: "mm" }],
    },
  });
  expect(cap1Res.status()).toBe(202);
  const captureId = (await cap1Res.json()).capture_id;
  expect(captureId).toBeTruthy();

  const png = makePng();
  const upRes = await api.post("/api/v1/observation/upload", {
    multipart: { capture_id: captureId, file: { name: "e2e.png", mimeType: "image/png", buffer: png } },
  });
  expect(upRes.status()).toBe(202);
  const { photo_id: photoId, sha256 } = await upRes.json();
  expect(sha256).toMatch(/^[0-9a-f]{64}$/);

  const detailRes = await api.get(`/api/v1/observation/${captureId}`);
  expect(detailRes.status()).toBe(200);
  const detail = await detailRes.json();
  expect(detail.capture.domain).toBe("biology");
  expect(detail.capture.measurements[0]).toMatchObject({ item: "体長", value: 65, unit: "mm" });
  expect(detail.capture.actor_id).toBe(actorId);
  expect(detail.individual_id).toBe(individualId); // bare-id projection (obs-detail link)
  expect(detail.photos).toHaveLength(1);
  expect(detail.photos[0].media_key).toBe(`media/photo/${photoId}`);

  const imgRes = await api.get(`/api/v1/observation/${captureId}/image/${photoId}`);
  expect(imgRes.status()).toBe(200);
  expect(imgRes.headers()["content-type"]).toContain("image/png");
  expect((await imgRes.body()).length).toBe(png.length);

  const qrRes = await api.post(`/api/v1/individuals/${individualId}/qr`, { data: {} });
  expect(qrRes.status()).toBe(202);
  const qrToken = (await qrRes.json()).token;
  expect(qrToken).toMatch(/^[A-Za-z0-9_-]{20,200}$/);

  const resolveRes = await api.get(`/api/v1/qr/${qrToken}`);
  expect(resolveRes.status()).toBe(200);
  expect((await resolveRes.json()).individual_id).toBe(individualId);

  const cap2Res = await api.post("/api/v1/observation/captures", {
    data: {
      domain: "biology",
      subject_ref: `individual/${individualId}`,
      measurements: [{ item: "体重", kind: "number", value: 32, unit: "g" }],
    },
  });
  expect(cap2Res.status()).toBe(202);

  const histRes = await api.get(`/api/v1/individuals/${individualId}/observations`);
  expect(histRes.status()).toBe(200);
  expect((await histRes.json()).observations).toHaveLength(2);
  await api.dispose();
});
