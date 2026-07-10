---
id: e2e-evidence-c2
title: C2 E2E 実測エビデンス（観測ライフサイクル・受け入れ(c)）
date: "2026-07-11"
status: active
---

# C2 E2E 実測エビデンス

> 設計契約: `docs/planning/c2/design-c2.md` §7（受け入れ(c)）。
> 実行: `npm run e2e -w apps/web`（Playwright + Chromium）。ローカル実測のみ（CI 非接続）。
> ストレージ層 put-if-absent の実機検証は C1 で完了済み — `docs/planning/c1/r2-put-if-absent-evidence.md`（mode=storage, first-wins）。本 E2E は wrangler local（miniflare）の R2 シミュレーション上で観測ライフサイクル全体を通す。

## 1. 何を検証したか

2 スイート・**2 passed / 0 failed**（実測ログは §4）。

1. **UI 土台**（Chromium 実ブラウザ）: ScreenDef Renderer が 7 枚の MVP 画面を全て描画し、画面遷移（screen_id→route マッピング）が機能する。スクリーンショット 8 枚（§5）。
2. **観測データパイプライン**（§7 の中核）: 実 worker（wrangler dev, local）+ R2 シミュレーション上で、マジックリンク認証 → 観測作成（domain=biology・計測・親個体 sire/dam）→ 写真アップロード（スクリプト生成 PNG）→ 詳細ビュー投影（計測+写真）→ QR 発行 → `/qr/<token>` で個体文脈へ復帰 → 2 件目観測、を通貫。

### レイヤー分離の理由（誇張ゼロ）

データパイプラインは **API オリジン（:8787）へ直接**駆動している。ブラウザ（next :3000）→ API（:8787）は別オリジンで、保護 API を叩くには CORS + クロスサイト cookie が要る（現状の worker は未設定）。これは §4.3 が触れていない**設計判断事項**であり、E2E タスクで独断実装せず **未解決事項**（§6）として残す。UI 土台は API 非依存のクライアント遷移・描画のみを検証し、データ実体は契約が E2E 用に明示的に許可する経路（`Authorization: Bearer <session token>`, §1.3）で API を直接検証する。

## 2. 起動環境（ローカル実測の前提）

- `apps/api/.dev.vars`（`.gitignore` 済・非コミット）: `DEV_TOKEN=e2e-dev-token` / `SESSION_SECRET=e2e-session-secret` / `IHL_DEV_EXPOSE_MAGIC_TOKEN=1`。
- webServer（`apps/web/playwright.config.ts`）: `wrangler dev --port 8787 --local`（`apps/api`・R2 シミュレーション）+ `next dev --port 3000`。
- **compat-date オーバーライド**: 同梱 workerd（wrangler 4.86）が対応する最大 compatibility_date は `2026-05-03`。`wrangler.toml` のコミット値 `2026-07-01` は変更せず、dev コマンドで `--compatibility-date 2026-05-03` を**ローカル実行時のみ**上書き（`apps/api` の `dev:e2e` script）。worker が使う API（fetch/WebCrypto/R2）はこの期間で挙動差なし。将来 workerd が 2026-07-01 を対応するバージョンに上げればオーバーライドは不要。
- Chromium は `--no-proxy-server` で起動（127.0.0.1 をシステム/WARP プロキシに載せない）。

## 3. E2E で発見し修正した統合バグ（凍結物以外・設計契約の範囲内）

| # | 症状（E2E が捕捉） | 根本原因 | 修正 | 単体テストで漏れた理由 |
|---|---|---|---|---|
| B1 | 全 `POST /observation/*` が **500**（`EvalError: Code generation from strings disallowed`） | `@ihl/truth` の `validateEnvelope` が **ajv をリクエスト時に `.compile()`**。workerd は `new Function` を禁止。 | ajv **standalone 事前コンパイル**へ変更（`scripts/codegen-validators.mjs` → `packages/truth/src/generated/validators.cjs`）。`envelope.ts` は生成関数を import。生成コードは runtime ajv と**バイト等価**のため検証意味論は不変（CL-01〜13 全 137 tests 緑で実証）。lint に `codegen-validators --check` を追加。 | 単体は Node（vitest）実行で ajv runtime compile が動くため素通り。**実 worker 実行（E2E）でのみ露見**。 |
| B2 | ホーム等の遷移ボタンが 404 | `defaultExecute` の navigate が `window.location.assign(screen_id)` を素の相対 URL として渡す（実ルートは `/s/<id>` と `/`）。 | `renderer.tsx`: `to==="home"→"/"`, それ以外 `→/s/<id>` にマッピング。`onNavigate`（テスト経路）は raw id のまま維持し renderer.test.tsx 不変。 | 単体は `onNavigate` モックを注入して raw id を assert していたため、実ナビゲーション経路が未検証だった。 |

B1 は **本番 worker でも同じく壊れる**（workerd の eval 禁止は本番も同一）defect。E2E がなければ本番投入まで潜伏していた。

## 4. Playwright 実行ログ（逐語）

```
> @ihl/web@0.0.0 e2e
> playwright test

Running 2 tests using 1 worker

  ok 1 e2e\observation.spec.ts:21:1 › UI foundation: all 7 MVP screens render and navigation is wired (4.5s)
E2E_ACTOR_ID=7ba239ce01e09134cdbdd6dc89b4ee6771f713f8fca669ee2ed4fc6bdebf851b
E2E_TRUTH_KEYS_JSON={"capture_1":"truth/ihl.obs.capture.v1/01KX6BFPCXTR5Y9EMPDXTREDFW.json","photo_event":"truth/ihl.obs.photo.v1/01KX6BFPCXTR5Y9EMPDXTREDFW-01KX6BFPDT7BNQRRCSRR56G82S.json","photo_blob":"media/photo/01KX6BFPDT7BNQRRCSRR56G82S","qr":"truth/ihl.ind.qr.v1/YNPI_VWz9zpbMzC9DyF_xQo4917KRUIOGY5qtV-TF6A.json","capture_2":"truth/ihl.obs.capture.v1/01KX6BFPF8PX7JM3MJM855PZ7Q.json"}
  ok 2 e2e\observation.spec.ts:74:1 › observation data pipeline: magic-link auth → capture → photo → detail → QR resume → 2nd capture (136ms)

  2 passed (11.8s)
```

worker（wrangler dev, local）側の実リクエストログ:

```
[wrangler:info] Ready on http://127.0.0.1:8787
[wrangler:info] GET  /health                                             200 OK           (8ms)
[wrangler:info] POST /api/v1/auth/magic-link                             202 Accepted     (2ms)
[wrangler:info] POST /api/v1/auth/verify                                 200 OK           (2ms)
[wrangler:info] GET  /api/v1/auth/session                                200 OK           (2ms)
[wrangler:info] GET  /api/v1/individuals/e2e-ind-001/observations        401 Unauthorized (1ms)   ← 未認証は 401（CL-04 deny-by-default）
[wrangler:info] POST /api/v1/observation/captures                        202 Accepted     (24ms)  ← capture #1
[wrangler:info] POST /api/v1/observation/upload                          202 Accepted     (8ms)   ← 写真（74B PNG）
[wrangler:info] GET  /api/v1/observation/01KX6BFP...TREDFW               200 OK           (6ms)   ← 詳細投影（計測+写真）
[wrangler:info] GET  /api/v1/observation/01KX6BFP...TREDFW/image/01KX... 200 OK           (3ms)   ← media blob
[wrangler:info] POST /api/v1/individuals/e2e-ind-001/qr                  202 Accepted     (5ms)   ← QR 発行
[wrangler:info] GET  /api/v1/qr/YNPI_VWz9zpbMzC9DyF_xQo4917KRUIOGY5qtV-TF6A 200 OK        (2ms)   ← 個体文脈へ復帰
[wrangler:info] POST /api/v1/observation/captures                        202 Accepted     (4ms)   ← capture #2
[wrangler:info] GET  /api/v1/individuals/e2e-ind-001/observations        200 OK           (5ms)   ← 履歴 2 件
```

詳細ビュー投影（`GET /observation/<capture_id>` の実応答）— 計測（体長 65mm）と写真（sha256・media_key）が本人 actor_id 付きで返る:

```json
{"capture":{"capture_id":"01KX6BFPCXTR5Y9EMPDXTREDFW","actor_id":"7ba239ce01e09134cdbdd6dc89b4ee6771f713f8fca669ee2ed4fc6bdebf851b","domain":"biology","subject_ref":"individual/e2e-ind-001","sire_id":"individual/sire-001","dam_id":"individual/dam-001","species_candidate":"Dynastes hercules","species_confirmed_by":"user","measurements":[{"item":"体長","kind":"number","value":65,"unit":"mm"}]},"photos":[{"photo_id":"01KX6BFPDT7BNQRRCSRR56G82S","capture_id":"01KX6BFPCXTR5Y9EMPDXTREDFW","actor_id":"7ba239ce01e09134cdbdd6dc89b4ee6771f713f8fca669ee2ed4fc6bdebf851b","media_key":"media/photo/01KX6BFPDT7BNQRRCSRR56G82S","content_type":"image/png","size_bytes":74,"sha256":"37725d7e5f330d8e41aaaaf231c6a748f20177b12c47cfed3bd4a57f6398eabb"}]}
```

## 5. 書き込まれた Truth キー一覧（R2 シミュレーション）

1 回の E2E ランで append-only R2（`apps/api/.wrangler/state/v3/r2/ihl-ver3-truth-dev`・非コミット）へ書かれたキー。各キーは worker 自身の R2 `list`/`get`（下表「確認経路」の 200 応答）で**実在確認済み** = wrangler local R2 シミュレーションからの列挙。

| # | Truth キー | 確認経路（200 で実在証明） |
|---|---|---|
| 1 | `truth/ihl.obs.capture.v1/01KX6BFPCXTR5Y9EMPDXTREDFW.json` | `GET /observation/<capture_id>`（get） |
| 2 | `truth/ihl.obs.photo.v1/01KX6BFPCXTR5Y9EMPDXTREDFW-01KX6BFPDT7BNQRRCSRR56G82S.json` | `GET /observation/<capture_id>` の `photos[]`（capture 前方一致 prefix list） |
| 3 | `media/photo/01KX6BFPDT7BNQRRCSRR56G82S`（バイナリ blob） | `GET /observation/<capture_id>/image/<photo_id>`（get・74B・image/png） |
| 4 | `truth/ihl.ind.qr.v1/YNPI_VWz9zpbMzC9DyF_xQo4917KRUIOGY5qtV-TF6A.json` | `GET /qr/<token>`（get → individual_id 解決） |
| 5 | `truth/ihl.obs.capture.v1/01KX6BFPF8PX7JM3MJM855PZ7Q.json` | `GET /individuals/e2e-ind-001/observations`（prefix list → 2 件） |

> capture の envelope.id はプレーン ULID、photo と qr は `putEventAt` で**ドメイン配置キー**（capture 前方一致 / token O(1) 解決）に格納 — design-c2 §3.1 の通り。

## 6. 未解決事項（当初）と第2パスでの解消

> 下記 1/2/4 は第2パス（2026-07-11）で**実装解消済み**。詳細は `REPORT-ver3-phase-c2-2026-07-10.md` §「批評家 major 再指摘の解消（第2パス）」。据え置き記録は誠実性のため残す。

1. **~~ブラウザ→API のクロスオリジン認証~~ → 解消**: `apps/web/next.config.mjs` に rewrites `/api/:path*`→worker を追加し `api.ts` を同一オリジン相対に変更。HttpOnly `ihl_session` cookie がクロスサイト cookie / CORS 無しで流れる（当初推奨の「同一オリジン dev プロキシ」を採用）。
2. **~~「開発トークンでログイン」ボタン~~ → 解消**: `POST /api/v1/auth/dev-login`（公開・DEV_TOKEN 設定時のみ・本番 404）を新設。固定 dev actor（`deriveActorId("dev@ihl.local")`・§1.4）のセッション cookie を 1-click 発行。`login.json` の dev ボタンをこの route へ。auth.test で発行成功 + 本番 404 を実測。
3. **compat-date**: §2 の通り同梱 workerd が 2026-07-01 未対応。将来の wrangler 更新でオーバーライド撤去可（未解消・環境要因）。
4. **~~画面 form ↔ API スキーマ契約の不整合~~ → 解消**: `obs-entry.json` に `domain` select + 計測をドット名 `measurements.0.item|value` + form `props.static`（`measurements.0.kind`/`species_confirmed_by`）を追加し、Renderer FormNode が `{domain, measurements:[{item,kind,value}], ...}` に整形して POST（renderer.test 実測）。`individual-detail.json` はハードコードのモック（履歴 `65mm` / QR 値 / literal "detail" path）を撤去し実データ束縛へ（履歴 = `GET /individuals/{{params.id}}/observations`、QR path = `{{params.id}}` 補間、QR 値 = `{{result.token}}`）。Renderer に `{{...}}` 補間・mount-fetch・list 束縛・result 束縛・transitions 消費を追加（renderer.test 4 本で実測）。
5. **残: §7 実ブラウザ通貫クリックスルーの再走**: 上記 1/2/4 で通貫は成立可能になり renderer/API 単体で緑。実ブラウザでの 1 セッション通貫（wrangler+next+Chromium）は本サンドボックス非搭載のため未再走。本 §4 の 2 スイート（UI 土台描画/遷移 + API 直叩きデータパイプライン）は据え置きのまま green。⑤ に従い実ブラウザ緑を盲目で主張しない。

## 7. スクリーンショット（`docs/planning/c2/e2e-screenshots/`）

| ファイル | 画面 |
|---|---|
| `01-login.png` | login（マジックリンク + 開発トークンボタン） |
| `02-home.png` | home |
| `03-obs-domain-select.png` | 観測ドメイン選択（5 分岐 = V3-OBS-01） |
| `04-obs-entry-empty.png` | 観測入力（空） |
| `05-obs-entry-filled.png` | 観測入力（計測・種候補・親個体 sire/dam 記入済 = V3-IND-01） |
| `06-obs-detail.png` | 観測詳細 |
| `07-individual-detail.png` | 個体詳細（観測履歴 + QR コード描画） |
| `08-qr-resume.png` | QR 観測再開（個体文脈） |

## 8. 再現手順

```bash
# 前提: apps/api/.dev.vars に DEV_TOKEN / SESSION_SECRET / IHL_DEV_EXPOSE_MAGIC_TOKEN=1
npm run e2e -w apps/web      # wrangler dev + next dev を自動起動し 2 スイート実行
```
