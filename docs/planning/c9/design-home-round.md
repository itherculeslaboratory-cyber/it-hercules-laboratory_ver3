---
id: design-home-round
title: J-A 再訪ホーム司令塔 ラウンド設計書
date: "2026-07-18"
status: draft
---

# J-A 再訪ホーム司令塔 ラウンド設計書

> スコープ: (a) home 1画面の表示是正(センター勝ちパターン移植) + (b) テーマ切替のアプリ本体配線(theme.js横展開)。
> 含まない: 取引中N件バッジ(J-C依存)・ENTRY側(J-Bバックログ)・新機能の発明。
> 本ラウンドが触ってよいのは `screen-defs/home.json` と、テーマ配線に必要な最小のアプリ本体ファイルのみ。

## ① 目的とユースケース(逐語根拠)

- ユーザー裁定(2026-07-18・J-A採用): **「使いやすくわかりやすくしてくださいね。」** — 本ラウンドの合格軸はこの一文のみ。開発都合の説明では合格しない。
- 元の目的宣言(P-66、朝の報告要望):

  > 進捗どうですか？　朝の報告ください。何がどこまで完了しているのか？また私の判断が必要なのを聞いたりレビューを軽くしたら、新しいスレッドで、残りをやってほしいと思っています。

  → home はこの「進捗(今日の状態)・今やること・(判断が要るなら)何が届いているか」を**再訪のたびに10秒で** 見せる画面である。判断依頼は絞って軽量に、が同じ逐語の要請。

- ユースケース: 再訪ユーザーが `/`(home)を開く → 見出し直下の1行で「今日の状態」「今日やること」「届いた出来事」の数がわかる → 該当があれば1クリックで詳細(記録する/話し合いを見る)へ飛ぶ → なければ「観測を始める」で新規行動に進む。
- スコープ境界(このラウンドが判断しないこと): 取引中の件数表示(J-C=別ラウンド見送り済み)・login〜home初回導線(J-B=バックログ)・home に載っていない新機能の考案。
- 実データ主義: 「届いた出来事」に使うのは実在API(`GET /api/v1/home/summary` が返す `judicial_inbox`)のみ。存在しないデータ源は作らない(下記②の「使わないと判断したデータ」参照)。

## ② 現状→改修後のhome構成

### 現状(実装棚卸し・screen-defs/home.json 全ノード)

| 順 | id | type | 表示文言 | データバインド |
|---|---|---|---|---|
| 1 | title | heading | 観測ホーム | - |
| 2 | lead | text | 今日の状態と次の一手だけをここに置いています。 | - |
| 3 | ledger(card) | card | 今日の状態 | `/api/v1/me/ledger` |
| 3a | kpi-karma | kpi-tile | **カルマ**(語彙辞書違反) | `data.ledger.karma_value` |
| 3b | platinum | text | プラチナコイン: … | `data.ledger.platinum_coins` |
| 4 | todaystats | kpi-tile | 超過 | `/api/v1/home/summary` → `data.todaystats.overdue.length` |
| 5 | kpi-near | kpi-tile | 近接 | `data.todaystats.near.length`(todaystats相乗り) |
| 6 | today-title | heading | 次の一手 | - |
| 7 | today | table | 個体/日数/記録する | `data.todaystats.today_lines` |
| 8〜12 | civ-* | heading/text/kpi-tile×3 | 文明の状態 一式 | `/api/v1/home/civ-minimap` |
| 13〜14 | start-observe / guide-select | button/link | 観測を始める / ドメインから選んで始める | navigate/href(**id/label/href固定・click-budget契約**) |
| 15〜21 | feature-nav-title + open-*×6 | heading + button/link | 各機能へ 一式 | navigate/href(**固定**) |
| 22〜25 | feature-title + open-theme/open-ui-templates/open-settings | heading + link | 設定とテーマ 一式 | href(**固定**) |
| 26〜28 | chip-* ×3 | link(chip) | ステータス/取引/運営コスト | href(**固定**) |

### 改修後(①〜③のみ変更、④以降は無変更)

| 順 | id | type | 変更 | UI文言(平易語) | データバインド |
|---|---|---|---|---|---|
| 1 | title | heading | 無変更 | 観測ホーム | - |
| 2 | lead | text | 無変更 | 今日の状態と次の一手だけをここに置いています。 | - |
| 3 | here-title | heading | **card解体→単独見出しに降格**(下の4タイルの見出しへ転用) | 今日の状態 | - |
| 4 | todaystats | kpi-tile | **並び順を先頭へ**(センターパターン③=優先タイルを最も目立つ位置へ。色分けの代替は§③参照) | 超過 | `/api/v1/home/summary` → `data.todaystats.overdue.length`(無変更) |
| 5 | kpi-near | kpi-tile | 位置のみ変更 | 近接 | `data.todaystats.near.length`(無変更) |
| 6 | **kpi-inbox(新設)** | kpi-tile | 新規。既存fetch(todaystats)に相乗り、新規API呼び出しなし | 届いた出来事 | `data.todaystats.judicial_inbox.length`, fallback `"0"` |
| 7 | kpi-karma | kpi-tile | **id/type無変更、labelのみ是正**(語彙辞書#8)、位置を4番目(最後)へ | ~~カルマ~~ → **貢献度** | `data.ledger.karma_value`(無変更)。**card解体に伴い自前`source_path:"/api/v1/me/ledger"`を追加**(todaystatsと同じ「自前fetchのkpi-tile」パターンを再利用・新規機構なし) |
| 8 | platinum | text | card解体→タイル列直下の1行キャプションへ降格(id/内容無変更) | プラチナコイン: {{value}} | `data.ledger.platinum_coins`(無変更) |
| 9 | today-title | heading | 無変更 | 次の一手 | - |
| 10 | today | table | 無変更 | 個体/日数/記録する | `data.todaystats.today_lines`(無変更) |
| 11 | **inbox-title(新設)** | heading | 新規 | 届いた出来事 | - |
| 12 | **inbox-table(新設)** | table | 新規。列は実在フィールドのみ(下記「使わないデータ」参照) | 締切 / 話し合いを見る(link) | `bind_items: data.todaystats.judicial_inbox`、`empty_text: "新しく届いた話し合いはありません"` |
| 13〜 | civ-* 以降 | (無変更) | — | — | — |

**inbox-table の列定義(案)**:

```json
{
  "id": "inbox-table",
  "type": "table",
  "props": {
    "bind_items": "data.todaystats.judicial_inbox",
    "empty_text": "新しく届いた話し合いはありません",
    "columns": [
      { "key": "vote_deadline", "cell": "date", "label": "締切" },
      { "key": "dispute_id", "cell": "link", "href_tpl": "/s/dispute?dispute_id={{dispute_id}}", "link_label": "話し合いを見る" }
    ]
  }
}
```

`cell:"date"`・`cell:"link"` は renderer 既存セル型の再利用(`cell:"link"`=`today`テーブル実績、`cell:"date"`=`ai-sessions.json`/`market-trade.json`実績。renderer.tsx L1214, L1231)。新規セル型は作らない。

### 使わないと判断したデータ(正直表示)

- **`iot_due`**: `apps/api/src/home-routes.ts:313` を確認した結果、`iot_due = [...summary.overdue, ...summary.near].slice(0,3)` — 名前は「環境IoT予定」だが実体は `today` テーブルに既に出ている超過/近接個体の再スライスであり、独立データではない。ここに別枠で出すと同じ出来事を二重表示する不誠実UIになるため、本ラウンドでは**使わない**。
- **`category`(話し合いの種類 market/board/bugfix)**: `schemas/events/gov-dispute.schema.json` の enum値がそのまま英語dev語であり、renderer の `badge` セルは真偽値の `true_label/false_label` しか持たず(renderer.tsx L1204-1206)、3値の文字列→日本語ラベル変換機構が無い。3値のためだけにrendererへ新規propを足すのはreuse-firstに反するため、本ラウンドの列からは**外す**(「締切」と「話し合いを見る」だけで用は足りる)。将来 category を出したくなったら、この変換機構の追加を独立で判断する。
- **`observing`・`karma_count`**: API は返すが home のどの版でも未使用。今回も追加提案しない(YAGNI・要求されていない情報を増やさない)。

### 語彙辞書(structure-canon.md §3)是正一覧

| # | 現状 | 是正後 | 出典 |
|---|---|---|---|
| 1 | `kpi-karma` の label = 「カルマ」 | 「貢献度」 | 語彙辞書#8「karma(内部名)→貢献度」 |

**このラウンドでは直さない既知の違反(範囲外)**: `screen-defs/dispute.json` の title「紛争相談室」は語彙辞書#1(dispute→話し合いの場)に抵触している。home からこの画面へ新規リンクを張るが、home はリンク先画面の中身までは修正しない(スコープはhome 1画面)。ENTRY/GOVゾーンの宿題として記録のみ。

## ③ テーマ配線の実装計画

現況(HANDOFF-c9-close-2026-07-18.md §3、実ファイル確認済み): `apps/web/public/assets/theme.js` は存在し `apps/web/src/app/tokens.generated.css` の `[data-theme="light"|"dark"]` 上書きブロックも実装済みだが、**Next.js アプリ本体(`apps/web/src/app/layout.tsx`)は theme.js を読み込んでおらず、`<html>` に `data-theme` を一切載せていない**。caseB7の2ページ(`finder.html`/`universe.html`)だけが素の `<script src>` で読み込んでいる状態。

### 触るファイル(3つ、すべて既存ファイルへの追記のみ・新規ファイルなし)

| ファイル | 変更内容 | 理由・再利用ラダー |
|---|---|---|
| `apps/web/src/app/layout.tsx` | ~~`next/script` beforeInteractive~~ → **【実装時修正】素のJSX `<script src="/assets/theme.js">` を `<body>` 先頭子要素に置く** | 実装時にNext.js 15.5系の `beforeInteractive` が真のブロッキングscriptを出力しない(`__next_s`キュー経由で非同期実行=実FOUCをE2Eで実測)ことが判明。素の同期scriptタグがtheme.jsの「可視コンテンツより前に同期実行」契約(theme.js:16-18)を満たす正しい形 |
| `apps/web/src/renderer/renderer.tsx`(`AppShellNode`) | ヘッダーに `headbar` クラス追加 + **【実装時修正】トグルボタンをReactコンポーネント(`ThemeToggleButton`・SSR描画)として自前レンダー** | theme.jsの自動注入をReact管理DOMに行うとハイドレーション不整合が発生(E2Eで55/175 fail実測)。theme.js既存契約「id=hqThemeTogleが既にあれば注入しない」を利用し、同idのボタンをSSRで先置き(`suppressHydrationWarning`でクライアント専用属性を許容)。**theme.js本体は無改変**=HQ側との二重管理同期は発生しない |
| `apps/web/src/app/globals.css` | `.hdtoggle`(トグルボタン)のスタイルを追加 | theme.js のコメント(theme.js:10-12)が明記: 「`.hdtoggle` は各ページが自前でスタイルすること、theme.js 自体はCSSを持ち出さない」契約。**HQダッシュボード側の `.hdtoggle` はこのアプリのCSSファイルに存在しない**ため、素のまま注入すると無装飾ボタンになる。既存の `--civ-*` トークン(`--civ-surface-2`/`--civ-border`/`--civ-text`)だけで数行のスタイルを足す(新規トークンは作らない・`tokens.generated.css` は生成物のため手を触れない) |

`tokens.generated.css` は変更不要(既にdata-theme上書きブロックが実在)。`config/design-tokens.json`(正本)も無変更。

### FOUC対策

theme.js 自体の契約(theme.js:16-18)は「`<head>` 内で同期`<script src>`として、可視コンテンツより前に読み込むこと」。Next.js App Router では `next/script` の `beforeInteractive` 戦略が「初期HTMLの`<head>`にインライン挿入し、ページの他コードより先に実行する」ことを保証する公式機能であり、この契約に合致する。**実装時の目視チェック項目**: localStorageに`hqTheme=light`を仕込んだ状態でhomeをハードリロードし、一瞬でもダーク背景がちらつかないことを確認する(next/scriptの配置ミスがあると初回ペイントが素のCSS既定値=ダーク寄りになるリスクがあるため、コードレビューだけで済ませず実機確認する)。

### HQ側theme.jsとの二重管理・同期の注意(HANDOFF §3再掲)

> `apps/web/public/assets/theme.js` は HQ `dashboard/assets/theme.js` の複製。**片側を更新したらもう片側へ同期すること**。

本ラウンドは theme.js **本体のロジックは1行も変更しない**(消費側=`AppShellNode`のクラスを足すだけ)。したがって今回はHQ側との同期作業は**発生しない**。ただし将来 theme.js 自体(ロジック・契約)を直す機会があれば、その時は必ず両ファイルを同時に更新すること — この注意を怠ったのがR54以前の既知リスクであり、本設計書はそのリスクを再確認するに留める。

## ④ 検証計画

### 機械ゲート(`npm run lint` / `npm test`)

- `npm run lint`: スキーマ検証(`validate-schemas.mjs`)・ScreenDef構造(`check-screendef-structure.mjs`)・遷移(`check-navigation.mjs`)・UI文言(`check-ui-copy.mjs`)・コントラスト(`check-contrast.mjs`)・i18nキー(`check-i18n-keys.mjs`)を含むチェーン全緑を確認する。
  - **`check-ui-copy.mjs` の限界**: 「未実装/WIP」等の禁止語しか検査しない(scripts/check-ui-copy.mjs:16-18)。**語彙辞書(structure-canon.md §3、カルマ→貢献度 等)は機械ゲート対象外** — ②の是正は目視/批評家チェックで担保する。
  - **`check-contrast.mjs` の限界**: `apps/web/src/app/tokens.generated.css` の `--civ-*` トークン値ペアしか読まない(scripts/check-contrast.mjs:13)。**手書きCSS(`globals.css`の新規`.hdtoggle`)はこのゲートの対象外** — R54のライトモード黒地黒文字バグ(`0ab8d07`)と同じ盲点なので、`.hdtoggle`は`--civ-*`変数のみで書き、両モードスクショで目視確認する(下記)。
- `npm test`(vitest): `tests/nav-reachability.test.ts` を含む。この検証は id/`action.kind==="navigate"`/`type==="link"`の`props.href` のみをBFS走査する(テーブルのセル内`href_tpl`は対象外)。今回追加する `inbox-table` のリンクはテーブルセル内なので、この既存慣習(`today`テーブルの`deep_link`セルも同様に対象外)通り走査されない — 新規の見落としではなく既存パターンとの整合。click-budget契約対象(button/linkの id/label/href)は本ラウンドで一切変更していないため、このテストは無回帰で通る想定。

### E2E(Playwright)

- `apps/web/e2e/observation.spec.ts`: 「観測を始める」ボタンのラベル文言をハードコード依存している(L42)。**start-observe の id/label は本設計で変更しない**ため無回帰。同specの `shot(page, "02-home")` スクリーンショットは新レイアウトに更新される(アサーション対象ではなく撮影のみ)。
- `apps/web/e2e/screen-sweep.spec.ts` / `c8-full-sweep.spec.ts`: home固有の内容アサーションはないため回帰リスクは低いが、全体スイート(ベースライン183本、HANDOFF §3)がグリーンのままであることを実行して確認する。

### 両モードスクショ・触れる入口(C9プロセス契約)

- 触れる入口: ローカル起動中の `https://ihl.tail4ae0a0.ts.net:3099/s/home`(または `/`)相当のURLで実機確認する(HANDOFF §2記載のデモ環境を再利用。新規デモ環境は立てない)。
- 撮影対象(ライト/ダーク × デスクトップ/モバイル、最低2幅): 
  1. home 最上部(新4タイル行+貢献度キャプション+次の一手+届いた出来事)
  2. ヘッダー右端の🌓トグル(**active/hover状態含む** — R54再発防止の核心。「全チップ/ボタンのactive状態を両モードでスクショ検査」をHANDOFF §3の注意通り実施)
  3. 届いた出来事テーブルが空の状態(`empty_text`が正しく出ること。テストデータで judicial_inbox が0件になる環境を使う)
  4. 届いた出来事テーブルに1件以上ある状態(「話し合いを見る」リンクの見た目)
- chip-status/chip-market/chip-costs(既存chip)は内容変更していないが、`headbar`クラス追加によるレイアウト干渉が無いことも同じスクショで併せて確認する。
- **home以外のapp-shell画面を最低1枚**(例: 個体一覧など)撮影する — `headbar`追加は全app-shell画面のヘッダーに効くため、home以外でのレイアウト崩れ・トグル重なりが無いことを点検する(批評家指摘の波及範囲チェック)。

## ⑤ 判定カード計画

> 直前ラウンド(c9-r2-entry-home-journey)の恒久フィードバック(30点・要是正)を必ず適用する: 開発用語ゼロ・○/×の帰結を各1行の平易文で・ファイル名/R番号等はlinksへ退避。

**カード本文(案)**:

- **タイトル**: 「ホーム画面を、開いてすぐ状況がわかる形に変えます」
- **何を判断してほしいか(1行)**: 「この新しいホーム画面を、今のホーム画面の代わりに使ってよいですか?」
- **○にすると**: 「開いてすぐ、今日やることと新しく届いた話し合いの件数が上のほうに並びます。ライト/ダークの切り替えボタンも画面上部に付きます。」
- **×にすると**: 「ホーム画面は今のままです(表示の言葉づかいや、切り替えボタンが無い点も含めて、変わりません)。」
- **この判断に含まないこと**: 「取引の件数バッジ・ログイン直後の初回案内画面・新しい機能の追加は、このカードの判断には含まれません(別ラウンドの話です)。」
- **証拠(evidence)**: 実機で触れるURL(触れる入口) + 改修前後を並べたスクリーンショット(ライト/ダーク各1枚以上)。デモGIFがあれば添える。
- **開発用語・ファイル名・R番号**: 本文には出さず、`links[]`(`design-home-round.md`・`screen-defs/home.json`・`structure-canon.md`)へ退避する。カード発行はHQ手順(R採番はHQ専任・status語彙は`draft/ready/answered`)に従う(HANDOFF §3・c9-r1-finder-pro.jsonのhq_feedback参照)。

## ⑥ リスクと正直な限界

- **語彙辞書は機械ゲートされていない**: `check-ui-copy.mjs` は「未実装」等の禁止語のみ検査し、structure-canon.md §3の語彙辞書(カルマ→貢献度 等)は検査しない。今回直したのはhome.json内で見つかった1件のみで、リポジトリ全体の語彙辞書違反の網羅検査はこのラウンドのスコープ外(dispute.json「紛争相談室」を範囲外として既に1件確認済み)。
- **手書きCSSはコントラストゲート対象外**: `.hdtoggle` を含む `globals.css` の新規CSSは `check-contrast.mjs` の走査対象(`tokens.generated.css`のみ)に入らない。`--civ-*`変数のみで書く運用ルールを守っても、それを機械的に強制する仕組みは無い(R54と同じ盲点)。両モードスクショの目視確認が唯一の砦。
- **タイルの色分けは実現しない**: センター勝ちパターン③(採点待ちタイルだけオレンジ)は、`renderer.tsx`の`KpiTileNode`に`trend`/`trend_tone`(隣接バッジ)しか無く、タイル自体の文字色を切り替えるpropが無いため完全再現はできない。代替として「超過」タイルを列の先頭(最も目に入る位置)に置くことで優先度を伝える設計にした。タイル自体の色分けが必要なら`KpiTileNode`への新規prop追加を別途判断すること。
- **既存の「各機能へ」6ボタンはセンター基準(4個まで)を超過**: `open-individual`〜`open-knowledge`の6ボタンは、home.json自身のnotesが定める click-budget契約(id/label/href固定)により本ラウンドでは触っていない。将来IA整理の宿題として存在を明記するに留める。
- **`inbox-table`のリンクはnav-reachability BFSの対象外**: テーブルセル内`href_tpl`は同テストの走査対象になっていない(`today`テーブルの既存`deep_link`セルと同じ扱い)。到達可能性の機械保証はこの経路には及ばない — 手動確認(④)で代替する。
- **judicial_inboxの`category`は本ラウンドでは出さない**: 3値の英語enumをそのまま出すと語彙辞書方針1(開発用語を画面に出さない)に抵触するが、3値変換のためだけにrenderer機構を増やすのはreuse-firstに反すると判断し、列自体を削った。締切と遷移リンクだけでも「10秒把握して次へ飛ぶ」目的は満たせる、という判断であり、情報量を減らしたこと自体は正直に記録する。
