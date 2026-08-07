#!/usr/bin/env node
import { fileURLToPath } from "node:url";
// dev専用テストデータseed。R0807-4dddba(kits/lane-implement/ORDER-2026-08-07-seed-transitions.md)。
//
// 対象: 個体family(親2+子2・観測・血縁)・棚(多在棚QR+空棚QR)・クラッチ・種マスタ・
// 出品(2人目actorで成立まで)・紛争(dispute)・知の広場スレ(BBS投稿2件)。
// R0807-5d7026(遷移実クリック検証)で「トリガー不明」48件のうち、実データ不足が
// 原因だったペアの再現に使う実データ一式を作る。
//
// 前提: `npm run dev:e2e`(wrangler dev --local)がローカルAPIを起動していること。
// dev-loginはDEV_TOKEN未設定(=本番)だと404を返す仕組みなので、本番経路からは
// 呼べない(auth-routes.ts:247)。このスクリプト自体もlocalのAPI URL以外を叩かない。
//
// 使い方: npm run seed:dev (apps/api配下。API_URL環境変数で対象を上書き可、既定8787)

const API = process.env.API_URL ?? "http://127.0.0.1:8787";

function extractSessionCookie(res) {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error(`no Set-Cookie in response from ${res.url}`);
  const match = setCookie.match(/ihl_session=([^;]+)/);
  if (!match) throw new Error(`ihl_session not found in Set-Cookie: ${setCookie}`);
  return match[1];
}

async function main() {
  const tag = Date.now().toString(36);

  // dev-login(固定dev actor)。DEV_TOKEN未設定環境では404で即エラー終了する。
  const loginRes = await fetch(`${API}/api/v1/auth/dev-login`, { method: "POST" });
  if (!loginRes.ok) {
    throw new Error(`dev-login failed (${loginRes.status}) — DEV_TOKEN未設定 or API未起動? (${API})`);
  }
  const cookie = extractSessionCookie(loginRes);
  const headers = { "content-type": "application/json", cookie: `ihl_session=${cookie}` };
  const post = async (path, body) =>
    fetch(`${API}/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) }).then(async (r) => {
      if (!r.ok) throw new Error(`POST ${path} -> ${r.status}: ${await r.text()}`);
      return r.json();
    });

  const species = "ヘラクレスオオカブト";
  const capture = (individualId, weight) =>
    post("/observation/captures", {
      domain: "biology",
      subject_ref: `individual/${individualId}`,
      measurements: [{ item: "weight", kind: "number", value: weight, unit: "g", value_origin: "direct_observed" }],
    });

  console.log(`[seed-dev] tag=${tag} API=${API}`);

  const sire = await post("/individuals", { local_label_text: `父-${tag}`, species });
  const dam = await post("/individuals", { local_label_text: `母-${tag}`, species });
  await capture(sire.individual_id, 140);
  await capture(dam.individual_id, 118);
  const a = await post("/individuals", { local_label_text: `子A-${tag}`, species });
  const b = await post("/individuals", { local_label_text: `子B-${tag}`, species });
  for (const kid of [a, b]) {
    await post(`/individuals/${kid.individual_id}/parents`, { parent_id: sire.individual_id, parent_role: "sire" });
    await post(`/individuals/${kid.individual_id}/parents`, { parent_id: dam.individual_id, parent_role: "dam" });
  }
  await capture(a.individual_id, 30);
  await capture(a.individual_id, 45);
  await post(`/individuals/${a.individual_id}/life-events`, { kind: "birth", at: "2025-09-14T00:00:00Z" });
  await post(`/individuals/${a.individual_id}/life-events`, { kind: "eclosion", at: "2026-06-01T00:00:00Z" });
  await capture(b.individual_id, 28);
  console.log(`[seed-dev] individuals: sire=${sire.individual_id} dam=${dam.individual_id} a=${a.individual_id} b=${b.individual_id}`);

  const shelfMulti = await post("/placements", { label: `E2E-SHELF-MULTI-${tag}` });
  const m1 = await post("/individuals", { local_label_text: `棚1-${tag}`, species });
  const m2 = await post("/individuals", { local_label_text: `棚2-${tag}`, species });
  await post("/observation/batch-commit", {
    items: [
      { kind: "move", subject_ref: `individual/${m1.individual_id}`, to_placement_id: shelfMulti.placement_id },
      { kind: "move", subject_ref: `individual/${m2.individual_id}`, to_placement_id: shelfMulti.placement_id },
    ],
  });
  const qrMulti = await post(`/placements/${shelfMulti.placement_id}/qr`, {});

  const shelfEmpty = await post("/placements", { label: `E2E-SHELF-EMPTY-${tag}` });
  const qrEmpty = await post(`/placements/${shelfEmpty.placement_id}/qr`, {});
  console.log(`[seed-dev] qr: multi=/qr/${qrMulti.token} empty=/qr/${qrEmpty.token}`);

  const clutchA = await post("/clutches", {
    harvested_at: new Date().toISOString().slice(0, 10),
    initial_count: 10,
    species,
    container_label: `E2E-CL-${tag}`,
  });

  const sp = await post("/species", { name: species });

  const listing = await post("/market/listings", { title: `E2Eトレード-${tag}`, price: 5000, accept_mode: "instant" });
  await post(`/market/listings/${listing.listing_id}/transition`, { kind: "list_fixed", listing_id: listing.listing_id });
  console.log(`[seed-dev] listing(公開済み)=${listing.listing_id}`);

  const threadId = `e2e-thr-${tag}`;
  const topic = `E2Eスレ-${tag}`;
  await post("/plaza/posts", { thread_id: threadId, channel: "knowledge-board", topic, board_kind: "guide", body: "初回投稿" });
  await post("/plaza/posts", { thread_id: threadId, channel: "knowledge-board", topic, board_kind: "guide", body: "返信1" });
  console.log(`[seed-dev] knowledge-thread=${threadId}`);

  const dispute = await post("/gov/disputes", { respondent_id: "e2e-buyer", category: "market" });
  console.log(`[seed-dev] dispute=${dispute.dispute_id}`);

  console.log(`[seed-dev] clutch=${clutchA.clutch_id} species=${sp.species_id}`);
  console.log("[seed-dev] done.");
}

// 判断ゼロの自己チェック: API未起動時に分かりやすく落ちることだけ確認する(実行例)。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`[seed-dev] FAILED: ${err.message}`);
    process.exitCode = 1;
  });
}
