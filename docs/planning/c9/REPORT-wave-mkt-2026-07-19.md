---
id: report-wave-mkt-2026-07-19
title: wave-mkt 実行レポート（市場MKT+取引中+話し合いHAN+PAY.JP Platform配線）
date: "2026-07-19"
status: active
thread: ihl-mkt (worktree wave-mkt)
kickoff: 00-hq/kits/ihl-mkt/KICKOFF.md
契約: 自律ラン既定契約（CLAUDE.md グローバル）
---

# REPORT-wave-mkt-2026-07-19

> 参照レポートID（コミットメッセージから参照）。KICKOFF=`00-hq/kits/ihl-mkt/KICKOFF.md`。
> mainへは直接pushしない（WAVE-DESIGN前提3）。統合はC9のみ。

## スライス進捗

| # | スライス | 状態 | ゲート |
|---|---|---|---|
| 1 | PAY.JP Platform test配線（tenant作成・platform_fee付きcharge・live throw維持） | **完了** | worker自己QA→独立批評家(opus)=**PASS blocking0**。vitest 19緑・lint 21ゲート緑 |
| 2 | pt_topup削除の実施確認 | **確認完了（コード変更不要）** | grep監査：obligation enum=`["fee_tax","p2p"]`・pt_topup無し。残2件は削除を記録する説明コメントのみ |
| 3 | 「取引中」独立画面の完成予想図 | **完了・○採用（R121・100点）** | 批評家PASS→カード `mkt-torihikichu-forecast`→**○採用「めっちゃいい・すごく使いやすそう」** |
| 3.5 | 「割り出し予約」完成予想図（3方式・単価固定を実描画） | **完了・○採用（R134・90点）** | 批評家PASS blocking0→カード `mkt-reservation-forecast`→**○採用「UI作るのうまくなったね！最高！」**（MKT-RESERVATION-1/2=○） |
| 4 | market-trade/economy-status/platinum-shop/dispute 予想図 | 未着手 | — |
| 5a | 「取引中」逐語採用+実データ配線 | **実装完了・批評家ゲート中** | lint 21緑・tests/market-transactions-view 15緑・market回帰38緑→独立批評家(opus)実行中→カード `mkt-torihikichu-wired` 投函予定 |
| 5b | 「割り出し予約」逐語採用+実データ配線（単価固定） | 未着手（R134承認済・次） | — |

## スライス3.5 詳細（割り出し予約 予想図・V3-IND-35 + F-3裁定 R127）

- 監査#2（fidelity-A3.md）で判明した「予約UIが構造正本にもキットにも1枚も無い」を受け、完成予想図を作成→○採用（R134・90点）。
- 3方式（単価固定=実装済み実描画／ラブレー形式・貢献度優先=採用決定R127だが未実装のため『これから』正直表示）。単価固定は `market-reservation-routes.ts` の実フィールドのみ（捏造ゼロ・批評家が算数含め照合PASS）。
- 統合要件の採番は round-18（C9/HQ専任）。この予想図は方向確認でありレジストリ不変。

## スライス5a 詳細（「取引中」逐語採用+実データ配線）

- **新規**: `apps/api/src/market-transactions-view.ts`（派生ロジック純関数=roleOf/stateLabel/turnOf/actionKindOf/stepper/flagsOf/IN_PROGRESS_STATES）・`GET /market/transactions/mine`（当事者スコープ一覧・market-routes.ts）・`apps/web/public/torihikichu/{torihikichu.html,torihikichu.js}`（実ページ）・`tests/market-transactions-view.test.ts`（純関数境界+実app駆動の当事者スコープ/401）。
- **逐語採用**: CSSは承認済み予想図（`mkt-torihikichu-forecast/mockup.html`）から1行も変えず。torihikichu.js は requireSession auth-gate + `/api/v1/market/transactions/mine` を credentials:include で叩き、派生を持たず描画に徹する（finder同型）。
- **実データ配線**: 全表示値は reduceMarket/projectPayment/projectShippingLink/projectCancelRequest/projectSettlement 由来。急ぎ色は実タイムスタンプ+経済定数（60分/48h/30日）でサーバ側算出。振込コード=deriveTransferCode（CL-11・U-形式）。
- **誇張ゼロ**: カード払い（PAY.JP）は『準備中』正直表示のまま（人間ゲート維持）。
- **共有部不変**: schemas/renderer全域/theme/navigation 不変。home.json に入口link（open-torihikichu）を追加（既存契約不変・i18nキー追加のみ）=WAVE-DESIGN前提3の許容範囲（配線先=ScreenDef）。
- スクショ: 実ページ（torihikichu.html/js）を実APIレスポンス形状で route-intercept 描画（ページのJSが実走）→両テーマ×両幅4枚を自己目視。データ真正性はtestで担保。

## スライス1 詳細（PAY.JP Platform test配線・V3-MKT-62/63）

- 拡張ファイル: `apps/api/src/payjp-connector.ts`（+ TC `tests/payjp-connector.test.ts`）。
- 追加: `PayjpTenant`/`PayjpPlatformCharge` 型、純関数 `platformFeeFor`（`SETTLEMENT_ACCRUAL_RATE`=0.05 を import・ハードコード無し）・`buildTenantForm`・`parseTenant`・`buildPlatformChargeForm`・`parsePlatformCharge`、コネクタメソッド `createTenant`（POST /v1/tenants）・`createPlatformCharge`（POST /v1/charges with tenant+platform_fee）。
- **live昇格throw維持**（実鍵=人間ゲート・新メソッドも同一throw）。test modeは実HTTPを張らず純関数+throw挙動のみTC化（実鍵投入なし）。
- API形状は一次情報 `docs/planning/b2-research/research-payjp-platform.md` §(3)(5) に一致（捏造フィールド無し・批評家照合済）。
- **誇張ゼロ**: コネクタ冒頭に「テストモード配線のみ・Platform申込/審査/実鍵/資金移動業の法的確認は人間ゲートとして残存・本コードはそれらの完了を主張しない」旨を明記。
- ルート未追加・`index.ts`/`fee-routes.ts`/`market-settlement.ts` 不変・schemas/renderer/navigation/theme 不変（scope guard批評家確認済）。

## 残る人間ゲート（AIは越えない）

- PAY.JP Platform 本番申込・プラットフォーマー審査・実鍵投入・実入金。
- 資金移動業/前払式支払手段 非該当の法的確認（弁護士＋PAY.JP法務）。
- PayPayコネクタ追加採否（質問シート裁定待ち＝作らない）。

## 検証

- worktree lint=21ゲート緑・vitest（payjp-connector）=19緑。
- 予想図スクショ4枚（desktop/mobile × light/dark）を自己目視（ブラインド納品なし）。
