---
id: DESIGN-ver3-phase-c2
title: C2 設計契約 — 認証(マジックリンク+署名付きステートレスセッション) + 観測コア MVP + ScreenDef Renderer 土台
date: "2026-07-10"
status: active
---

# C2 設計契約（実装エージェント向け正本）

> 計画正本: `ihl-ver2/docs/planning/ver3/b3/ver3-開発計画-v1.md` §3.1 C2・§2.2。
> 裁定前提: 第6回（V3-AUT-03 ステートレス / CL-08 vector_length=384 / email strip().lower()）・第7回（V3-UIX-81 新規）・第8回。
> UI 採用事項: `docs/planning/research/ui-skills-survey-2026-07-10.md` §②・§④。
> 本書は**設計の確定値**。実装エージェントは本書から逸脱する場合、逸脱理由を成果報告に明記すること（勝手に発明しない）。

## 0. 完了条件（機械検証 — 開発計画 §3.1 C2）

- (a) CL-01〜13 negative TC 全 green 維持（回帰条件。1本でも赤 = fail）+ CL-08 frozen description 訂正を対応 TC とセットで実施
- (b) MVP-実装要件 ID の自動化可能 TC 80% 以上 green（対象 ID 一覧は §8）
- (c) E2E: 観測セッション作成→写真登録→詳細ビュー→QR 再開 が実測エビデンス付き green
- (d) 全緑判定は実測エビデンスがある時のみ（ログ捏造禁止）
- CL-04: 57 route マトリクスの公開/保護列と照合する TC green

## 1. 認証設計（V3-AUT-01/03/05/17・CL-03・第6回裁定①③）

### 1.1 セッショントークン（署名付きステートレス・確定値）

- 形式: `v1.<payload_b64url>.<sig_b64url>`。payload = JSON `{ "sub": "<actor_id>", "iat": <unix秒>, "exp": <unix秒> }`。sig = HMAC-SHA256(`v1.<payload_b64url>`, SESSION_SECRET)。**WebCrypto のみ・JWT ライブラリ追加禁止**（不変条項①）。
- TTL: セッション 30 日（第6回裁定）。マジックリンクトークン: 同形式で payload `{ "email": "<正規化済み>", "purpose": "magic", "iat", "exp" }`・TTL 15 分。
- 保持: **HttpOnly Cookie** `ihl_session`（`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`）を正とし、API クライアント/E2E 用に `Authorization: Bearer <session token>` も受理する。localStorage 直置き禁止（V3-AUT-03）。
- 強制失効は実装しない（要件化時に KV デニーリスト後付け — 裁定文どおり）。
- 秘密鍵: `SESSION_SECRET`（wrangler secret / `.dev.vars`）。テストは `test-session-secret` を env 注入。

### 1.2 email 正規化と actor_id（CL-03 凍結・第6回裁定③）

- 入口（magic-link 要求・verify）で `email.trim().toLowerCase()` に統一してから `deriveActorId(email)`（`packages/truth/src/contracts.ts` の凍結実装・**変更禁止**）。
- ユーザーストアは**持たない**。actor_id は email から決定的導出（登録 = 初回ログイン。route matrix の `/auth/register` は magic-link に統合され ver3 では独立 route を持たない — マトリクスに ver3_note で明記）。
- `contracts.ts` の deriveActorId 上の「ver3 normalization policy is a C2 decision」コメントは「入口 strip().lower() 統一（第6回裁定③）・deriveActorId 自体は raw 有意のまま凍結」へ更新してよい（実装は不変）。

### 1.3 ルート（route matrix 対応）

| route | 公開/保護 | 動作 |
|---|---|---|
| `POST /api/v1/auth/magic-link` | 公開 | body `{email}` → 正規化 → magic token 発行 → メール送信（§1.4）。応答 202 `{sent:true}`。`IHL_DEV_EXPOSE_MAGIC_TOKEN=1` のときのみ `dev_magic_token` を応答に含める（ver2 と同名フラグ・本番では未設定） |
| `POST /api/v1/auth/verify` | 公開 | body `{token}` → 署名/exp/purpose 検証 → actor_id 導出 → セッショントークン発行 + Set-Cookie。応答 `{actor_id}`。失敗 401 |
| `GET /api/v1/auth/session` | 公開 | セッションあり → `{authenticated:true, actor_id}` / なし → `{authenticated:false}`（401 にしない） |
| `POST /api/v1/auth/logout` | 保護 | Cookie を Max-Age=0 で消す（ステートレスなのでサーバ側処置なし） |

### 1.4 メール送信（Resend HTTP + dev フォールバック = V3-AUT-05）

- アダプタ 1 ファイル: `RESEND_API_KEY` があれば `POST https://api.resend.com/emails`（from=`MAIL_FROM`、リンク = `${PUBLIC_APP_URL}/auth/verify?token=...`）。なければ送信スキップ（dev モード）。
- **実鍵は存在しない**（D:\env に RESEND_API_KEY なし — 2026-07-10 確認）。鍵取得は人間側材料として報告に残す。コードは鍵投入だけで動く状態まで作る。
- dev_token フォールバック維持: 既存 `DEV_TOKEN` Bearer は引き続き全保護 route で有効。DEV_TOKEN 認証時の actor_id = `deriveActorId("dev@ihl.local")`（固定・決定的）。ログイン画面に「開発トークンでログイン」ボタン（V3-AUT-05「画面内トークン認証ボタン」）。

### 1.5 認証ミドルウェア（CL-04 deny-by-default 維持）

- 判定順: ① PUBLIC_ROUTES（§1.3 の公開 4 route + `/health`）→ ② Cookie `ihl_session` 検証 → ③ Bearer がセッショントークン形式なら検証 → ④ Bearer が DEV_TOKEN と一致 → いずれも×なら 401（未知 route も 401 が先行 — C1 と同じ）。
- 認証成功時 `c.set("actorId", ...)`。書き込み系は必ず actorId をイベント actor_id に使う（V3-AUT-17 本人スコープ）。

## 2. CL-04 route マトリクス照合

- `tests/fixtures/route-matrix.csv` を新設: ihl-ver2 の `INFRA-ROUTE-MATRIX-v1.csv`（57 行）に列 `access`（`public`/`protected`）と `ver3_status`（`implemented`/`planned`/`merged`）を追加した ver3 版。公開 = auth 3 route（magic-link/verify/session。重複行含む）のみ。**それ以外の 54 行は全て protected**。
- TC `tests/cl-04-route-matrix.test.ts`（既存 cl-04 とは別ファイルで追加）: CSV を読み、(i) protected 全行: 未認証リクエスト → 401 を実 app で検証（path パラメータはダミー値で置換）。(ii) public 行: 未認証 → 401 以外。(iii) マトリクス行数 57 の検算。

## 3. 観測コア API（V3-OBS-22/43/01/18/03・V3-IND-01・V3-FND-01/02/15）

### 3.1 イベント型（全て既存 envelope スキーマに載せる。Truth キー = `truth/<type>/<id>.json`）

| type | id 規約 | data スキーマ（新設 `schemas/events/`） |
|---|---|---|
| `ihl.obs.capture.v1` | `<capture_ulid>` | `obs-capture.schema.json`: capture_id, actor_id, domain（**enum: biology/mineral/digital/place/custom** = V3-OBS-01 の5ドメイン）, subject_ref?（`individual/<individual_id>` 形式 — V3-IND-01）, sire_id?/dam_id?（FR-MVP-04 セッション任意ポインタ — frozen individual-key の description に一致）, species_candidate?（AI候補は入れない。**ユーザー入力のみ**・確定者フィールド `species_confirmed_by` は const "user" = V3-OBS-03）, measurements[]（{item, kind, value, unit?, item_hash?}）, template_id?, note? |
| `ihl.obs.photo.v1` | `<capture_id>-<photo_ulid>`（**capture_id 前方一致で R2 prefix list 可能にする**） | `obs-photo.schema.json`: photo_id, capture_id, actor_id, media_key（`media/photo/<photo_id>` 固定）, content_type, size_bytes, sha256 |
| `ihl.obs.template.v1` | `<template_ulid>` | `obs-template.schema.json`: template_id, actor_id, title, items[]（{label, kind: number/text/select/image-annotation/api/calc, options?, unit?}）, forked_from?（V3-OBS-18 fork） |
| `ihl.ind.qr.v1` | `<token>` | `ind-qr.schema.json`: token（**frozen qr-token と同形式**: URL-safe base64・20-200 字 = CL-10 トークン形式無変更）, individual_id, actor_id, created_at, expires_at?（現物ラベル用途のため**任意** — env QR の frozen スキーマは変更しない） |

- 写真バイナリ: R2 `media/photo/<photo_id>` に put-if-absent（`TruthStore` に `putBlob(key, bytes, contentType)` を追加。onlyIf は putEvent と同じ）。envelope は JSON のみの現行契約を崩さない。
- 投影は全て**都度再計算**（常駐 DB 禁止 — 不変条項①）。`R2BucketLite` に `get(key)` と `list({prefix})` を追加し、FakeR2Bucket にもミラー実装。
- 一覧系投影は R2 prefix scan。O(n) の天井は `// ponytail:` コメントで明記（投影 index は C3+）。

### 3.2 ルート（route matrix の観測系に対応・全て保護）

| route | 動作 |
|---|---|
| `POST /api/v1/observation/captures` | capture イベント append（202/400/409）。matrix の `POST /api/captures` 系は ver3 でこの route に統合（ver3_note 記載） |
| `POST /api/v1/observation/upload` | multipart（file + capture_id）→ sha256 → putBlob → photo イベント append |
| `GET /api/v1/observation/{capture_id}` | 詳細ビュー投影: capture + photos[]（型別 prefix list） |
| `GET /api/v1/observation/{capture_id}/image/{photo_id}` | media blob 返却 |
| `GET /api/v1/observation/templates` / `POST 同` | テンプレ一覧投影 / append |
| `GET /api/v1/individuals/{individual_id}/observations` | 個体の観測履歴一覧（V3-IND-01 遷移先。capture 全 list → subject_ref filter — ponytail 天井明記） |
| `POST /api/v1/individuals/{individual_id}/qr` | ind.qr.v1 発行（token = crypto.getRandomValues 32B → base64url ≒ ver2 token_urlsafe(24) 相当） |
| `GET /api/v1/qr/{token}` | token → `{individual_id}` 解決（観測再開の起点）。expires_at があれば失効判定 |

## 4. ScreenDef Renderer 土台（V3-UIX-16/17/18/81・survey 採用事項）

### 4.1 スキーマ（`schemas/screendef/screendef.schema.json` 新設）

- トップ形状は ver2 63 JSON を継承: `{screen_id, route, title, layout, nodes[], transitions[]}`。
- node を Renderer 実行可能に拡張: `{id, type, props?, children?[], action?}`。type は**カタログ enum**（§4.2）。action = `{kind:"api", method, path, body_from?} | {kind:"navigate", to}`。
- className/色の直書き禁止: props に `variant` 等の semantic 値のみ（survey §2-1。raw hex/`bg-blue-500` 型は機械 GATE §4.4 で拒否）。

### 4.2 コンポーネントカタログ v0（apps/web — 最小 12 種）

`app-shell / page / heading / text / button / form / field(text|number|select|photo) / list / card / image / qr-code / link`。shadcn/ui 合成を第一選択（survey §2-3）、フォームは `aria-invalid`/`data-invalid` 規約。

### 4.3 スタック・テーマ・a11y（確定値）

- **Next.js 15（App Router）+ shadcn/ui + Tailwind v4**（V3-UIX-32）。`apps/web`。API は `NEXT_PUBLIC_API_URL`（dev 既定 `http://127.0.0.1:8787`）。
- ThemePack: `--civ-*` トークンを `globals.css` に light/dark 2 パック（`prefers-color-scheme` 既定 + `data-theme` 上書き — V3-UIX-16）。上限規約: type scale ≤4 / weight 300・400 のみ / spacing 4/8/12/16/24/32 / radius 12px / shadow 禁止 / motion 150–300ms（survey §④-2）。基調 #0D0D0D/#1A1A1A + mint green CTA・Inter/Noto Sans JP。
- **V3-UIX-81（Renderer 共通層で一括担保）**: state 7 種（default/hover/focus-visible/active/disabled/loading/error）を全インタラクティブ部品の CSS/props 規約に確定・キーボード完結・semantic role/aria・`prefers-reduced-motion` で transition 停止・タップターゲット min 44px・コントラスト AA（トークン値で担保）。**個別画面に a11y 実装を書かせない**。
- QR 表示はサーバ不要の軽量 qr ライブラリ 1 個のみ許可（例: `qrcode`）。GSAP 等モーションライブラリ禁止（survey §③）。

### 4.4 機械 GATE 追加

- `scripts/check-ui-tokens.mjs` を新設し root `lint` チェーンへ: `screen-defs/**/*.json` と `apps/web/**/*.{tsx,css}` の raw hex（`#0D0D0D` 等トークン定義ファイル自身は除外）・任意色クラス（`bg-blue-500` 型）を拒否。
- `screen-defs/*.json` は `schemas/screendef` で validate（`validate-schemas.mjs` か新スクリプトで lint チェーンに接続）。

### 4.5 MVP 画面（`screen-defs/` 新設 — ver3 の SSOT。ver2 63 JSON は参照入力）

`login`（magic-link + 開発トークンボタン）/ `home` / `obs-domain-select`（5 分岐 = V3-OBS-01）/ `obs-entry`（計測 + 写真 + 親個体 sire/dam 入力 = V3-IND-01）/ `obs-detail` / `individual-detail`（観測履歴一覧 + QR 発行）/ `qr-resume`（`/qr/[token]` → 個体文脈で obs-entry へ）。

## 5. CL-08 frozen 訂正（第6回裁定②・frozen 変更ゲート準拠）

- `schemas/frozen/embedding-manifest.schema.json` の `vector_length`: description を「**ベクトルの要素数（= embedding_dim = 384）**。ver2 実装 embedding_builder/run.py の実書込値が正（2026-07-10 第6回裁定②。旧 description の 1536 バイト長は誤り）」へ訂正し、`const: 384` を付与（既存 R2 実データは 384 — C1 実機照合済み・fixture 一致）。
- 同一コミットで `tests/cl-08-embedding.test.ts` を更新: vector_length=384 が valid / 1536（旧バイト長解釈）が invalid になる negative TC を追加。codegen 再実行。

## 6. 禁止・共通規約（全エージェント）

- AGENTS.md の禁止事項全部（シークレット実値・生成物手編集・ファイル名版番号・非 ASCII パス・R2 UPDATE/DELETE・「未実装/WIP」UI 表記禁止 = V3-UIX-01）。
- `packages/truth/src/contracts.ts` の凍結関数のロジック変更禁止。既存 CL-01〜13 TC を割らない（回帰条件）。
- `.gitignore` に `.dev.vars` を追加（wrangler ローカル secret）。`.env.example` に SESSION_SECRET / RESEND_API_KEY / MAIL_FROM / PUBLIC_APP_URL / IHL_DEV_EXPOSE_MAGIC_TOKEN の**型のみ**追記。
- 各ステージ完了時: `npm run lint` + `npm test` + 担当分の追加テスト全 green を実測してから報告。green ログを捏造しない（V3-AIP-03）。
- コミットメッセージ: `feat(c2): <内容> — 自律実行(ultracode C2)・参照 REPORT-ver3-phase-c2-2026-07-10`。コミット前にシークレット混入 grep（`RESEND_API_KEY=re_` / `SESSION_SECRET=` 実値等）。

## 7. E2E（受け入れ (c)）

- Playwright（`apps/web` devDep）。起動: wrangler dev（local mode・`.dev.vars` の DEV/SESSION シークレット）+ next dev。
- シナリオ: login（開発トークンボタン）→ 観測作成（domain=biology → 計測入力 → 親個体 ID 入力）→ 写真アップロード → 詳細ビューで計測+写真表示 → 個体詳細から QR 発行 → `/qr/<token>` を開いて観測再開画面が個体文脈付きで出る → 2 件目の観測を作成。
- エビデンス: スクリーンショット + Playwright 実行ログ + 書き込まれた Truth キー一覧を `docs/planning/c2/e2e-evidence.md` に逐語保存。R2 は wrangler local シミュレーション（storage 層 put-if-absent の実機検証は C1 済み — `r2-put-if-absent-evidence.md` を引用）。

## 8. MVP-実装 要件 ID ↔ TC マッピング（受け入れ (b) の分母）

V3-FND-01 / V3-FND-02 / V3-FND-15 / V3-AUT-01 / V3-AUT-03 / V3-AUT-05 / V3-AUT-17 / V3-OBS-22 / V3-OBS-43 / V3-OBS-01 / V3-OBS-18 / V3-OBS-03 / V3-IND-01 / V3-UIX-16 / V3-UIX-17 / V3-UIX-18 / V3-UIX-81（17 件）。各 ID に TC 1 本以上を対応させ、対応表を `docs/planning/c2/tc-coverage.md` に生成（80% 以上 green が受け入れ線・自動化不能項目は分母除外を理由付きで明記）。
