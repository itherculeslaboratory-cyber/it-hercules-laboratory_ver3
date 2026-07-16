---
id: c6-cutover-readiness
title: C6 cutover readiness — route別突合・残差分・人間手順書
date: "2026-07-11"
status: active
---

# C6 cutover-readiness(cutover 直前まで — 実施は人間ゲート)

> 実測日 2026-07-11。旧 = ver3-live `https://api.it-hercules.uk`(VPS FastAPI・**GET 専用呼び出しのみ**・承認済み)。新 = staging `https://ihl-api-ver3-staging.it-hercules-laboratory.workers.dev`(wrangler --env staging・workers.dev のみ・dev R2 バケット `ihl-ver3-truth-dev`・cron 無効)。
> ハーネス: `scripts/reconcile-harness.mjs`(GET 限定を構造上強制・直列・許容差 whitelist・TC 10本)。生レポート: `reconcile-noauth.json` / `reconcile-authnew.json`(本ディレクトリ)。

## 0. 結論(人間が読む 3 行)

1. **新 API は deny-by-default を staging 実機で確認済み**(無認証 401 / dev token 200)。読み取り突合(dev 認証下 = `reconcile-authnew.json` を正とする)で新側 404 は **4 本のみ**: planned 未実装 2(onboarding/status・gmo/va-deposit/unsent)+ 旧パス移設 2(board/categories・component-board → `/api/v1/plaza/*`・route-matrix note)。それ以外の GET は新側提供を実測確認。※無認証走では 401 ゲートが先に立ち old-only は構造上観測不能(批評家指摘反映)。
2. **P0 所見: 旧 API は保護 route 12 本を未認証で開放している**(me/preferences・home/summary・market/listings 等が実データ JSON を 200 で返す — 実測・§2 表)。新 API は同パスを 401/404 で遮断(内訳は §3)。**cutover を早める実利的根拠**。旧側の是正は本番変更のため本書では行っていない。
3. 残る人間ボタンは §4 の 5 手順のみ(本番 R2 バインド・DNS/route 切替・書込系の片系化・ver3-live 停止・VPS 解約)。

## 1. 突合の読み方

- データ母体が別(旧=本番データ / 新=dev R2)のため、**値の一致でなく「構造・認証境界の互換」**を評価軸とする。書込系 36 route は呼ばず(§5.3 二重発行防止)、cutover 手順対象として列挙のみ。
- 判定凡例: 🟢=互換確認 / 🟡=追加確認(param 供給・仕様差の裁定) / 🔴→🟢=旧側の問題を新側が是正(P0 所見)。
- 「突合(無認証)」= 両側とも認証なし。「突合(新側dev認証)」= 新側のみ dev token(新側が実データを返せることの確認)。

## 2. route 別 readiness(66 行)

| # | method | path | ver3_status | 突合(無認証) | 突合(新側dev認証) | 判定/残差分 |
|---|--------|------|------------|--------------|-------------------|-------------|
| 1 | GET | /api/v1/auth/session | implemented | diff (401/200) | diff (401/200) | 🟡 差分要確認 |
| 2 | POST | /api/v1/auth/magic-link | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 3 | POST | /api/v1/auth/register | merged | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 4 | POST | /api/v1/auth/verify | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 5 | GET | /api/v1/auth/session(重複行) | implemented | diff (401/200) | diff (401/200) | 🟡 差分要確認 |
| 6 | GET | /api/v1/onboarding/status | planned | diff (200/401) | old-only (200/404) | 🔴→🟢 旧が未認証開放(P0所見)・新は正しく401。**round-16で廃止**(OQ-ROUTE-01・実装無しのまま route-matrix/route-matrix.csv から削除。この表は実測時点のスナップショットとして残置) |
| 7 | POST | /api/v1/auth/magic-link(重複行) | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 8 | POST | /api/v1/auth/register(重複行) | merged | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 9 | POST | /api/v1/auth/verify(重複行) | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 10 | POST | /api/v1/onboarding/complete | planned | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象。**round-16で廃止**(OQ-ROUTE-01・実装無しのまま route-matrix.csv から削除) |
| 11 | GET | /api/v1/home/summary | implemented | diff (200/401) | diff (200/200) | 🔴→🟢 旧が未認証開放(P0所見)・新は正しく401 |
| 12 | GET | /api/v1/observation/{capture_id} | implemented | skipped_param (-/-) | skipped_param (-/-) | 🟡 param 供給で再走 |
| 13 | GET | /api/v1/observation/{capture_id}/image | implemented | skipped_param (-/-) | skipped_param (-/-) | 🟡 param 供給で再走 |
| 14 | GET | /api/v1/observation/{capture_id}/reanalysis-manifest | implemented | skipped_param (-/-) | skipped_param (-/-) | 🟡 param 供給で再走 |
| 15 | GET | /api/v1/observation/measurement-dictionary | implemented | match (401/401) | diff (401/200) | 🟢 一致 |
| 16 | GET | /api/v1/observation/targets/catalog | implemented | match (401/401) | diff (401/200) | 🟢 一致 |
| 17 | GET | /api/v1/observation/templates | implemented | match (401/401) | diff (401/200) | 🟢 一致 |
| 18 | GET | /api/v1/observation/templates/{template_id} | implemented | skipped_param (-/-) | skipped_param (-/-) | 🟡 param 供給で再走 |
| 19 | POST | /api/captures | merged | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 20 | POST | /api/measurements | merged | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 21 | POST | /api/solid-observation/commit | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 22 | POST | /api/v1/observation/dictionary-extensions | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 23 | POST | /api/v1/observation/measurements | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 24 | POST | /api/v1/observation/search | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 25 | POST | /api/v1/observation/targets/search | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 26 | POST | /api/v1/observation/templates | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 27 | POST | /api/v1/observation/upload | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 28 | GET | /api/v1/market/listings | implemented | diff (200/401) | diff (200/200) | 🔴→🟢 旧が未認証開放(P0所見)・新は正しく401 |
| 29 | GET | /api/v1/market/listings/{listing_id} | implemented | skipped_param (-/-) | skipped_param (-/-) | 🟡 param 供給で再走 |
| 30 | GET | /api/v1/market/transfer/{listing_id} | planned | skipped_param (-/-) | skipped_param (-/-) | 🟡 param 供給で再走 |
| 31 | POST | /api/v1/market/listings/{listing_id}/match | planned | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 32 | POST | /api/v1/market/listings/{listing_id}/transition | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 33 | GET | /api/v1/board/{category}/threads | implemented | skipped_param (-/-) | skipped_param (-/-) | 🟡 param 供給で再走 |
| 34 | GET | /api/v1/board/categories | implemented | diff (200/401) | old-only (200/404) | 🔴→🟢 旧が未認証開放(P0所見)・新は正しく401 |
| 35 | GET | /api/v1/component-board | implemented | diff (200/401) | old-only (200/404) | 🔴→🟢 旧が未認証開放(P0所見)・新は正しく401 |
| 36 | POST | /api/v1/board/{category}/threads | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 37 | POST | /api/v1/board/{category}/threads/{thread_id}/posts | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 38 | GET | /api/v1/dispute/{thread_id} | implemented | skipped_param (-/-) | skipped_param (-/-) | 🟡 param 供給で再走 |
| 39 | POST | /api/v1/dispute/{thread_id}/messages | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 40 | POST | /api/v1/dispute/{thread_id}/open-market | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 41 | GET | /api/v1/me/preferences | implemented | diff (200/401) | diff (200/200) | 🔴→🟢 旧が未認証開放(P0所見)・新は正しく401 |
| 42 | GET | /api/v1/me/settings | implemented | diff (200/401) | diff (200/200) | 🔴→🟢 旧が未認証開放(P0所見)・新は正しく401 |
| 43 | GET | /api/v1/settings | implemented | diff (200/401) | diff (200/200) | 🔴→🟢 旧が未認証開放(P0所見)・新は正しく401 |
| 44 | PATCH | /api/v1/me/preferences | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 45 | POST | /api/v1/settings/pii-session | planned | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 46 | GET | /api/v1/theme-packs | implemented | diff (200/401) | diff (200/200) | 🔴→🟢 旧が未認証開放(P0所見)・新は正しく401 |
| 47 | GET | /api/v1/theme-packs/{pack_id} | implemented | skipped_param (-/-) | skipped_param (-/-) | 🟡 param 供給で再走 |
| 48 | POST | /api/v1/builder/canvas | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 49 | POST | /api/v1/theme-packs | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 50 | GET | /api/v1/settings(重複行) | implemented | diff (200/401) | diff (200/200) | 🔴→🟢 旧が未認証開放(P0所見)・新は正しく401 |
| 51 | PATCH | /api/v1/me/preferences(重複行) | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 52 | GET | /api/v1/gmo/reconciliation/meta | planned | diff (200/401) | diff (200/200) | 🔴→🟢 旧が未認証開放(P0所見)・新は正しく401 |
| 53 | GET | /api/v1/gmo/transfer-code | planned | diff (200/401) | diff (200/200) | 🔴→🟢 旧が未認証開放(P0所見)・新は正しく401 |
| 54 | GET | /api/v1/gmo/va-deposit/unsent | planned | diff (503/401) | old-only (503/404) | 🟡 差分要確認 |
| 55 | POST | /api/v1/gmo/expected-payment | planned | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 56 | POST | /api/v1/gmo/va-deposit/subscribe | planned | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 57 | POST | /api/v1/gmo/webhook | planned | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 58 | POST | /api/v1/placements | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 59 | GET | /api/v1/placements | implemented | new-only (404/401) | new-only (404/200) | 🟢 ver3 新規(旧404=想定どおり) |
| 60 | POST | /api/v1/device-bindings | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 61 | POST | /api/v1/device-bindings/end | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 62 | GET | /api/v1/device-bindings | implemented | new-only (404/401) | new-only (404/200) | 🟢 ver3 新規(旧404=想定どおり) |
| 63 | POST | /api/v1/occupancy | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 64 | GET | /api/v1/occupancy | implemented | new-only (404/401) | new-only (404/200) | 🟢 ver3 新規(旧404=想定どおり) |
| 65 | POST | /api/v1/telemetry | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |
| 66 | POST | /api/v1/ai/{task} | implemented | —(書込系・片系切替=cutover) | —(書込系・片系切替=cutover) | cutover 手順対象 |

## 3. 残差分の内訳(🟡/🔴 の全件説明)

| 分類 | 件数 | 内容 | 処置 |
|------|------|------|------|
| 旧の未認証開放(🔴→🟢) | 12 | 旧 API で無認証 200(実データ)を返す保護 route。dev 認証走で分離(批評家指摘反映): **9 本は新側で保護+実装済み**(home/summary・market/listings・me/preferences・me/settings・settings×2・theme-packs・gmo/reconciliation/meta・gmo/transfer-code = 無認証 401/dev 認証 200)・**3 本は新側 404**(onboarding/status=planned 未実装・board/categories と component-board=/plaza/* へ移設) | 新側が正 — cutover で自然是正。**onboarding/status・onboarding/complete は round-16(OQ-ROUTE-01)で廃止裁定済み**(実装せず route-matrix.csv から削除・上表 #6/#10 参照)。**旧側の即時是正(VPS 変更)は本番操作のため人間裁定**(それまで本番の当該データは露出継続と認識せよ) |
| /auth/session 仕様差(🟡) | 2 | 旧 401 / 新 200(新は public route として未ログイン状態を 200 で返す C2 設計・route-matrix access=public と整合) | 新設計を正とし whitelist 登録済み扱い(裁定不要と判断・異議あれば第13回で) |
| gmo/va-deposit/unsent(🟡) | 1 | 旧 503(旧側エラー)/ 新 401(正常な保護) | 旧側の既存障害 — 新側は正常。cutover で解消 |
| param 供給待ち(🟡) | 9 | {capture_id} 等の path param route。実 ID を旧本番から読むには本番データ参照が要る | cutover リハーサル時に `--params` で実 ID を与えて再走(手順 §4-2) |
| ver3 新規 route | 3 | placements / device-bindings / occupancy(旧 404 = 想定どおり) | 差分ではない |
| 書込系(POST/PATCH) | 36 | 突合対象外(二重発行防止 R-10) | §4-3 の片系切替で一方のみ有効化 |

## 4. 人間が押すボタン(cutover 手順書 — 全て人間ゲート)

1. **本番 R2 バインド**: `wrangler.toml` に本番環境 `[env.production]` を起票し R2 bucket を本番 Truth に変更 → `wrangler deploy --env production`(この時点ではカスタムドメイン未接続)。
2. **突合リハーサル**: 本番バインド版に対し `node scripts/reconcile-harness.mjs --old https://api.it-hercules.uk --new <production workers.dev URL> --params <実ID json>` — データ母体が同一になるため値レベル一致まで確認可能。param 9 route もここで green 化。
3. **書込系の片系切替**: route 単位で DNS/Pages ルーティングを新へ向ける(順序は route-matrix の migration_wave 列)。切替済み route の旧側書込を無効化(R-10 二重発行防止)。ロールバックは route 単位で旧へ戻すだけ(R2 は append-only のため巻き戻し不要)。
4. **ver3-live FastAPI 停止**: 全 route 切替後、本番トラフィック 0 をログで確認してから停止。
5. **VPS 解約**: メール経路裁定(Resend 段階(c))と連動(smtp-secrets-migration §6-1)。

## 5. 停止報告(C6 中の対外操作と是正)

- staging デプロイ 2 回(承認済み事項1の範囲内・workers.dev のみ)。**初回デプロイでトップレベル [triggers] の cron が staging に継承される事故** → 即時 `[env.staging.triggers] crons=[]` で無効化し再デプロイ(継承中の cron 実行 0 回・次回予定 15:00 UTC 前に撤去)。cron の実稼働開始は引き続き人間ゲート。
- staging への secret 投入は**新規生成の dev 値のみ**(SESSION_SECRET/DEV_TOKEN)。実鍵(RESEND/GMO/CF)は一切投入していない。
- ver3-live へは GET のみ・直列・計 2 走(承認済み事項2の範囲内)。書込系は一切呼んでいない。

## 6. E2E on staging / deferred-e2e の状況

- ローカル実ブラウザ E2E(Chromium・wrangler dev+next dev): observation 通貫は K1/K4 の導線変更(obs-entry 直行+OBS-25 確認画面)へ追随修正し、その過程で **obs-entry→obs-confirm のフォーム値引き継ぎ欠落(結合実バグ)を検出** — 修正内容は REPORT-c6 実測ログ参照。
- staging 実機では deny-by-default 401 / dev token 200 / ledger 投影を実測済み(§0)。
