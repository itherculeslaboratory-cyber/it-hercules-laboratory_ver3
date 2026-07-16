---
id: handoff-c8-session2
title: C8ラン継続HANDOFF(セッション2用)
date: "2026-07-17"
status: active
---

# HANDOFF — C8 全機能実装完了ラン・セッション2

> 新スレッドはこのファイルだけ読めば続行できる。前セッション(2026-07-16夜〜07-17朝)は round-16 裁定確定+夜間実装ラン(約50コミット)を完了した。台帳: `D:\claude\00-hq\TASK-LEDGER.md` T-38。

## §0 現在地(2026-07-17朝・main=211a47f 時点)

- **テスト**: unit 全緑(apps/api 970超+web 115)・**E2E 60/60 全緑**・lint 20 GATE 全緑・pytest 11 passed
- **要件**: 735→**749件**(round-16で+14採番・srs v1.10・検算済み)
- **進捗正本**: `docs/planning/c8/progress.md`(必達184件: done 約45 / in_progress 18 / todo 約121)— **実装コミットは同コミットでprogress.jsonを更新し render 再生成する規約**(PLAN §9)
- 実装済みハイライト: CSVインポータ(V3-OBS-32)・市場バックエンド一式(予約V3-IND-35/ブロック/状態機械5脚/no-pay)・PAY.JP 5%請求フロー+PT廃止+GMO退役・認証(数字コードV3-AUT-46+失効denylist V3-AUT-03)・GOV-35国別自治・匿名配送URL中継・クラッチ二層V3-IND-36・広場round-16パラメータ・market-trade/knowledge-thread UI再構築(通貫E2E)+dispute新設・QR発行復活・全フォーム数値型バグ根治

## §1 確定裁定の要点(迷ったらここに照らす)

1. **決済**: ユーザー間=銀行振込既定(IHL非関与・ユーザー操作遷移)+PAY.JP Platform Payouts型をオプション(取引ごと選択)。IHL 5%=ゆる請求(取り逃し許容・自動ペナルティなし)・Platform取引のみ自動控除。PayPay OPA並行申請。カード無し層=バンドルカード案内(3DS対応確認済み)
2. **PT(プラチナ)**: 金銭購入経路のみ廃止。貢献度配布・ショップ・投票は存続
3. **フォーク10%=貢献度の分配**(金銭ではない)。商用3%/取引5%が金銭
4. **UI**: 画面ごと「なぜ来るのか」目的起点+既製資産(GitHub OSS/Claude Design)収集適用。ver2カタログ丸ごと移植は不採用(良品のみ部分利用)。正本=`docs/planning/c8/ui-asset-catalog.md`
5. **哲学**: 「信頼と信用と、透明性のあるログで成り立つ、貴族のシステム」「コピーされた方が得」「ユーザーの負担金額と楽さが最優先」
6. 弁護士相談は不要化(受領8・PAY.JP照会質問⑥で代替)。回答原本=`docs/planning/rulings/round-16-answers-raw.md`(受領1〜9)

## §2 ユーザーに聞くこと(新スレ冒頭)

1. **UI見た目の方向**: `docs/planning/c8/screens/ui-review.html` の採点結果を受領(未回答なら催促は1回だけ・作業はブロックしない)
2. **認定飼育者/一次観測者の認定方式**(広場の重み付き票に必須): (a)実績自動認定★推奨 / (b)手動 / (c)自動候補+手動承認
3. PAY.JP/PayPay照会の返答が来ていれば `docs/planning/c8/inquiry-drafts.md` に貼ってもらい共有(Platform自動控除の実装ゲート)

## §3 残作業(優先順・lane別)

1. **UI磨き第2弾**(最優先・ユーザーの見た目評価を反映): 表示名フィールドの設計(actor_id生ハッシュの解消)・投票の投稿ID手入力→投稿ごとのボタン化・役割ゲート付きボタン(買い手/売り手で出し分ける`when`プリミティブ)・モバイルのテーブル→カードリスト化。対象拡大: ホーム/経済ステータス3画面統合/検索F3類似・F1L・テンプレfork 3ステップ等(ui-asset-catalog.md の優先度表に従う)
2. **L4残クラスタ消化**: progress.md の todo(必達121件)。大半はg07-UIUX薄画面群(カタログ適用の横展開)+g05ガバナンス+g01/g09。参照ゼロの93件は本当に未着手(実態同期済みなので信用してよい)
3. **Platform自動控除**(PAY.JP照会回答後): payjp-connector拡張(tenant作成・platform_fee)・取引画面のカード決済オプション
4. 市場の残り: 予約成立後のfulfillment配線・相互承認キャンセル依頼フロー・GOV-35の観測モジュール側freeze(クロスモジュール設計)
5. `docs/planning/c8/tc-coverage-c8.md` 生成(PLAN §6)・status.md の鮮度維持
6. デプロイ準備(人間ゲート隣接): KV namespace作成(AUTH_DENYLIST/AUTH_CODE_STATE)・Truthバックアップ(B2)接続

## §4 人間ゲート(触らない・一覧提出のみ)

照会送信/PAY.JP・PayPay申込/Truthバックアップ先契約/KV namespace作成(wrangler)/cutover実行/collector実鍵/月次cron/公開の実施/最終打鍵チェック

## §5 運用規約(前セッションで確立・必ず踏襲)

- **並列worktree方式**: 実装レーンは `isolation: worktree` のsonnetワーカー・**worktree内では最初に`npm install`**(モジュール解決が親に漏れる)・progress.jsonはレーンでは触らず統合時に更新・統合はメインツリーで1本ずつ(生成物conflictは手で解決せずcodegen再生成)
- **`docs/planning/rulings/round-16-question-sheet.md` はユーザーの回答用紙** — 絶対にstage/checkout/regenerateしない。手書きはdiffで検出→answers-rawへ逐語記録
- 批評家ゲート(opus)+lint/test/e2e全緑が納品条件。コミットは自律実行理由+参照(plan-c8-full-run / round-16)+Co-Authored-By必須。シークレット混入grep必須(.env.example系はプレースホルダ形状もPush Protectionに引っかかる — `xxxx`羅列を避ける)
- 既知の罠: 0バイト文字化けファイルがワーカーBash事故でrepo直下に生まれる(lint赤の原因・都度削除でよい)・`.gitattributes`でeol=lf強制済み・`.claude/`はvitest/lint走査から除外済み
- Fable=指揮・設計・最終レビューのみ。実装/調査はsonnet・批評統合はopus。ユーザー向け文書に架空ペルソナ名を出さない・専門用語は初出1行説明・質問は推奨付き一括

## §6 参照索引

- 計画: `docs/planning/c8/PLAN-c8-full-run.md` / 進捗: `progress.md` / UI正本: `ui-asset-catalog.md` / スクショ: `screens/`+`ui-review.html`
- 裁定: `docs/planning/rulings/user-ruling-2026-07-17-round-16.md`+`round-16-answers-raw.md` / 照会文面: `inquiry-drafts.md`(送付待ち)
- 調査: `docs/planning/b2-research/research-{paypay-unification,payment-service-scan,payjp-platform}.md`
- メモリ: `ver3-phase-c8-kickoff.md` / persona: R25〜R34(質問一括・用語説明・選択肢主義・ゆる徴収・専門家コスト拒否ほか)
