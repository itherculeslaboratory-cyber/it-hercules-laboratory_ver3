---
id: DESIGN-ver3-phase-c4
title: C4 設計契約 — 経済系(台帳/カルマ) + GMO sunabar 照合(本番契約・実入金は人間ゲート)
date: "2026-07-11"
status: active
---

# C4 設計契約(実装エージェント向け正本)

> 計画正本: `ihl-ver2/docs/planning/ver3/b3/ver3-開発計画-v1.md` §3.1 C4。GMO 正本: `ihl-ver2/docs/planning/ver3/b2/research-gmo-aozora-api-v1.md`(特に Phase 1 = 名前照合ポーリング最小構成・§5-4 認証層の差替可能分離)。
> C2/C3 の共通規約を全て引き継ぐ。コミット参照 ID = REPORT-ver3-phase-c4-2026-07-11。

## 0. 完了条件(機械検証)

- (i) deriveTransferCode の既存ユーザー全員分テストベクタ green(CL-11 — C1 の `tests/fixtures/cl-11-transfer-code-vectors.json` が全員分か確認し、不足なら ihl-ver2 実データから補完。1 件でも不一致 = fail)
- (ii) sunabar 上「擬似入金→照合→台帳 append」E2E green(実 sunabar API。擬似入金が API から作れない場合は sunabar ポータル手作業が要る旨を停止報告し、既存テスト明細に対する照合で代替実測)
- (iii) 台帳 negative TC(UPDATE/DELETE 拒否)green + 既存台帳からの残高再計算一致 TC(CL-12)
- 人間ゲート(実行しない): GMO 本番契約申込・実鍵投入・実入金確認・`GMO_CONNECTOR_MODE=live` 昇格

## 1. 台帳 + カルマ二層(V3-KRM-01・CL-12・V3-KRM-02)

- 台帳はイベント(frozen `ledger-entry` 契約準拠の data)を Truth append。残高・カルマ値は**投影で都度再計算**(常駐 DB 禁止)。
- 二層: karma(貢献度・加算主体)/ platinum(フィボナッチ到達で 1 枚 — V3-KRM-02 の確定数値)。数値パラメータは定数モジュール 1 ファイルに集約(較正は V3-GOV-17 管理 GUI = 後波。ハードコード散在禁止)。
- route: `GET /api/v1/me/ledger`(自分の台帳投影・V3-AUT-17 本人スコープ)。付与はサーバ内関数(観測 append 時のフック等は C5 — 今回は付与関数 + TC まで)。
- TC: UPDATE/DELETE 経路の非存在(CL-12 既存 TC 維持)・イベント列→残高再計算の一致・フィボナッチ到達判定。

## 2. GMO sunabar 照合(CL-11)

- 接続層は差替可能に分離(`GMO_CONNECTOR_MODE`: `sunabar`|`live`、live は未実装ガードで明示 throw)。トークンは env(`GMO_SUNABAR_TOKEN1..3`・D:\env\platform.env)。**実値の出力・コミット・ログ混入禁止**。
- フロー(名前照合ポーリング = Phase 1 最小構成): ① `POST /api/v1/gmo/expected-payment`(actor の transfer_code = 凍結 deriveTransferCode で導出・期待入金イベント append)→ ② 照合ジョブ(単発実行関数: sunabar 入出金明細 API を poll → 振込依頼人名から `U-XXXX` 抽出 → 期待入金と突合)→ ③ 一致で台帳 append(冪等: 同一明細 ID の二重 append は put-if-absent で 409)。
- route: `GET /api/v1/gmo/transfer-code`(自分のコード)・`GET /api/v1/gmo/reconciliation/meta`(最終照合時刻等の投影)。Webhook(matrix 57)は本番契約後 = 対象外。
- E2E(実 sunabar): 擬似入金の作成可否を GMO レポート/sunabar 仕様で確認し、作成可なら「作成→poll→照合→台帳 append→残高反映」を実測。**モックで E2E を代替して green を名乗ることを禁止**(モック TC は別途持ってよいが E2E とは呼ばない)。
- 照合エッジ(依頼人名の切り詰め・カナ変換等)は TC で最低 3 ケース(前方一致・全角混在・コード不在)。

## 3. マーケット骨格(V3-MKT-01 — 出品/閲覧まで)

- イベント `ihl.mkt.listing.v1`(schemas/events/ 新設)+ route: `POST /api/v1/market/listings`(出品)・`GET /api/v1/market/listings`(一覧投影)・`GET /api/v1/market/listings/{id}`(詳細)。取引遷移(match/transition)・決済連動は C4 対象外(matrix に ver3_note)。
- UI(画面)は C5 の画面消化で実施 — 今回は API+TC のみ。

## 4. 共通

- 各ステージ: lint/test(+pytest)全 green 実測→ commit。frozen 変更禁止。予算節約のため探索は必要最小限(設計契約と参照正本を先に読む)。
