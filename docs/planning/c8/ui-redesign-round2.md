---
id: ui-redesign-round2
title: UI再設計 第2ラウンド正本(受領11=全体15点への回答・Fable設計)
date: "2026-07-17"
status: active
---

# UI再設計 第2ラウンド正本

> 受領11(UIレビュー第2弾・全体約15点)への構造回答。以後の**全UI変更はこの正本との整合が納品条件**(批評家チェックリストに追加)。設計者: オーケストレーター(Fable)。原文=`docs/planning/rulings/round-16-answers-raw.md` 受領11。

## 0. 根因と原則

- 根因: 要件単位で画面に機能を積み、**IA(情報設計)・遷移・語彙の層を誰も設計していなかった**。部品60-70点でも構造0点なら総合15点になる。
- 原則(この正本の3層):
  1. **画面マップ**: 画面は「ユーザーが何をしに来るか」1目的1画面。単機能画面は統合する。
  2. **遷移**: 概念の入口は対象側に置く(対象の「…」から開く)。タブは同じ目的の並列だけ。
  3. **語彙辞書**: ユーザーが知らない内部語を画面に出さない。

## 1. 語彙辞書(画面に出してよい語 / 禁止語)

| 内部語(禁止) | ユーザー語(正) |
|---|---|
| 相談室 / dispute / 二人部屋 | **話し合いの場** |
| 買い手/売り手(ラベル表示) | 表示しない(whenで自分のボタンだけ出す) |
| actor_id 生ハッシュ | 表示名(fallback短縮のみ) |
| listing/trade等のID露出 | 対象カード(画像+名前)で示す |
| 「この出品取引」等の複合内部語 | 買う / 出品 / 取引中 |

新語を画面に出すときは必ず: 初出画面に1行説明を添える(login 100点の条件「説明要る」を全画面規則化)。

## 2. 概念設計: 話し合いの場(ユーザー裁定 2026-07-17)

> ユーザー原文: 「わかりやすく改名して、『話し合いの場』。概念をもっと上にして。取引トラブルから、掲示板の表現がよくない指摘、出品物規約違反じゃないか?って指摘っていろんなことができる。タグや遷移もとで少し工夫すればとても便利なトラブル解決するかもしれない機能になりませんか?」

- **定義**: あらゆる対象に紐づけて開ける当事者間の部屋。構成 = 対象カード(元の取引/投稿/出品へ戻れる)+用途タグ+メッセージ+合意記録。
- **用途タグ**: `取引トラブル` / `表現についての指摘` / `規約違反の疑い` / `その他の相談`
- **入口(遷移元)**: 対象側の「…」メニューのみ。ナビ常設はしない。
  - 取引詳細 →「トラブルについて話し合う」
  - 掲示板投稿 →「この表現について話し合う」
  - 出品 →「規約違反の疑いを相談する」
- **出口**: ①合意(合意文が記録に残る=透明ログ) ②不成立→「公開して投票」(GOV-07・当事者opt-in・7日) ③立ち消え(期限で自動クローズ)
- **自分の話し合い一覧**: ホームの司法インボックス(GOV-11)とマイページに出す。
- 実装ノート: 既存 gov-dispute イベント+market-flag+GOV-10(指摘30回=1PT)を統合。originとtagはadditiveなフィールド追加(既存型リネーム禁止)。

## 3. 画面マップ(一次ナビ)

```mermaid
flowchart LR
  H[ホーム 司令塔] --> OBS[観測 登録3画面/検索]
  H --> IND[個体 一覧/詳細/血統]
  H --> MKT[市場: 買う | 出品]
  H --> TRD[取引中 一覧→取引詳細]
  H --> KNW[知の広場 スレ一覧→スレッド]
  H --> ME[マイページ/設定]
  MKT -- 成立 --> TRD
  TRD -. 「…」トラブル .-> HAN[話し合いの場]
  KNW -. 「…」表現指摘 .-> HAN
  MKT -. 「…」規約疑い .-> HAN
  HAN -- 不成立 --> VOTE[公開投票 GOV-07]
```

- **市場のタブは「買う」「出品」の2つだけ**。「この出品/取引」タブは廃止。
- **取引中は独立画面**(ユーザー裁定)。ホームtoday_linesに「進行中の取引 N件」を出す。

## 4. 画面別 After(受領11の9画面)

### 4.1 market(買う/出品) — 60/70点→
- タブ2つ: 買う(画像グリッド・画像タップで詳細)/ 出品(自分の出品管理+新規出品)。
- 「買い手」等の役割ラベル・自明な説明文を全削除。成立時は「取引中に移動しました」トースト+リンク。

### 4.2 取引中(新画面) — 旧取引ボードの移設
- 一覧: 1取引=1行カード(相手表示名・対象サムネ・現在ステップ・**自分の次アクションボタン1つ**)。
- 詳細: ステップバー(合意→支払→発送→受取→完了)。whenで自分のアクションのみ表示。テキスト最小。

### 4.3 knowledge-thread — 0点→ 作り直し
- **議題カードを最上部に固定**: スレ主の提案/質問+目的1行+**賛成・反対・保留はここ1箇所だけ**(集計バー付き)。
- 本文=会話に専念: 返信・引用返信のみ。入力欄は下部固定(話しやすさ最優先)。
- 投稿の「…」= 引用 / リンクコピー / この表現について話し合う(→話し合いの場) / 通報。
- スレ一覧(knowledge-board)の説明1行: 「スレ=議題1つを持つ話し合い」。

### 4.4 話し合いの場(旧dispute) — 0点→ §2の概念で全面再設計
- ヘッダー=対象カード+用途タグ。本文=2者メッセージ。フッター=「合意する」「公開して投票」。

### 4.5 login — 100点維持
- 変更なし+初見向け説明1行(「メールアドレスだけでログインできます。パスワードはありません」)。

### 4.6 login-sent — 0点→ 主従是正
- 主: 「メールを送りました。**届いたリンクをクリックするとログイン完了**」+再送。
- 従(折りたたみ): 「別の端末でメールを開いた場合 → 6桁コードを入力」(OQ-ONB-03はフォールバックに格下げ)。

### 4.7 setup(country+language統合) — 90/0点→ 1画面
- setup-profile 1画面に: handle+表示名+**言語(必須・上)**+**国(必須・下・「表示されません。地域ルールの適用にだけ使います」1行)**。country-selectの見た目(90点)を正とする。language-select画面は廃止。

### 4.8 terms — 30点→
- タブ: **わかりやすい版(要約カード)⇔ 正式版(全文)**。同意ボタンは両タブ共通下部。
- 解説動画/ショート導線枠: 設定に動画URLが存在する時だけ表示(空なら非表示。「準備中」表記はしない)。

## 5. レビュー運用

- 本正本のAfter案は**判定シート**(T-40方式: カード+採点欄+自動保存+総合GO/NO)で提示→ユーザーGO後に実装→スクショ→再採点。
- 以後のUI変更PRは批評家が本正本(語彙辞書/画面マップ/遷移)との整合を必ず検査する。

## 6. 全画面自己監査(2026-07-17)

> 本節は6レーンのUI自己監査を独立批評家が横断整合・抜き取り再採点し、§3画面マップ・§1語彙辞書との矛盾を補正した統合正本。採点は**スクショ+screen-def静的監査**であり実操作は含まない(限界は§6.4)。§4で既に扱った9画面(market/取引中/knowledge-thread/dispute/login/login-sent/setup/terms)+ country-select/language-select は本節の対象外(§4が正)。本節が新規に扱うのは残り46画面。

### 6.0 横断整合の判定(批評家ゲート)

**A. disposition と §3画面マップ・OBS-25 の整合 — PASS(1点補正あり)**

- obs-register 系の統合提案(obs-register「対象を選ぶ」→obs-register-entry「入力」→obs-register-confirm「確認」→obs-register-done)は、要件 **V3-OBS-25「観測登録は3画面フロー(対象を選ぶ→入力→確認)・入力単体での即時保存禁止」**(`01-requirements/registry.json`・`docs/planning/c8/progress.md:337` done)および §3画面マップ `OBS[観測 登録3画面/検索]` と**一致**する。旧 obs-entry(1画面で対象選択+入力を兼ね、obs-confirm へ直行)を retire して新3画面へ寄せる方向は OBS-25 準拠を**強める**もので矛盾なし。
- ただし **retire は「未完了 cutover」であって即時削除ではない**。`home.json:73` の主導線「観測を始める」は今も旧 `obs-entry` に向き、`apps/web/e2e/observation.spec.ts:64` は `obs-entry→obs-confirm` を OBS-25 の正本経路としてテストしている。obs-register.json 自身の notes も「既存 obs-entry/obs-confirm は無変更(cutover は後)」と明記。従って obs-entry/obs-confirm の retire は **(a) home.json の start-observe 差し替え + (b) E2E ラベル契約の新フロー移行** を前提条件とする(§6.2 に依存関係を明記)。

**B. §4.7(language-select 廃止・country+language を setup-profile 統合)と実装の整合 — FAIL(要追従)**

- `screen-defs/navigation.json` は §4.7 で廃止決定済みの `login→country-select→language-select→terms` 辺(61-79行)と、再設計後の `login→setup-profile→home` 辺(487-495行)を**両方**保持している。§4.7 は navigation.json 側にまだ反映されていない。IA 変更一覧に「旧オンボーディング辺の削除」を明示計上する。

**C. cross/bio-card の扱いと §実装の整合 — FAIL(3者ズレ)**

- `individual-detail.json` の note は cross/bio-card を「死にUIを出さない」としノード木から遷移ボタンを削除済みだが、`navigation.json:192-200` は individual-detail→cross・→bio-card 辺を現役として保持。要件 V3-IND-12 は「血統(cross)は個体詳細経由必須」と定めるのにその経由路が実装から消えている。**navigation.json・要件・実装の3者が不整合**。裁定で cross を「individual-detail 内セクションへ統合」か「正式 retire」に確定し navigation.json を追従させる必要。

**D. 語彙辞書(§1)違反の横断残存 — FAIL(lint 化推奨)**

- §1 禁止語の精神に反する内部語が各画面に個別残存: 「正本」(knowledge-hub 論文カード)・「フォーク/Fork」(knowledge-hub/knowledge-github/species)・「Builder」(全画面共通フッター)・「条件P」(paper-detail/knowledge-paper・要件変数名の流出)・「manual/manual入力/(R2)」(costs)・「V3-OBS-72」(obs-detail/placement-qr 見出し・**内部チケット番号がユーザー向け見出しに露出**)・「Cursor / docs/…howto.md」(ai-sessions・開発者向けツール名とリポジトリ内パス)。見出し/ラベル文字列に `V3-[A-Z]+-\d+` や `\{\{` を含む screen-def を機械 GATE で弾く lint を推奨。

**判定: PASS(条件付き)** — disposition の大枠は正本と整合。ただし navigation.json への追従(B/C)と cutover 依存(A)を IA 変更として明示することを納品条件とする。

### 6.1 全画面自己監査表(予測点 昇順・46画面)

> 「予測点」は批評家補正後。★=批評家がスクショを実見して再採点し原採点より辛口補正した画面(理由は§6.4)。

| # | screen | 予測点 | 主違反(1つ) | 処置 | After方針(一言) |
|---|---|---|---|---|---|
| 1 | ai-sessions | 5 | Cursor/リポジトリ内パス等の開発者内部文言を直接露出 | retire | 一般設定から外し開発者専用面へ隔離 |
| 2 | project-hub | 10 | オーファン画面(inbound edge 0)+「バージョン分岐」等git語を無説明 | fix/裁定 | 概念が一般ユーザーに必要か人間裁定 |
| 3 | data-descriptor | 15 | ナビ辺皆無で到達不能+「Data Descriptor/claim」未翻訳 | fix/裁定 | 導線新設+訳語 or 正式凍結を裁定 |
| 4 | obs-domain-select | 15 | 遷移先 obs-entry 内と完全重複の単機能画面 | retire | 廃止(ドメインは次画面先頭1フィールドへ) |
| 5 | paper-detail | 15 | オーファン+「条件P」内部変数露出 | fix/裁定 | 知の広場→論文へ組込み+ユーザー語化 |
| 6 | research-newspaper | 15 | オーファン+固定ボタンが対象論文と無関係 | fix/裁定 | 導線追加+生成主体の説明を明示 |
| 7 | theme-gallery | 15 | 設定のテーマselectと完全重複・行き止まり | merge→settings | 設定へ統合し廃止 |
| 8 | cross | 15 | 率カード3枚とも空欄(UI未結線)+経由路消失 | merge→individual-detail | 詳細内セクション化・実結線まで凍結 |
| 9 | individual-detail | 20 | id無しnavigateで常に未検出+未検出でもQR表示 | fix | 実ID遷移入口を復活・未検出時QR隠す |
| 10 | knowledge-github | 20 | 外部リンク1つの単機能なのに独立画面 | merge→knowledge-hub | hubカード直リンクへ統合し廃止 |
| 11 | ui-templates | 22 | home導線「選ぶ」に反し保存フォームのみ | fix | ラベルを実態(保存)に統一 or 一覧実装 |
| 12 | match | 25 | screen-defに画像ノード皆無(核心の直感評価不能) | fix | 画像+種/名前を必須表示・目的1行明記 |
| 13 | paper-match | 25 | 2入口がid未継承+生URLクエリ露出 | fix | id継承navigate+観測記録からの実ボタン橋渡し |
| 14 | research-search | 25 | オーファン+結果行タップ不可 | fix | 導線追加+結果行を個別遷移化 |
| 15 | obs-templates | 28 | 1保存1項目でテンプレを作れない+生ID手入力 | fix | 複数項目繰り返し入力+ID select化 |
| 16 | knowledge-board | 30 | スレ一覧各項目がタップ不可(遷移未実装) | fix | 各スレカードを該当スレへ遷移化 |
| 17 | obs-confirm | 30 | 入力計測値を確認画面に一切表示せず機能不全 | merge→obs-register-confirm | obs-entryごと退役 |
| 18 | obs-navigator | 30 | 分類ツリーに Family0-3 プレースホルダ露出 | fix | 実データ化+「種の判定」に改名しobs-register-new補助へ |
| 19 | platinum-shop | 30 | 購入前確認なしの即時POST(c7でアンチパターン) | merge→economy-status | ステータス内1セクション化・2ステップ確定 |
| 20 | qr-resume | 30 | 続行ボタンが旧obs-entryへ誤誘導・個体カード無し | fix | 遷移先をobs-register-entry・個体カード化 |
| 21 | device | 33 | 設置場所の生IDが画面上どこにも出ず入力不能 | fix | 既存一覧からのselectに変更・プロバイダもselect |
| 22 | bio-card | 35 | 種/サイズ空欄・一括発行UI無し・生きた導線無し | fix | 複数選択+枚数UI・個体一覧から入口新設まで凍結 |
| 23 | obs-entry | 35 | 対象/父/母個体IDを生値入力・obs-register-entryの劣化版 | merge→obs-register-entry | 個体/生物観測は新フローへ統合しretire |
| 24 | knowledge-paper | 35 | 論文一覧が描画されない(source_path不整合) | fix | source_path修正+論文照合の意義を1行説明 |
| 25 | obs-detail ★ | 38 | {{data.lab-env…}}が未展開の生表示+V3-OBS-72露出 | fix | interpolate正規表現1箇所修正+ticket番号除去 |
| 26 | species | 40 | fork元ID欄に必要な生IDが一覧に出ず入力不能 | fix | fork参照をselect化・表記統一・空状態文言 |
| 27 | profile | 40 | 「BAN: false」生真偽値表示・empty_text未到達バグ | fix | 値有無判定に根治・状態ラベル化・economy統合 |
| 28 | template-market | 40 | ランキングにempty_text無く0件時完全空白 | fix | empty_text追加+対象範囲1行+置き場所再検討 |
| 29 | home | 42 | 設定見出し下にステータス/取引/コストchip混在(IA誤配置) | fix | KPI+次の一手+6大導線に削ぎ落とし・スクショ再生成 |
| 30 | placement-qr | 45 | {{data.lab-env-current…}}生表示+V3-OBS-72露出 | fix | obs-detailと共通のinterpolate修正で解消 |
| 31 | economy-status | 50 | PT影響力残高が新語のまま無説明 | fix | c7統合案でprofile/platinum数値を集約・1行説明・再撮影 |
| 32 | settings | 50 | レビュー対象スクショが現行JSONより大幅に古い | fix | 現行JSONで再生成後に採点・UI露出トグル隔離 |
| 33 | obs-register | 55 | homeから到達不可の孤立(cutover未実施) | fix | homeの「観測を始める」をここへ差し替え唯一の入口に |
| 34 | knowledge-hub ★ | 60 | 「正本」「フォーク」「Fork」「Builder」内部語が一画面に集中 | fix | 内部語をユーザー語へ置換・フッター内部語精査 |
| 35 | costs | 63 | 「manual入力/manual/(R2)」内部タグ+円/JPY混在 | fix | 「(手動入力)」等へ統一・通貨を円に統一 |
| 36 | ai-profile-settings | 65 | 「検索補助(RAG)」略語を無説明露出 | fix | 略語除去+実行場所選択に結果影響を一言 |
| 37 | obs-freetext | 65 | 解析結果に個体IDを生値表示(語彙辞書違反) | fix | 個体表示をカード化しID非表示・代替入力価値は維持 |
| 38 | obs-register-batch-confirm | 65 | 未選択の空状態のみで実データ表示品質未検証 | fix | 選択済み状態で再検証・タイトル差別化 |
| 39 | obs-search ★ | 68 | サムネイル未表示(画像直感評価の設計意図に未達) | keep/fix | 実データでサムネイル表示確認・per-item action済み |
| 40 | obs-register-confirm | 70 | スクショが体重/体長とも空値で実データ未検証 | fix | 実データ再検証+タイトルを「観測の確認」等へ差別化 |
| 41 | obs-register-batch-done | 70 | 空状態のみで実データ未検証 | keep | 実データ再撮影のみ(構成は良好) |
| 42 | obs-register-done | 78 | 空値表示で実データ未検証(構成は良好) | keep | 実データ再撮影のみ |
| 43 | obs-register-entry ★ | 78 | 対象個体が空アバターのみで名前/写真カード無し・Δ未検証 | keep/fix | 個体カード化+実データでΔ表示再検証 |
| 44 | obs-register-batch | 80 | 「該当457件」等の内部集計語が無機質に露出 | keep | 件数文言を運用データ後に調整 |
| 45 | obs-register-new | 80 | 1440pxで下半分が大きく余白 | keep | 現状維持(将来モーダル統合は任意) |
| 46 | obs-register-clutch | 83 | 情報量多く1440pxでも縦長 | keep | 現状維持(ID遅延発行の説明が優秀・正本化) |

**分布**: ≤20点=10画面(構造欠陥・オーファン・純重複)/21-40=15画面/41-60=8画面/61-83=13画面。**低得点の主因は個別部品の質でなく「IA(到達性)・遷移(id継承)・語彙(内部語)」の3層**で、受領11の根因診断(部品60-70点でも構造0点なら総合15点)を追認する。

### 6.2 画面統合・廃止の提案(IA変更一覧: 55画面 → 確定44 / 裁定込み最大~38)

**確定分(重複・既決・死にUI — 55画面から11画面を除去 → 44画面)**

| # | 変更 | 理由(1行) |
|---|---|---|
| 1 | language-select を廃止 | §4.7 既決・setup-profile に統合済み方針 |
| 2 | country-select を setup-profile に統合 | §4.7 既決・country+language 1画面化 |
| 3 | obs-domain-select を retire | obs-entry 内ドメインselectと完全重複(language-select 0点と同型) |
| 4 | obs-entry を retire → obs-register-entry | 個体/生物観測は新OBS-25フローで代替可(cutover依存: home導線+E2E移行) |
| 5 | obs-confirm を retire → obs-register-confirm | 計測値を表示しない機能不全の旧確認画面・新confirmで代替 |
| 6 | obs-search を obs-register に統合しグローバルnav項目削除 | 対象検索の入口3重複(global nav/自画面/obs-navigator)を1つに |
| 7 | knowledge-github を knowledge-hub カード直リンクに統合し廃止 | 外部リンク1つの単機能・独立画面の必然性なし |
| 8 | theme-gallery を settings に統合し廃止 | 設定のテーマselectと完全重複・付加価値ゼロ |
| 9 | platinum-shop を economy-status の1セクションに統合 | c7 usecase-driven-design 既決・購入前確認2ステップ化を同時実施 |
| 10 | cross を individual-detail 内セクションに統合 | 死にUI・遷移路消失済み・実結線まで単独画面凍結 |
| 11 | ai-sessions を一般ナビから除外し開発者専用へ隔離 | Cursor等の開発者内部文言・一般ユーザーの利用理由なし |

**遷移/バグ根治(画面数は変えないが導線・実装の是正)**

| # | 変更 | 理由(1行) |
|---|---|---|
| 12 | home「観測を始める」を obs-entry → obs-register に差し替え | OBS-25新フローを唯一の入口にする cutover 本体 |
| 13 | home「ドメインから選んで始める」(→obs-domain-select)を削除 | obs-domain-select retire に伴う導線除去 |
| 14 | home「個体を開く」navigate に ?id 付与 or 個体一覧経由へ変更 | id無しnavigateで individual-detail が常に未検出になるバグ是正 |
| 15 | qr-resume の遷移先を obs-entry → obs-register-entry に差し替え | 物理QR接点が旧劣化フローへ誤誘導している非一貫性の是正 |
| 16 | obs-navigator を「種の判定」に改名し obs-register-new 補助リンクへ付替え | 「対象を特定する」が個体選択と混同・Family0-3ダミーを実データ化 |
| 17 | navigation.json の旧 login→country→language→terms 辺を削除 | §4.7 反映漏れ(旧オンボーディング辺が新setup-profile辺と共存) |
| 18 | navigation.json の cross/bio-card 辺を実装(消失)に追従 | navigation.json・要件V3-IND-12・実装の3者不整合を解消 |
| 19 | interpolate() 正規表現を `[\w.-]+` に修正 | ハイフンid(lab-env等)未展開を共有関数1箇所で根治(obs-detail/placement-qr両方が直る) |
| 20 | CardNode の empty_text 判定を bind_text 有無→解決後の値有無へ | profile他の死んだempty_text・未解決テンプレ露出を根治 |
| 21 | knowledge-board/research-search の一覧行を per-item action/href 化 | 文脈なし固定リンク→行タップ遷移(ai-sessions.json href_tpl パターンに倣う) |
| 22 | device/species/obs-templates の生ID手入力欄を既存一覧select化 | 参照先IDが画面に出ず入力不能な3画面を共通コンポーネントで解消 |
| 23 | 共通フッター Fork/Builder・「掲示板を開く」トースト・「通知」リンクを精査 | 全画面共通chrome の内部語露出+未実装リンク(通知→home直行) |

**裁定待ち(構造大・人間ゲート — 追加で最大6画面を凍結/統合すれば ~38画面)**

| # | 変更 | 裁定事項 |
|---|---|---|
| 24 | profile + economy-status を1ステータス画面(3セクション)に統合 | c7既決だがカルマ/貢献度の正本一本化を伴う大変更・GO確認要 |
| 25 | 研究論文クラスタ(paper-detail/project-hub/research-search/research-newspaper/data-descriptor)の扱い | 知の広場「論文」柱配下に導線新設 or 本ラウンド対象外として正式凍結 |
| 26 | 非生物ドメイン観測(鉱物/デジタル/場所/カスタム)の要否 | obs-entry retire 後、需要が実在するなら別途最小画面で再設計・不要なら完全廃止 |

### 6.3 ワースト10 詳細After方針(受領11の9画面と同粒度)

**W1. ai-sessions(5点)— 一般面から隔離**
- 現状: Cursor 等のAIチャットログ一覧を Settings 配下に露出。「Cursor」「docs/knowledge/ai-session-ingest-howto.md」という開発者ツール名・リポジトリ内パスをそのままエンドユーザーに提示(全違反中最重度)。
- After: settings のサブメニューから外す。開発者/管理者専用の隔離面(ui_exposure=developer 時のみ表示)へ移設。一般ユーザーには存在ごと非公開。

**W2. project-hub(10点)— 概念の要否から裁定**
- 現状: navigation.json に inbound edge 皆無のオーファン。「最良バージョン」「バージョン分岐」「ロットQR」等 git/version 比喩を生体データに無翻訳で適用、「プロジェクト」が何を指すか説明皆無。
- After: 導線追加より先に「この概念(プロジェクト=版管理された飼育系統)が一般ユーザーに必要か」を人間裁定。必要なら version/branch 語を「系統」「分岐飼育」等へ全訳+1行説明。不要なら凍結。

**W3. data-descriptor(15点)— 訳語+導線 or 凍結**
- 現状: オーファン(URL直打ちのみ)。見出し「Data Descriptor」が英語学術語のまま無説明、プレビュー内「claim」も無説明の英語専門語。
- After: knowledge-hub「論文」柱から遷移導線を新設し「データ記述(論文の観測データ定義)」等の訳語+1行説明を付す、または本ラウンド対象外として明示凍結。研究論文クラスタ一括で裁定(§6.2 #25)。

**W4. paper-detail(15点)— 知の広場に組込み+ユーザー語化**
- 現状: オーファン。ボタン「条件Pで観測を照合する」の「条件P」は要件定義の変数名がそのまま流出、遷移先 paper-match へ id 継承もしていない。「論文」「マニフェスト」の説明も画面に無い。
- After: 知の広場→論文の流れに本画面を組み込む。「条件P」→「この論文が求める観測条件」等へ置換。paper-match への navigate に `?id={{params.paper_id}}` を付与し継承させる。

**W5. research-newspaper(15点)— 生成主体の説明+対象論文紐付け**
- 現状: オーファン。「関連する論文を開く」が対象論文と無関係な固定ボタン。生成主体・目的の説明が皆無で初見には謎の存在。
- After: 知の広場配下に導線追加。「AIが自動生成した研究課題ダイジェスト」等の生成主体説明を冒頭に1行。各記事から対象論文への per-item 紐付けリンクへ修正。

**W6. cross(15点)— individual-detail 内へ統合し凍結**
- 現状: 死亡率/完品率/羽化不全率の値が3枚とも空欄(集計APIは在るがUI未結線)。要件 V3-IND-12 の「個体詳細経由必須」の遷移が実装から消失、n数・対象個体名も皆無。
- After: individual-detail 内の「この血を次に使うか」セクションへ統合。実データ結線+n数・対象個体名表示+ドリルダウンが実装できるまで単独画面は凍結。navigation.json の cross 辺を追従。

**W7. obs-domain-select(15点)— 廃止**
- 現状: 観測ドメインを選ぶだけの単機能画面。遷移先 obs-entry 内に同じ「観測ドメイン」selectが既存で100%重複。主要ユースケース(生物観測)では画面自体が不要。round2 が0点認定した language-select と同型。
- After: 廃止。ドメイン選択を残す場合でも次画面の先頭1フィールドへ統合(country+language統合と同方針)。home の「ドメインから選んで始める」導線も除去。

**W8. theme-gallery(15点)— settings へ統合し廃止**
- 現状: テーマ閲覧専用で適用は別画面(設定)必須の分割過剰。リスト項目は非クリックの行き止まり。設定のテーマselectと内容が完全重複しプレビュー等の付加価値ゼロ。
- After: 設定画面のテーマ選択へ統合。フォーク済みテーマのプレビューを見せたいなら、その機能ごと設定内に実装する(単独画面は作らない)。

**W9. individual-detail(20点)— 実ID遷移の復活+未検出時のUI整合**
- 現状: home「個体を開く」が id 無しで navigate するため必ず「個体が見つかりません」。にもかかわらず未検出状態でも「QRラベルを発行する」ボタンと実QRコードが表示される(対象整合違反・スクショで実見確認)。cross/bio-card への導線は nav.json 記載のみで実体消失。
- After: 個体一覧/検索から実IDで遷移する入口を復活(home の navigate に `?id` 付与 or 一覧経由化)。未検出時は QR 発行導線を隠す。実データで再撮影し「個体のホーム画面」として再採点。

**W10. knowledge-github(20点)— knowledge-hub へ統合し廃止**
- 現状: GitHubの改善履歴・フォークへ外部リンクで飛ぶだけの単機能。「フォーク」が無説明の git 内部語のまま、内容1行で大半空白でモバイルでも間延び。
- After: knowledge-hub の「GitHub掲示板」カードから直接外部リンクを開く形に統合し本画面は廃止。「フォーク(改善版の枝分かれ)」等の1行説明をカードに添える。

### 6.4 監査の方法と限界(誇張ゼロ)

- **方法**: 各画面の (a) 1440px/390px スクリーンショット目視 + (b) `screen-defs/*.json` と `screen-defs/navigation.json` の静的読解 + (c) `apps/web/src/renderer/renderer.tsx` の該当ロジック照合。ナビ到達性は navigation.json の edges を全数走査して inbound edge 0 のオーファンを機械的に特定。
- **実操作していない**: ボタン押下・フォーム送信・実データ投入は行っていない。従って「保存が本当に走るか」「Δ表示が実データで正しく出るか」等の**動的挙動は未検証**。confirm/done/batch-confirm/batch-done/qr-resume 等はスクショが空値/未選択状態で撮られており、実データでの表示品質は再撮影・再採点が必要(表内で該当画面に明記)。
- **スクショ陳腐化リスク**: home/settings/economy-status/profile のスクショは screen-def より前のコミット(ad65a01 等)で生成されており、現行JSONと不一致の疑い。これら4画面の予測点は**暫定**で、現行JSONでの再生成後に確定させる。
- **確定バグ(スクショ非依存)**: interpolate() のハイフンid未展開(renderer.tsx:146)と id無しnavigate(home.json:85 等)は、スクショ条件と無関係な再現性のあるコードバグとして扱った。前者は obs-detail スクショで生テンプレ文字列を、後者は individual-detail スクショで「個体が見つかりません+QR」を実見して裏取り済み。
- **予測点の性質**: 本表の点数は受領11相当のユーザー最終採点を**予測**したものであり、最終採点ではない。批評家は6レーンに約5〜12点の甘さ(特に obs-detail:50→38)を検出し辛口側へ補正したが、実操作・実データを伴うユーザー採点はさらに変動しうる。
- **スコープ外の明示**: §4 で扱った9画面+country/language-select は本節対象外。研究論文クラスタ5画面・非生物ドメイン観測・profile+economy-status統合は人間裁定待ち(§6.2 #24-26)。
