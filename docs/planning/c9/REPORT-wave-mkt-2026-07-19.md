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
| 4a | dispute「話し合いの場」予想図 → **実装** | **完了・○統合 R141→R156** | 予想図○(R141/70)→wiring○統合(R156/70「承認します」)。commit `7ca5afb`。GET /gov/disputes/mine新設+二層投票の正直表示(今1票=1PT・無料/権能層はこれから) |
| 4b | economy-status 予想図(v1×→v2訂正) → **実装** | **完了・○統合 R148→R154** | v1=MKT-ECONOMY-1×(R142/60「勘違い」)→v2訂正○(R148/60)→wiring○統合(R154/90「承認します」)。commit `7ded12d`。3層セマンティクス訂正(5%維持費/3%商用利用料/10%は金銭でない貢献度追加発行ボーナス) |
| 4c | market-trade / platinum-shop 予想図 | **未着手（次ラウンド）** | platinum-shop 一次資料調査済(honesty landmine多数=HANDOFF §C)。market-trade 未research |

## 総括（第2セッション）

- **UI 4画面すべて 予想図→実装→○統合承認 まで到達**: 取引中(R121/100→R137/80)・割り出し予約(R134/90→R143/70)・economy-status(R148/60→R154/90)・話し合いの場(R141/70→R156/70)。
- **実装コミット(wave-mkt・C9統合待ち)**: `d1eb6a2`取引中 / `367e1c3`予約 / `7ded12d`economy / `7ca5afb`dispute。全て共有部不変・publicページ+入口link+新route/testの追加のみ。
- **勝ちパターン確立**: 完成予想図ファースト+実物CSS逐語採用+実データ配線(既存route再利用優先)+未実装は「これから」正直表示。批評家(opus)全ラウンドPASS blocking0。実データ主義(捏造ゼロ)が高評価の核。
- **ユーザー訂正の反映例**: R142(経済3層セマンティクス)・R135(合成信頼度禁止=生事実のみ)・R141(投票二層化)・批評家(投票コスト正直化)。× や指摘は逐条修正して再カード→○。
| 5a | 「取引中」逐語採用+実データ配線 | **完了・○統合承認（R137・80点「承認します」）** | 批評家PASS blocking0→カード `mkt-torihikichu-wired`→○。commit d1eb6a2。誇張是正(自動dispute導線→手動)を後追い |
| 5b | 「割り出し予約」逐語採用+実データ配線（単価固定・買い手ダッシュボード） | **実装完了・批評家ゲート中** | 既存予約ルート再利用(新route無し)・GET /market/reservations等に配線・lint 21緑→独立批評家(opus)実行中→カード `mkt-reservation-wired` 投函予定 |

## スライス5b 詳細（「割り出し予約」買い手ダッシュボード・V3-IND-35）

- **新規**: `apps/web/public/reservation/{reservation.html,reservation.js}`（承認済み予想図R134のCSS視覚系採用・requireSession auth-gate）。
- **実データ配線（新route無し）**: GET /market/reservations（状態付き自分の予約）+ GET /market/listings（title結合）+ GET /market/transfer/{id}（offeredの自分の順位）+ POST /confirm|/decline。既存の予約ルート（market-reservation-routes.ts・実装+TC済）を再利用。
- **範囲の正直明記**: この画面は買い手の予約状態のみ。申込フォーム・出品者しきい値・マッチング実行は出品/個体側の別画面（scope-note明示）。ラブレー/貢献度は「これから」正直表示。
- **誇張是正（取引中）**: torihikichu.js の「重大相違は受け取り時に自動でdisputeへ回る/強制的に回る」を、バックエンド未実装（market-settlement.ts receive遷移に自動分岐なし＝設計意図のみ）に合わせ「見つけたら話し合いの場へ相談してください」の手動導線へ是正（誇張ゼロ）。
- 共有部（schemas/renderer全域/theme）不変。home.jsonに入口link `open-reservation` 追加（既存契約不変・i18nキー追加のみ）。

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
