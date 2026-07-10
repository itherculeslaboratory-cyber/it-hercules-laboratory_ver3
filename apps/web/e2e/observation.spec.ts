import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { makePng } from "./make-png";

// design-c2 §7 E2E. Two layers, honestly separated:
//  (1) UI foundation — the ScreenDef renderer renders all 7 MVP screens and
//      client-side navigation (the fixed screen_id→route mapping) works.
//  (2) Observation data pipeline — the real worker + R2-local, authenticated
//      through the magic-link→verify cookie path (§1.3), exercised end to end.
// Browser→API auth over the split dev origin (:3000→:8787) needs CORS +
// cross-site cookies, which are a design decision (see e2e-evidence.md
// "Unresolved"), so the data pipeline runs against the API origin directly.

const API = "http://127.0.0.1:8787";
const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(SPEC_DIR, "..", "..", "..", "docs", "planning", "c2", "e2e-screenshots");
const shot = (name: string) => resolve(SHOTS, `${name}.png`);

test("UI foundation: all 7 MVP screens render and navigation is wired", async ({ page }) => {
  // login
  await page.goto(`${WEB}/s/login`);
  await expect(page.getByRole("heading", { name: "IHL にログイン" })).toBeVisible();
  await expect(page.getByLabel("メールアドレス *")).toBeVisible();
  await expect(page.getByRole("button", { name: "ログインリンクを送る" })).toBeVisible();
  await expect(page.getByRole("button", { name: "開発トークンでログイン" })).toBeVisible();
  await page.screenshot({ path: shot("01-login") });

  // home
  await page.goto(`${WEB}/`);
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
  await page.screenshot({ path: shot("02-home") });

  // home → obs-domain-select (client navigation via fixed screen_id→route map)
  await Promise.all([
    page.waitForURL("**/s/obs-domain-select"),
    page.getByRole("button", { name: "観測を始める" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "何を観測しますか？" })).toBeVisible();
  await page.screenshot({ path: shot("03-obs-domain-select") });

  // domain=生き物 (biology) → obs-entry
  await Promise.all([
    page.waitForURL("**/s/obs-entry"),
    page.getByRole("button", { name: "生き物" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "観測を記録する" })).toBeVisible();
  await page.screenshot({ path: shot("04-obs-entry-empty") });

  // fill measurement + sire/dam (V3-IND-01) — proves the field regime renders/accepts input
  await page.getByLabel("種の候補（任意・ユーザー入力）").fill("Dynastes hercules");
  await page.getByLabel("計測項目 *").fill("体長");
  await page.getByLabel("計測値 *").fill("65");
  await page.getByLabel("父個体 ID（任意）").fill("individual/sire-001");
  await page.getByLabel("母個体 ID（任意）").fill("individual/dam-001");
  await page.screenshot({ path: shot("05-obs-entry-filled") });

  // remaining MVP screens (static projections render as a foundation)
  await page.goto(`${WEB}/s/obs-detail`);
  await expect(page.getByRole("heading", { name: "観測の詳細" })).toBeVisible();
  await page.screenshot({ path: shot("06-obs-detail") });

  await page.goto(`${WEB}/s/individual-detail`);
  await expect(page.getByRole("heading", { name: "個体の詳細" })).toBeVisible();
  await expect(page.getByRole("img")).toBeVisible(); // QR svg node
  await page.screenshot({ path: shot("07-individual-detail") });

  await page.goto(`${WEB}/s/qr-resume`);
  await expect(page.getByRole("heading", { name: "個体が見つかりました" })).toBeVisible();
  await page.screenshot({ path: shot("08-qr-resume") });
});

test("observation data pipeline: magic-link auth → capture → photo → detail → QR resume → 2nd capture", async () => {
  const anon: APIRequestContext = await request.newContext({ baseURL: API });
  const individualId = "e2e-ind-001";

  // ---- magic-link path (§1.3/§1.4): magic-link → dev_magic_token → verify → session
  const mlRes = await anon.post("/api/v1/auth/magic-link", { data: { email: "E2E@IHL.Local" } });
  expect(mlRes.status()).toBe(202);
  const ml = await mlRes.json();
  expect(ml.sent).toBe(true);
  expect(typeof ml.dev_magic_token).toBe("string"); // IHL_DEV_EXPOSE_MAGIC_TOKEN=1

  const verifyRes = await anon.post("/api/v1/auth/verify", { data: { token: ml.dev_magic_token } });
  expect(verifyRes.status()).toBe(200);
  const actorId = (await verifyRes.json()).actor_id;
  expect(typeof actorId).toBe("string");

  // verify issues the session as an HttpOnly cookie (§1.3). Assert the cookie
  // contract, then reuse that same stateless token as `Authorization: Bearer`
  // — the exact form §1.3 provides for API/E2E clients (Playwright's API client
  // drops Secure cookies over http, so Bearer is the contract-sanctioned path).
  const setCookie = verifyRes.headersArray().find((h) => h.name.toLowerCase() === "set-cookie");
  expect(setCookie, "verify must Set-Cookie ihl_session").toBeTruthy();
  const cookie = setCookie!.value;
  expect(cookie).toMatch(/^ihl_session=/);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  const sessionToken = cookie.slice("ihl_session=".length).split(";")[0];
  expect(sessionToken).toMatch(/^v1\./);

  // authenticated context: the magic-link-issued session token as Bearer
  const api: APIRequestContext = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${sessionToken}` },
  });

  // the session token authenticates protected routes; without it, 401
  const sess = await api.get("/api/v1/auth/session");
  expect(await sess.json()).toEqual({ authenticated: true, actor_id: actorId });
  expect((await anon.get(`/api/v1/individuals/${individualId}/observations`)).status()).toBe(401);
  await anon.dispose();

  // ---- capture #1 (domain=biology, measurements, sire/dam, subject_ref)
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

  // ---- photo upload (multipart, script-generated PNG) → sha256 → putBlob
  const png = makePng();
  const upRes = await api.post("/api/v1/observation/upload", {
    multipart: {
      capture_id: captureId,
      file: { name: "e2e.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(upRes.status()).toBe(202);
  const { photo_id: photoId, sha256 } = await upRes.json();
  expect(sha256).toMatch(/^[0-9a-f]{64}$/);

  // ---- detail projection: capture measurements + the photo appear
  const detailRes = await api.get(`/api/v1/observation/${captureId}`);
  expect(detailRes.status()).toBe(200);
  const detail = await detailRes.json();
  expect(detail.capture.domain).toBe("biology");
  expect(detail.capture.measurements[0]).toMatchObject({ item: "体長", value: 65, unit: "mm" });
  expect(detail.capture.actor_id).toBe(actorId); // V3-AUT-17 session-stamped
  expect(detail.photos).toHaveLength(1);
  expect(detail.photos[0].media_key).toBe(`media/photo/${photoId}`);

  // media blob round-trips as image/png
  const imgRes = await api.get(`/api/v1/observation/${captureId}/image/${photoId}`);
  expect(imgRes.status()).toBe(200);
  expect(imgRes.headers()["content-type"]).toContain("image/png");
  expect((await imgRes.body()).length).toBe(png.length);

  // ---- QR issue for the individual → resolve back to the individual context
  const qrRes = await api.post(`/api/v1/individuals/${individualId}/qr`, { data: {} });
  expect(qrRes.status()).toBe(202);
  const token = (await qrRes.json()).token;
  expect(token).toMatch(/^[A-Za-z0-9_-]{20,200}$/);

  const resolveRes = await api.get(`/api/v1/qr/${token}`);
  expect(resolveRes.status()).toBe(200);
  expect((await resolveRes.json()).individual_id).toBe(individualId); // resume context

  // ---- capture #2 in the resumed individual context
  const cap2Res = await api.post("/api/v1/observation/captures", {
    data: {
      domain: "biology",
      subject_ref: `individual/${individualId}`,
      measurements: [{ item: "体重", kind: "number", value: 32, unit: "g" }],
    },
  });
  expect(cap2Res.status()).toBe(202);
  const captureId2 = (await cap2Res.json()).capture_id;

  // individual history now lists both captures
  const histRes = await api.get(`/api/v1/individuals/${individualId}/observations`);
  expect(histRes.status()).toBe(200);
  const hist = await histRes.json();
  expect(hist.observations).toHaveLength(2);

  // ---- Truth keys written this run (each confirmed persisted by a 200 read-back above)
  const truthKeys = {
    capture_1: `truth/ihl.obs.capture.v1/${captureId}.json`,
    photo_event: `truth/ihl.obs.photo.v1/${captureId}-${photoId}.json`,
    photo_blob: `media/photo/${photoId}`,
    qr: `truth/ihl.ind.qr.v1/${token}.json`,
    capture_2: `truth/ihl.obs.capture.v1/${captureId2}.json`,
  };
  console.log("E2E_ACTOR_ID=" + actorId);
  console.log("E2E_TRUTH_KEYS_JSON=" + JSON.stringify(truthKeys));
  console.log("E2E_DETAIL_JSON=" + JSON.stringify(detail));

  await api.dispose();
});
