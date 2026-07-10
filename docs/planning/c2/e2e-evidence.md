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

## 0. 第3パス（2026-07-11 02:16 JST）で解消した据え置き

> 旧版は「実ブラウザでの 1 セッション通貫は本サンドボックス非搭載のため未再走」（旧 §6-5）と自認し、UI 描画/遷移 + API 直叩きの **2 層分離** で緑を主張していた。**第3パスでこの据え置きを解消**した:
> - Chromium 実機（`~/AppData/Local/ms-playwright/chromium-1228`）が本環境に搭載されており、`wrangler dev`(local) + `next dev` + Chromium の 3 者を Playwright webServer で起動して **§7 の明文シナリオを 1 本の実ブラウザ通貫**として実走・green を実測（本書 §4 の逐語ログ・§7 の実測時刻つき）。
> - この通貫は ScreenDef Renderer を介した **実 UI 操作**で駆動する（フォーム送信・ファイル添付・リンク遷移・QR 発行ボタン）。API 直叩きは補助スイート（§1-2）へ降格し、主エビデンスは実ブラウザ通貫へ移した。
> - 実走により **本番でも壊れていた統合バグ 3 件**（フォーム body 未送信 / 写真 File 破棄 / obs-detail モック固定）を捕捉・修正（§3）。

## 1. 何を検証したか

2 スイート・**2 passed / 0 failed**（実測ログは §4・実行 2026-07-11 02:16 JST）。

### スイート1（主）: 実ブラウザ通貫 — §7 明文シナリオそのもの

Chromium 実機で ScreenDef Renderer を操作し、次を **1 セッション**で通した:

1. login 画面 → 「開発トークンでログイン」ボタン押下（V3-AUT-05）。`POST /auth/dev-login` の HttpOnly セッション cookie が **同一オリジン**（Next rewrite）で発行され、以降の保護 API を **ブラウザ cookie のみ**で認証。
2. home →「観測を始める」→ obs-domain-select →「生き物」→ obs-entry。
3. obs-entry フォームに domain=biology・種候補・計測（体長 65）・対象個体 ID（`individual/<id>`）・父/母個体 ID を入力し、**スクリプト生成 PNG をファイル添付**して送信。
4. 送信 = **2 段 POST**（capture 作成 → 応答 capture_id で写真 multipart upload）。obs-detail へ遷移。
5. obs-detail が **実投影**（`GET /observation/{capture_id}`）の domain/計測/写真を描画。写真は `img` が実際にデコード済み（`naturalWidth>0` を実測）。
6. obs-detail の「個体詳細を開く」リンク（投影の bare individual_id を href に補間）→ individual-detail が当該個体の観測履歴を実データで一覧。
7.「QR ラベルを発行する」→ `POST /individuals/{id}/qr` → qr-code ノードが発行トークンを描画。
8. 物理ラベル遷移先 **`/qr/<token>`** を開く → `GET /qr/{token}` が individual_id を解決し「個体が見つかりました」+ 個体 ID を表示（個体文脈付き観測再開画面）。
9.「この個体で観測を続ける」→ obs-entry → **2 件目**の観測（体重 32）を作成 → obs-detail。
10. individual-detail 再訪で当該個体の履歴が **2 件**に増えていることを実データで確認。

スクリーンショット 9 枚（§7）。

### スイート2（補助）: API セマンティクス保証

実 worker + R2 シミュレーションに直接、マジックリンク認証 → capture → 写真 → 詳細投影 → QR → 再開 → 2 件目を通し、**UI が field 単位で assert しない粒度**（`Set-Cookie` 契約 4 属性・sha256 形式・media blob のバイト長一致・本人 actor_id スタンプ・未認証 401・投影 `individual_id`）をピン留め。append-only R2 は永続するため、両スイートとも **実行ごとに一意の個体 ID**（`e2e-<base36 時刻>` / `api-<base36 時刻>`）を使い履歴件数を決定的にする。

## 2. 起動環境（ローカル実測の前提）

- `apps/api/.dev.vars`（`.gitignore` 済・非コミット）: `DEV_TOKEN` / `SESSION_SECRET` / `IHL_DEV_EXPOSE_MAGIC_TOKEN=1`。
- webServer（`apps/web/playwright.config.ts`）: `wrangler dev --port 8787 --local`（`apps/api`・R2 シミュレーション）+ `next dev --port 3000`。ブラウザ→API は `next.config.mjs` の rewrites で同一オリジン `/api/*` を worker へプロキシ（HttpOnly `ihl_session` cookie が CORS/クロスサイト cookie 無しで流れる）。
- **compat-date オーバーライド**: 同梱 workerd（wrangler 4.86）が対応する最大 compatibility_date は `2026-05-03`。`wrangler.toml` のコミット値 `2026-07-01` は変更せず、`apps/api` の `dev:e2e` script で **ローカル実行時のみ** `--compatibility-date 2026-05-03` を上書き。worker が使う API（fetch/WebCrypto/R2）はこの期間で挙動差なし。
- Chromium は `--no-proxy-server` で起動（127.0.0.1 をシステム/WARP プロキシに載せない）。Secure cookie は Chromium が 127.0.0.1 を potentially-trustworthy と扱うため http でも保持される（実走で認証成立を確認）。

## 3. E2E で発見し修正した統合バグ（凍結物以外・設計契約の範囲内）

| # | 症状（E2E が捕捉） | 根本原因 | 修正 | 単体で漏れた理由 |
|---|---|---|---|---|
| B1 | 実ブラウザからのフォーム送信で **capture が空 body で作られる**（本番でも壊れる） | `renderer.tsx` の `defaultExecute` が body 引数を無視し常に `JSON.stringify({})` を送っていた | `requestInit()` を新設し body を実送信。File を含む body は `multipart/form-data` に切替 | 単体は `onAction` モックを注入していたため `defaultExecute` の body 送信が未実行だった |
| B2 | 写真を添付しても **画像が保存されない**（FormNode が File を無言破棄） | `FormNode` の `fd.forEach` が string 以外をスキップ | capture 作成 → 応答 capture_id で `POST /observation/upload`(multipart) の **2 段送信**を `useRunAction` に実装。写真なしでも動く（upload 段スキップ・renderer.test で実測） | 単体（jsdom）は `FormData(form)` に実 file input を載せられず、写真経路は実ブラウザでのみ検証可能 |
| B3 | obs-detail が **ハードコードモック**（「ドメイン: 生き物」「体長 65 mm」固定・photo src literal "detail"） | screen-def が静的文字列 | `card` に `source_path` を許可し `GET /observation/{{params.id}}` を mount fetch。domain/計測/写真を `{{data.detail.…}}` 束縛（list に `item_image` 追加）。詳細投影に bare `individual_id` を追加し「個体詳細を開く」リンク href を補間 | obs-detail は API 非依存で描画していたため単体で素通り |
| B4 | 2 件目フォーム送信が **native GET 送信**され capture 未作成 | ハイドレーション前のクリックで `onSubmit` が未装着 | E2E: 各 obs-entry で送信前に `waitForLoadState("networkidle")`（ハイドレーション gate）。実ユーザー/本番プリレンダーには非該当の dev タイミング要因 | 単体は SSR/ハイドレーション経路を持たない |

B1/B2/B3 は **本番 worker/本番 UI でも同じく壊れる** defect。実ブラウザ通貫がなければ本番投入まで潜伏していた。

## 4. Playwright 実行ログ（逐語）

```
Running 2 tests using 1 worker

E2E_INDIVIDUAL_ID=e2e-mrf76rqa
E2E_TRUTH_KEYS_JSON={"capture_1":"truth/ihl.obs.capture.v1/01KX6GG4AV9H96Y0EHKQQAWZ0X.json","photo_event":"truth/ihl.obs.photo.v1/01KX6GG4AV9H96Y0EHKQQAWZ0X-01KX6GG4BNSQR59T6SHNR9XHRJ.json","photo_blob":"media/photo/01KX6GG4BNSQR59T6SHNR9XHRJ","qr":"truth/ihl.ind.qr.v1/I9cTzXsQwJuce5rPGF9MsQPzm7rjghzfENSKcxXV3q0.json","capture_2":"truth/ihl.obs.capture.v1/01KX6GG7WGX0A29XZ6WPNJXD3K.json"}
  ok 1 e2e\observation.spec.ts:25:1 › browser walkthrough: dev-login → capture(+photo) → detail → individual → QR → /qr resume → 2nd capture (7.7s)
  ok 2 e2e\observation.spec.ts:138:1 › API semantics guard: magic-link auth → capture → photo → detail → QR resume → 2nd capture (120ms)

  2 passed (15.1s)
```

worker（wrangler dev, local）側の実リクエストログ — **スイート1（実ブラウザ通貫）**分:

```
[wrangler:info] Ready on http://127.0.0.1:8787
[wrangler:info] GET  /health                                              200 OK        ← webServer readiness
[wrangler:info] POST /api/v1/auth/dev-login                               200 OK        ← 画面内ボタンでログイン（cookie 発行）
[wrangler:info] POST /api/v1/observation/captures                         202 Accepted  ← capture #1（フォーム送信 1 段目）
[wrangler:info] POST /api/v1/observation/upload                           202 Accepted  ← 写真 multipart（2 段目・74B PNG）
[wrangler:info] GET  /api/v1/observation/01KX6GG4AV9H96Y0EHKQQAWZ0X       200 OK        ← obs-detail 実投影
[wrangler:info] GET  /api/v1/observation/01KX6GG4.../image/01KX6GG4BN... 200 OK        ← 写真 blob（ブラウザ img がデコード）
[wrangler:info] GET  /api/v1/individuals/e2e-mrf76rqa/observations        200 OK        ← individual-detail 履歴
[wrangler:info] POST /api/v1/individuals/e2e-mrf76rqa/qr                   202 Accepted  ← QR 発行
[wrangler:info] GET  /api/v1/qr/I9cTzXsQwJuce5rPGF9MsQPzm7rjghzfENSKcxXV3q0 200 OK      ← /qr/<token> 個体解決
[wrangler:info] POST /api/v1/observation/captures                         202 Accepted  ← capture #2（個体文脈で再開）
[wrangler:info] GET  /api/v1/observation/01KX6GG7WGX0A29XZ6WPNJXD3K       200 OK        ← obs-detail #2
[wrangler:info] GET  /api/v1/individuals/e2e-mrf76rqa/observations        200 OK        ← 履歴 2 件
[wrangler:info] GET  /api/v1/observation/01KX6GG4AV9H96Y0EHKQQAWZ0X       200 OK        ← Truth キー列挙（同一オリジン認証 fetch）
```

（続けてスイート2 が `magic-link → verify → session → 未認証 401 → capture/upload/detail/image/qr/resolve/capture2/history` を実行 — 全 202/200/401 期待どおり。）

## 5. 書き込まれた Truth キー一覧（R2 シミュレーション）と実データ

スイート1（実ブラウザ）の 1 ランで append-only R2（`apps/api/.wrangler/state/v3/r2/ihl-ver3-truth-dev`・非コミット）へ書かれたキー:

| # | Truth キー | 確認経路（200 で実在証明） |
|---|---|---|
| 1 | `truth/ihl.obs.capture.v1/01KX6GG4AV9H96Y0EHKQQAWZ0X.json` | `GET /observation/<capture_id>`（obs-detail 描画） |
| 2 | `truth/ihl.obs.photo.v1/01KX6GG4AV9H96Y0EHKQQAWZ0X-01KX6GG4BNSQR59T6SHNR9XHRJ.json` | 同上の `photos[]`（capture 前方一致 prefix list） |
| 3 | `media/photo/01KX6GG4BNSQR59T6SHNR9XHRJ`（バイナリ blob） | `GET /observation/<capture_id>/image/<photo_id>`（img がデコード・naturalWidth>0） |
| 4 | `truth/ihl.ind.qr.v1/I9cTzXsQwJuce5rPGF9MsQPzm7rjghzfENSKcxXV3q0.json` | `GET /qr/<token>`（/qr/<token> 画面で individual_id 解決） |
| 5 | `truth/ihl.obs.capture.v1/01KX6GG7WGX0A29XZ6WPNJXD3K.json` | `GET /individuals/e2e-mrf76rqa/observations`（prefix list → 2 件） |

R2 local state から直接取り出した **capture #1 の実 envelope**（ブラウザのフォーム送信が書いた正本。`actor_id` は dev-login の決定的 dev principal = `deriveActorId("dev@ihl.local")`・**V3-AUT-17 本人スコープ**。`measurements[0].value` はフォーム由来の文字列 `"65"` で obs-capture スキーマ（`["string","number"]`）に適合）:

```json
{"specversion":"1.0","id":"01KX6GG4AV9H96Y0EHKQQAWZ0X","source":"apps/api","type":"ihl.obs.capture.v1","time":"2026-07-10T17:16:42.203Z","dataschema":"schemas/events/obs-capture.schema.json","provenance":{"generator_kind":"human","actor_id":"30f9a6ba2045c8eb6f4d6ef15f04613c4f82f30737bc24190b4eef339263a114"},"data":{"capture_id":"01KX6GG4AV9H96Y0EHKQQAWZ0X","actor_id":"30f9a6ba2045c8eb6f4d6ef15f04613c4f82f30737bc24190b4eef339263a114","domain":"biology","subject_ref":"individual/e2e-mrf76rqa","sire_id":"individual/sire-001","dam_id":"individual/dam-001","species_candidate":"Dynastes hercules","species_confirmed_by":"user","measurements":[{"kind":"number","item":"体長","value":"65"}]}}
```

同ランの **photo event data**（写真 multipart アップロードが書いた正本・74B PNG）:

```json
{"photo_id":"01KX6GG4BNSQR59T6SHNR9XHRJ","capture_id":"01KX6GG4AV9H96Y0EHKQQAWZ0X","actor_id":"30f9a6ba2045c8eb6f4d6ef15f04613c4f82f30737bc24190b4eef339263a114","media_key":"media/photo/01KX6GG4BNSQR59T6SHNR9XHRJ","content_type":"image/png","size_bytes":74,"sha256":"37725d7e5f330d8e41aaaaf231c6a748f20177b12c47cfed3bd4a57f6398eabb"}
```

## 6. 既知の環境要因（未解消・コード外）

- **compat-date**: §2 の通り同梱 workerd が 2026-07-01 未対応。将来の wrangler 更新でオーバーライド撤去可（環境要因・コード修正不要）。

> 旧版 §6 の据え置き（① クロスオリジン認証 / ② 開発トークンボタン / ④ 画面 form↔API 契約 / ⑤ 実ブラウザ通貫未再走）は **すべて実装・実走で解消済み**。特に⑤は本書 §0/§4 の通り 2026-07-11 02:16 JST に実ブラウザ 1 通貫で green を実測した。

## 7. スクリーンショット（`docs/planning/c2/e2e-screenshots/`・実ブラウザ通貫の各段）

| ファイル | 画面 |
|---|---|
| `01-login.png` | login（マジックリンク + 開発トークンボタン） |
| `02-home.png` | home（ログイン後） |
| `03-obs-domain-select.png` | 観測ドメイン選択（5 分岐 = V3-OBS-01） |
| `04-obs-entry-empty.png` | 観測入力（空） |
| `05-obs-entry-filled.png` | 観測入力（計測・種候補・対象/父/母個体・写真添付済 = V3-IND-01） |
| `06-obs-detail.png` | 観測詳細（**実投影**の domain/計測/写真） |
| `07-individual-detail.png` | 個体詳細（実データ履歴 + 発行済 QR コード描画） |
| `08-qr-resume.png` | `/qr/<token>` 観測再開（トークン解決した個体文脈） |
| `09-obs-detail-2.png` | 2 件目観測の詳細（個体文脈で再開後） |

## 8. 再現手順

```bash
# 前提: apps/api/.dev.vars に DEV_TOKEN / SESSION_SECRET / IHL_DEV_EXPOSE_MAGIC_TOKEN=1
npm run e2e -w apps/web      # wrangler dev + next dev + Chromium を自動起動し 2 スイート実行
```
