---
id: HANDOFF-c7-ui-rebuild-2026-07-12
title: C7 UI 作り直し 引き継ぎ正本(見た目模写→ユースケース起点への転換)
date: "2026-07-12"
status: active
---

# HANDOFF: 全画面 UI をユースケース起点で作り直す

> 新セッションはまず本書を読み、次に `docs/planning/c7/usecase-driven-design.md`(設計正本)→ `docs/planning/c7/ui-parity-map.md`(全画面の薄さ地図)→ memory `ui-must-match-design-intent.md` の順で読むこと。
> 自律ラン既定契約(グローバル CLAUDE.md)適用。ただし本フェーズは **各画面ユーザー目視ゲート必須**(下記 §0)。

## 0. 絶対に忘れてはいけない学び(この転換が本フェーズの全て)

ユーザーが 2026-07-12 に「35点・つらい・ほんとにつらい」と表明。原因は AI が **見た目を真似て・仕様の項目を数えて・全員に全部見せる巨大フォームを作り、テストを緑にして"できました"と言った**こと。以下を鉄則とする:

1. **見た目を真似るな。ユースケースから考えろ。** 各画面の着手前に「ユースケースカード」(なぜ要る/ユーザーは何がしたくて来る/それを簡単にする最小の形)を書く。モック(`D:\mockups`)と ver2 実装(`D:\claude\systems\ihl-ver2\apps\web`)は"目標密度の参考"に留め、要素の採否はカードで決める。
2. **目的関数は「楽・使いやすい・ストレス最小」。** 情報量の多寡でなく「その目的を迷わず最短で達成できるか」。繰り返しの苦痛(100匹を1匹ずつ/毎回設定/手入力/環境再入力)を機械に肩代わりさせる(一括登録・テンプレ双方向・IoT自動取得・リンク)。
3. **全員に全部を見せない。** 画面は対象+テンプレート+ユーザーの深さから"生成"され収束する。写真だけの人には写真だけ。研究者には計測+環境。
4. **人間の目視ゲートを毎回必須に。** AI が実起動スクショを出し、ユーザーが OK と言うまで完成にしない。「動く」の自己申告は廃止。本番パリティ GATE(薄いテキスト一覧なら FAIL)も併設。
5. **浅く考えるな。** ユーザー指摘「5段以上深く。ユーザーの身になれ」。各機能を複数ユーザー像で全行程歩かせ痛点を狩る(§2 の grilling)。

## 1. 現在地(2026-07-12・全て push 済み・main)

- C0〜C6 完了(cutover 直前で停止)+ C7 T1(全画面が"クラッシュせず動く"ことは確認済・ただし密度は薄い)。第13/14回裁定済み(要件733・srs v1.8)。
- **UI の現実(パリティ地図 `ui-parity-map.md`)**: 全38画面 平均37/100。本番密度到達は4枚のみ。薄い(≤30)=20枚。**ただし18画面は既存 API に厚い UI を結線するだけ(UIのみ)で上がる。真の新規 API 要は3画面(settings PII/country-select/data-descriptor)。** = 「機能はできている。UI が薄いだけ」。
- **共有レンダラ語彙の不足(A層・一度直せば全画面に効く)**: ①複数列テーブル(11画面)②リッチカード(10)③ステータスbadge(10)④progressバー(7)。この4部品を足すと薄い20画面の潰れがほぼ解消。segmented と measurement-table は observation-input 候補で語彙化済(未 commit)。

## 2. 走行中/未 commit の作業(新セッションで回収せよ)

- **未 commit**: observation-input 候補一式(`screen-defs/observation-input.json`・renderer の segmented/date/measurement-table 拡張・スクショ `docs/planning/c7/screens/observation-input-candidate.png`)。**ユーザー判定=「届いていない・見た目模写・巨大フォームが誤り」→ 破棄 or ユースケース起点で作り直しが前提。commit するな。** 参考資産(segmented/measurement-table のレンダラ実装)は再利用可。
- **走行中(前セッション)**: `usecase-grilling` ワークフロー(5機能×ユーザー像で痛点狩り→収束設計→浅さ批評)。結果は前セッションに返る。新セッションで拾えない場合は再実行/resume:
  `Workflow({scriptPath: "C:\\Users\\sawad\\.claude\\projects\\D--claude-systems-ihl-ver3\\db514b38-8865-48a9-ac1b-b894a3b0254e\\workflows\\scripts\\usecase-grilling-wf_d3a0026e-29e.js"})`
  出力(機能ごとのユースケースカード+収束フロー+アンチパターン+浅さ指摘)を `docs/planning/c7/usecase-driven-design.md` に §3 以降として追記せよ。

## 3. 設計の確定事項(`usecase-driven-design.md` §3-§4 が正本・grilling+批評家+ユーザー回答を統合済み)

**判定の軸(ユーザー確定)**: 最優先ユーザー=本気のブリーダー(既定は量をさばく設計)。重要5画面はワイヤー先行→実装→スクショ判定・軽い画面は実装スクショだけ。品質バー=手数最少/迷わない/速い/美しい+**最重要「設計思想が伝わる=ユーザー理解の証明(ここにこのボタンが欲しかった・このグラフ見やすい)」**。

**芯の訂正(load-bearing・§4.2)**:
1. 若齢は「個体」でなく**クラッチ(匿名プール)**。100匹を個体化しない。sample/aggregate計測(10匹測って平均)。個体IDは個別容器分割/QR発行時に発生。クラッチ→個体昇格+死亡attrition照合を新設。
2. 計測は「脱皮時再計測」でなく**マット交換で掘り起こす時の便乗計測**(幼虫ストレス最小化)。再計測はお世話イベント起点。
3. フェーズ別の次お世話タイミングは**テンプレに含む**(スケジュールもテンプレ継承)。
4. intent既定は「新規」でなく**既存個体への追観測**(幽霊個体の不可逆コスト回避)。
5. 紐づけ(親/棚/IoT)は継承・ワンタップ(最大痛点)。亜種のみ候補→ユーザー確定。
6. market: コピー振込額は**本体のみ**(総額と分離・GMO照合を守る)。
7. plaza: **多数決≠正しさ**。結論候補は実観測cite/追試で裏取り済みのみ。
8. individual-detail: 親カーブ欠損(購入/ワイルド)を第一級状態に(代替コホート比較)。
9. search: カバレッジ明示だけでなく**検索時にヒット候補を同期即時ベクトル化**。

観測登録の収束フロー詳細・各機能のアンチパターン一覧は `usecase-driven-design.md` §2.4/§3。批評家は現状 still_shallow(§3末に深掘り層)→ 次のワイヤーに織り込み再度通す。

## 4. 進め方(ユーザー指示: 設計をもっと固めてから実装)

1. **設計を固める**: grilling 結果を回収 → 5機能のユースケースカードを確定 → 残り画面もカードを書く(着手前必須)。ユーザーに要所を確認(見た目でなく設計の根っこは承認を取る)。
2. **共有レンダラ部品(A層 ①〜④+segmented/table)を実装**(一度で20画面に効く)。
3. **画面ごとに: ユースケースカード→実装→実起動スクショ→ユーザー目視ゲート→パリティ GATE**。合格まで往復。薄いまま緑にしない。
4. 順序: 観測登録 → 検索(obs-navigator)→ 市場 → 個体詳細 → 知の広場スレ → …(パリティ地図 §3 と整合)。

## 5. 環境の癖(踏襲)

- Python フルパス `C:/Users/sawad/AppData/Local/Programs/Python/Python312/python.exe`(PYTHONIOENCODING=utf-8)。Workflow args 直書き。
- サブエージェントのシェル事故で repo 直下に0バイト迷子ファイル頻発→commit 前削除。生 NUL をコードに書かない。
- lint 20 GATE / npm test / pytest / apps/web の `npm run e2e`(Playwright が wrangler dev+next dev 自動起動・実スクショ可)。screen-def 追加時は navigation.json 登録+check-navigation/i18n GATE。
- wrangler: `CF_API_TOKEN`/`CF_ACCOUNT_ID`(D:\env\platform.env)を同一 PowerShell コール内で `CLOUDFLARE_*` に設定。実鍵投入・本番/DNS は人間ゲート。
- Cursor 履歴(設計の背景)実体: `C:\Users\sawad\AppData\Roaming\Cursor\User\globalStorage\state.vscdb`(SQLite ro・cursorDiskKV の bubbleId:*)。ただし観測画面の最終仕様は ver2 コードが一次資料。

## 6. kickoff(新セッションに貼る1行)

```
ultracode。docs/planning/c7/HANDOFF-c7-ui-rebuild-2026-07-12.md を読み、§0の鉄則(見た目模写禁止・ユースケース起点・楽/ストレス最小・目視ゲート毎回・浅く考えない)を守って、まず設計を固める(§4-1: grilling結果回収→ユースケースカード確定)。実装は設計確定後・各画面私の目視ゲート付きで。観測登録から。
```
