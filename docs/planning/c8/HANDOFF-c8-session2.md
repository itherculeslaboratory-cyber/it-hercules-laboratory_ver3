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

## §2 ユーザー回答状況(2026-07-17朝に全て受領済み — 受領10)

1. **UIレビュー第1弾=受領済み(3画面とも60/100・方向合格)**: 加点=統一感・機能明瞭・両幅対応。必須修正3点(§3の1に反映済み): ①買い手/売り手で表示を出し分ける役割別ボタン ②出品一覧に画像(listing写真フィールド新設が前提)+モバイル「詳細を開く」ボタン潰れ修正+自明な説明文削除 ③「この投稿を相談室へ」等の頻出導線を「…」メニューに畳む
2. **認定方式=(a)実績による自動認定で確定** → 広場の重み付き票(認定2.0/一次観測1.5)の実装解禁。自動認定の閾値設計(実観測cite数・追試実績)は実装時にAI設計→運用調整
3. **照会=送信済み・回答待ち**(PAY.JP/PayPay)。返答が来たら inquiry-drafts.md に貼ってもらう→Platform自動控除の実装ゲート解除

## §3 残作業(優先順・lane別)

1. **UI磨き第2弾**(最優先・受領10の60点評価を反映): **(1)役割別ボタン出し分け(`when`プリミティブ=買い手/売り手/スレ主)** **(2)出品画像 — mkt-listingスキーマに写真フィールド新設(新イベント型追加・型リネーム禁止)→browseカードに表示** **(3)頻出導線の「…」メニュー化(相談室へ等)** (4)モバイル「詳細を開く」潰れ修正・自明な説明文削除 (5)表示名フィールド設計(actor_id生ハッシュ解消) (6)投票の投稿ID手入力→投稿ごとのボタン化 (7)モバイルのテーブル→カードリスト化。加点された「画面間の統一感」を壊さないこと。対象拡大: ホーム/経済ステータス3画面統合/検索F3類似・F1L・テンプレfork 3ステップ等(ui-asset-catalog.md の優先度表)
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

## §7 完走の定義(セッション2以降のDoD — ここまで自走で到達したら「完成」と報告する)

以下の状態を「AI側の完走」と定義する。ここまで**ユーザー入力なしで自走**する(質問が生まれたら止まらずためて一括提示・未回答は推奨採用=Q-META-01準拠):

1. progress.json の required 全件が **done / in_progress(残余理由をnoteに明記) / blocked(人間ゲートor照会待ちを明記)** のいずれかに分類され、todo が0件
2. lint・unitテスト・E2E・pytest 全緑+独立批評家(opus)PASS
3. UI磨き第2弾(受領10の必須3点+4〜7)実装済み・全画面スクショ+ui-reviewシート新版を提示(**採点はユーザー**)
4. tc-coverage-c8.md・status.md・進捗レポートが最新
5. 人間ゲート・照会待ち項目が「何を・どうすれば解除か」付きで一覧化されている

**AIが構造的に完成させられないもの(ユーザーの担当・これはDoD外)**: UI採点ループ(60点→上への品質判定)・照会返答の貼り付け・PAY.JP/PayPay本番申込・実鍵/KV/バックアップ先の投入契約・cutover実行・公開・最終打鍵チェック。
分量所感: required残(約121件+UI第2弾)は1セッションで終わらない可能性がある。その場合も progress.md が常に現在地を示し、本HANDOFFを更新して次スレへ継げばよい(同じ一文で再開可能)。

## §6 参照索引

- 計画: `docs/planning/c8/PLAN-c8-full-run.md` / 進捗: `progress.md` / UI正本: `ui-asset-catalog.md` / スクショ: `screens/`+`ui-review.html`
- 裁定: `docs/planning/rulings/user-ruling-2026-07-17-round-16.md`+`round-16-answers-raw.md` / 照会文面: `inquiry-drafts.md`(送付待ち)
- 調査: `docs/planning/b2-research/research-{paypay-unification,payment-service-scan,payjp-platform}.md`
- メモリ: `ver3-phase-c8-kickoff.md` / persona: R25〜R34(質問一括・用語説明・選択肢主義・ゆる徴収・専門家コスト拒否ほか)
