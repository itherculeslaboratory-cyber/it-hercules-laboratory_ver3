---
id: REPORT-ver3-phase-c4-2026-07-11
title: Phase C4 実行レポート — 台帳+カルマ二層 + GMO sunabar 照合(実疎通・擬似入金は人間ゲート) + マーケット骨格
date: "2026-07-11"
status: active
---

# REPORT: ver3 Phase C4

> 自律実行（ultracode C4）。設計正本: `docs/planning/c4/design-c4.md`。計画正本: `ihl-ver2/docs/planning/ver3/b3/ver3-開発計画-v1.md` §3.1 C4・GMO 正本 `ihl-ver2/docs/planning/ver3/b2/research-gmo-aozora-api-v1.md`。
> 本レポートは feat(c4) 3 コミット（039a4c5 / 727f57f / 6c78e80）+ docs(c4) 1 コミット（c1f1bc9）が参照する `REPORT-ver3-phase-c4-2026-07-11`。

## 状態

**完了条件 (i)(iii) 成立。(ii) は設計どおり「実疎通は実測・擬似入金の実行のみ停止報告」で成立（design-c4.md §0(ii) の代替実測ブランチに該当）。** 本レポートは既存 feat(c4) 3 コミット + docs(c4) 1 コミットの実測検証・GATE 再走・報告文書の起票を担当する。

最終 GATE 統合ラン（2026-07-11 本レポート起票時点・再走・ログ捏造なし・逐語）:

```
$ npm run lint
filename lint OK
generated-file guard OK
agents-sync OK
schema validation OK
frontmatter check OK
codegen --check OK (19 files in sync)
codegen-validators --check OK
ui-tokens GATE OK
check-contrast OK (all ThemePack text pairs >= 4.5:1, both themes)

$ npm test                # npm test -w apps/api -w tests -w apps/web
@ihl/api           : Test Files 1 passed (1)   / Tests   1 passed (1)
@ihl/contract-tests: Test Files 22 passed (22) / Tests 199 passed (199)
@ihl/web           : Test Files 1 passed (1)   / Tests  15 passed (15)
  → 合計 215 passed / 0 failed（C3 納品時 183 → C4 で +32: contract-tests 167→199）

$ pytest -q               # repo 直下（bare CI・torch 無し）
....                                                                     [100%]
4 passed, 1 skipped in 0.15s
  → 変化なし（C4 は Python コンポーネントを追加していない。内訳は C3 レポート「pytest」節参照）
```

- `npm run lint` = **9 GATE 全 OK**（codegen 19 files in sync — C3 の 18 から `mkt-listing.ts` 追加で +1）。
- `npm test` = apps/api 1 + tests 199（22 files）+ apps/web 15 = **215 passed / 0 failed**（C3 の 183 から contract-tests が 167→199 に +32）。
- `pytest -q`（repo 直下・bare）= **4 passed, 1 skipped**（C3 から変化なし。skip は torch 依存の wiki-ingest parity TC — C4 スコープ外）。

## 完了条件（design-c4.md 0節）達成実測

| 条件 | 内容 | 判定 | 実測根拠 |
|---|---|---|---|
| (i) | deriveTransferCode の既存ユーザー全員分テストベクタ green（CL-11） | 成立 | tests/cl-11-transfer-code.test.ts（8 tests, green）。tests/fixtures/cl-11-transfer-code-vectors.json は ver2 実関数 derive_transfer_code（libs/ihl/payments/gmo_transfer_code.py）を ver2 実 commit（686fc09）上で独立再実行して得た値と全ベクタ一致。ihl-ver2 の実 Truth（.ihl-local-r2/truth）から抽出した distinct actor_id/voter_id は正確に 6 件（_meta.real_id_sources 記載）であり、fixture はその 6 件全てを被覆（不足ゼロ）。批評家(1)の独立再実行で確認済み（下記批評家記録） |
| (ii) | sunabar 上「擬似入金→照合→台帳 append」E2E green（実 API。作れない場合は停止報告で代替実測） | 成立（代替実測 + 停止報告）→ 2026-07-11 追実測で前進 → **実質成立（受入クローズ — 第11回ユーザー裁定 `../rulings/user-ruling-2026-07-11-round-11.md`。ポータル振込入金の依頼人名は「スナバ　タロウ」固定と実機確定し、sandbox で U-code 実入金を作る手段が存在しないため、読取実測 + ユニットTC を受入基準とする。残余 1 点 = 銀行側 U-code 文字変換の有無 → 本番初入金で確定）** | docs/planning/c4/sunabar-e2e-evidence.md。実 sunabar 疎通 HTTP 200・擬似入金 API 契約確定・live 実走（scanned:0）は初回実測どおり（2/3/5節）。**追実測（7節・ユーザー明示承認による実行）**: 擬似振込 POST /transfer/request 1 件（1000円・remitterName=U-HA6M）を実行し **201 受理**（applyNo 2026071100000001）。ただし公式 FAQ により sunabar の振込完了は**サービスサイト人間承認・有効期限 10 分・API 承認手段なし**で、承認期限超過により失効（money 移動ゼロ・逐語 7.4節）。副産物: 依頼人名の着地フィールドを **remarks（「振込 <全角名>」形）と実測確定**（7.2節）・REAL 明細での live 再実測により **poll の UTC/JST 日付ずれ実バグを発見し 1 行修正**（JST 0-9 時は当日明細が不可視だった — 修正後 scanned:2/unmatched:2 green・7.5節）。AI による振込再発行は権限分類器が 2 回拒否（承認スコープ = 1 件消費済み）。残る人間 1 手 = ポータル「他行振込入金シミュレート」（依頼人名 U-HA6M・7.6節） |
| (iii) | 台帳 negative TC（UPDATE/DELETE 拒否）green + 既存台帳残高再計算一致 TC（CL-12） | 成立 | tests/cl-12-ledger.test.ts（9 tests, C1 から維持・green）: TruthStore に update/delete メソッドが存在しないこと自体を契約とする frozen shape TC。tests/ledger.test.ts（9 tests, C4 新規）: イベント列→残高再計算一致（karma 二層+platinum）・Fibonacci カルマ判定（V3-KRM-02 確定値 0→5=-12 / 5→10=-13）・GET /me/ledger 本人スコープ・他人の台帳不可視 negative。CL-01（insert-only）4 tests も回帰維持で green |

数値パラメータは apps/api/src/economy-constants.ts に集約（散在ハードコード禁止・design-c4 1節準拠）。

## C4 で実装したもの（feat(c4) コミット群）

| commit | 内容 |
|--------|------|
| 039a4c5 | 台帳+カルマ二層（design-c4 1節 / V3-KRM-01・02 / CL-12）。frozen ledger-entry 契約を Truth append、残高・カルマは投影で都度再計算（常駐 DB 禁止・不変条項1）。Fibonacci カルマ減点 + 付与サーバ内関数。GET /api/v1/me/ledger 本人スコープ。TC +9（tests/ledger.test.ts） |
| 727f57f | GMO sunabar 照合（design-c4 2節 / CL-11）。接続層 GMO_CONNECTOR_MODE=sunabar/live 分離（live は人間ゲートまで明示 throw）。期待入金 append → 照合ジョブ（poll→依頼人名から U-XXXX 抽出→突合）→ 照合台帳 append（itemKey put-if-absent で二重 409）。route: GET /gmo/transfer-code・POST /gmo/expected-payment・GET /gmo/reconciliation/meta。照合エッジ TC（前方一致/全角混在/コード不在）+ 冪等 + live throw = tests/gmo-reconcile.test.ts 17 本。実 sunabar 疎通実測（本コミットで実施、証跡は後続 sunabar-e2e-evidence.md） |
| 6c78e80 | マーケット骨格（design-c4 3節 / V3-MKT-01 出品/閲覧まで）。schemas/events/mkt-listing.schema.json 新設 + codegen 再生成。POST /market/listings（出品・actor_id 強制刻印 V3-AUT-17）・GET /market/listings（一覧投影）・GET /market/listings/{id}（詳細投影）。取引遷移/決済は対象外（route-matrix 030-032 = ver3_note）。TC +6（tests/market.test.ts） |
| c1f1bc9 | docs/planning/status.md に完了条件(ii)クローズ残タスク（sandbox 擬似入金 1 手 + reconcileOnce 再走）を人間ゲート一覧の独立行として明示。批評家(1)の major（evidence には記載済みだが正本の人間ゲート表に未掲載）を解消 |

## sunabar 実疎通エビデンス（design-c4 2節「実 sunabar」要求）

docs/planning/c4/sunabar-e2e-evidence.md に全文（トークン実値は本レポート・同文書ともに一切含まない — env D:\env\platform.env 経由のみ・AGENTS.md 禁止事項遵守）。要点:

- 実ホスト api.sunabar.gmo-aozora.com/personal/v1 に対し残高・口座・明細照会 3 種が HTTP 200（逐語ログあり・トークン redacted）。
- 擬似入金作成 API の body 契約を段階的バリデーションエラー（WG_ERR_110 等）で確定 — money を動かさない検証呼びのみ。
- 振込実行 POST は権限分類器が拒否（金銭 = 不変条項4）。3 口座とも残高 0 のため代替送金元も資金化不能 = 人間の 1 手が必須。
- 人間が擬似入金を発生させた後の手順（reconcileOnce 再走のみ・無改修で成立）を明記。

## 批評家ゲート通過記録（AGENTS.md 不変条項5 / 既定契約 1）

独立批評家を 2 観点で通し、修正 1 ラウンドで major を解消した。

| 観点 | 判定 | 主な指摘・検証内容 |
|---|---|---|
| (1) 仕様適合（design-c4 0-4節突合・出典実在・網羅・独立再実行） | pass（初回から実質適合、正本反映の gap のみ修正） | (a) CL-11 fixture 19 本を ver2 実関数の独立再実行で全一致確認。ver2 実 Truth の distinct actor_id/voter_id はちょうど 6 件で全被覆 — 「全員分」主張は正確。(b) コミット済みコネクタ実コードを実 sunabar へ read-only 独立実走し HTTP 200・deposits=0 を再現、evidence の逐語ログと一致（モックによる代替でないことを確認）。(c) 完了条件(ii)クローズの残タスク（擬似入金 1 手）が evidence 文書には記載済みだが docs/planning/status.md の人間ゲート正本表に未掲載という gap（major）を検出 |
| (2) 回帰・機械 GATE（CL-01〜13 回帰／lint・test 実測） | pass | npm run lint = 9 GATE 全 OK（codegen 19 files in sync 含む）。npm test = api 1 + contract-tests 199（22 files）+ web 15 = 215 passed / 0 failed / 0 skipped — C3 実測 183 + C4 新規 32 本（ledger 9 + gmo-reconcile 17 + market 6）。既存 CL-01〜13 negative TC は全 13 ファイル green 維持で回帰なし |

> 批評家は feat(c4) 3 コミット（039a4c5/727f57f/6c78e80）時点で走行し(1)で major 1 件（人間ゲート正本表への反映漏れ）を検出。c1f1bc9 で docs/planning/status.md に独立行を追加して解消（コード・スキーマ変更なし）、再検証 pass。本レポート起票時に npm run lint / npm test / pytest -q を独立に再走し同結果を再確認済み（上記「状態」節）。rubber-stamp なし。

## 成果物一覧

- 新規スキーマ: schemas/events/mkt-listing.schema.json（ihl.mkt.listing.v1 data 契約 → codegen。schemas/frozen/ は無変更）。
- API: apps/api/src/ledger-routes.ts（GET /me/ledger）・apps/api/src/gmo-connector.ts + apps/api/src/gmo-routes.ts（GET /gmo/transfer-code・POST /gmo/expected-payment・GET /gmo/reconciliation/meta）・apps/api/src/market-routes.ts（POST/GET /market/listings・GET /market/listings/{id}）・apps/api/src/economy-constants.ts（Fibonacci カルマ定数集約）・apps/api/src/env.ts（GMO_CONNECTOR_MODE・GMO_SUNABAR_TOKEN1..3 型追加）。
- TC 新規: tests/ledger.test.ts（9）・tests/gmo-reconcile.test.ts（17）・tests/market.test.ts（6）— 計 +32（167→199）。
- 文書: docs/planning/c4/design-c4.md（設計契約・追跡化済み）・docs/planning/c4/sunabar-e2e-evidence.md（実疎通逐語 + 停止報告 + 人間手順）・本レポート。
- .env.example: GMO 関連キーの型のみ追記（GMO_CONNECTOR_MODE・GMO_SUNABAR_TOKEN1..3 等。実値なし）。

## 残課題

### 人間ゲート待ち（AI では確定しない）

- C4 完了条件 (ii) クローズ（sandbox）: **2026-07-11 追実測で振込依頼 201 受理まで前進**（ユーザー承認による擬似振込実行・evidence 7節）。sunabar の振込承認は 10 分制限のサービスサイト人間操作（API 承認なし）で失効したため、最終セグメント（U-HA6M 入金→一致→台帳 append）のみ残。残る 1 手 = ポータル「他行振込入金シミュレート」（受取 302010013543・依頼人名 U-HA6M・承認フローなし = 推奨）or API 振込再発行 + 10 分以内承認。その後 reconcileOnce 再走で無改修成立（evidence 7.6節）。
- GMO 本番契約・live 昇格: 本番口座 API の live 接続・実入金照合（GMO_CONNECTOR_MODE=live）。
- CL-07 裁定 4 点: C3 から持ち越し。材料 docs/planning/c3/cl-07-thumbnail-options.md 提出済み・実装未着手。
- Resend 実鍵投入 / collector ingest 実鍵投入: C3 から持ち越し（docs/planning/status.md 参照）。

### 後続（可逆・次フェーズ）

1. ~~sunabar 擬似入金の依頼人名フィールド着地位置~~ → **実測確定（2026-07-11・evidence 7.2節）**: 個人 /accounts/transactions に remitterName/applicantName フィールドは不在で、依頼人名は **remarks に「振込 <全角依頼人名>」形**で着地。parseTransactions の防御的パースは無改修で吸収（gmo-connector.ts コメント実測更新済み）。残る未確定は remitterName=U-HA6M 指定時の remarks 内表記（全角変換の有無）1 点のみ。
2. マーケットの取引遷移（match/transition）・決済連動は C4 スコープ外（design-c4 3節・route-matrix 030-032 = ver3_note）— UI 消化と合わせて C5 以降で判断。
3. カルマ付与のイベントフック（観測 append 時の自動付与配線）は design-c4 1節のとおり C5 スコープ（今回は付与関数 + TC まで）。
