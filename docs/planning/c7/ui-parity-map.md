---
id: c7-ui-parity-map
title: UI パリティ地図（ver3 全画面 現状 vs 本番密度）
date: "2026-07-12"
status: active
---

# UI パリティ地図 — ver3 全画面の本番密度到達度

> 全 38 screen-def を素材採点（0-100 = mockup / ver2 の本番密度に対する到達率）で並べ、A層（共有レンダラ）の欠落と作り直し順を出す。
> 目的: 「観測入力1画面が良くできた。他 37 画面も本当に同じ水準に届くのか」をユーザーが数字で判断できるようにする。誇張ゼロ・素材の backend_ready 実測に準拠。

## §0 結論

- **全 38 画面の平均 score = 37 / 100**（合計 1393 ÷ 38）。中央値も 30 付近。**現状の骨格は「配線は通っているが密度が本番の 1/3」**という状態。
- **本番密度に届いている画面 = 4**（score ≥ 70）: `login`(80)・`observation-input`(85)・`qr-resume`(70)・`knowledge-hub`(70)。うち `qr-resume`/`knowledge-hub` は元々目標密度が低い画面なので、**「厚い画面を本当に厚く作れた」実証は observation-input(85) と login(80) の 2 枚のみ**。
- **薄い画面（score ≤ 30）= 20 / 38**。過半数が「見出し + 1行テキスト list」に潰れている。特に 15 点クラスが 6 枚（obs-confirm・template-market・cross・market-trade・knowledge-paper・ui-templates）。
- **backend 到達性の内訳: UIのみで本番密度に到達可 = 18 画面 / API・スキーマ・投影の追加が要る = 20 画面。**
  - 重要なのは **薄い画面の多くが「UIのみ」側**にあること。observation-input と同じ「既存 API に厚い UI を結線する」作業で、market-trade・template-market・knowledge-thread・obs-confirm・obs-navigator・species などが一気に上がる。**これが「他も良くできる」根拠の中心。**
  - 一方 20 画面は投影追加が要る。ただし多くは「集計は既に在るがバインド形が合わない / 一部フィールドだけ未投影」の**部分的**不足で、フルの新規スキーマ設計が要るのは `settings`(取引前PII・不変条項③と要人間裁定)・`country-select`(pref-set schema拡張)・`data-descriptor`(autoFill未実装)程度。

**要約: observation-input の 85 点は再現可能。半数は同じ UI 結線作業で 30→70 台に上げられる。残り半数は「集計は在るが投影の shape 合わせ / 一部フィールド追加」で、真の新規 API 設計が要るのは 3 画面前後。最大の投資対効果は §2 の共有レンダラ語彙（テーブル/カード/バッジ/タイル/プログレス）を一度実装すること。**

---

## §1 画面別パリティ表（score 昇順 = 薄い順）

| score | screen_id | 現状 | 目標(本番密度) | 主な欠落 | backend | 出典 |
|---|---|---|---|---|---|---|
| 15 | obs-confirm | summary card 1枚（種候補text＋登録button）実質1card | 6チャンク確認（計測recap/写真/環境/命名+改名履歴/次回/テンプレ保存） | recap 部品全欠・編集戻り・テンプレ保存 | **UIのみ**（commit/templates/naming-history 在り、欠は screen-def の chunk 未定義） | ver2 confirm/page.tsx(420行) |
| 15 | template-market | text ランキング list のみ（bind二重ネスト疑い） | fork 3ステップ ウィザード（一覧→複製→計測項目編集table） | ウィザード全体・項目編集table・tabs/chips/検索・カード | **一部**: list/publish/fork API在り→UIのみ。計測項目編集の構造化 body は投影追加要 | mockup ihl-05-template-fork |
| 15 | cross | card3枚（率を数値text）のみ | 親カード/交配サマリ/世代table/極値タイル/率バー/子grid/チャート | 親・交配メタ・子個体・死亡詳細table・チャート | **一部**: cohort/weight_by_instar/extremes/rates は投影済→表/タイル/バーはUIのみ。親/子/死亡個別/帯チャートは投影追加要 | mockup ihl-03/metrics/mortality |
| 15 | market-trade | フラット縦スタック（stepper=muted text 1行/board=1行text） | 大判写真/仕様table/出品者trust/4段stepper/期限バナー/チャット/GMO振込table/browseタブ | 写真・trust・視覚stepper・チャット吹き出し・GMO table | **大半UIのみ**: listings/state/board/pricing/rating/gmo 在り。チャット吹き出しとGMO詳細面は一部配線/投影追加要 | mockup ihl-06/ihl-23 |
| 15 | knowledge-paper | title＋タイトル羅列 list＋button の4ノード | 8タブ/進行中論文カード/条件チップ/5段ステッパー/ギャップprogress | 詳細パネル全体・タブ・ステッパー | **一部**: 詳細投影は既存 route で呼べる（新規APIほぼ不要）。screen-def が list止まり | mockup ihl-09 |
| 15 | ui-templates | 保存フォーム1枚のみ | ビルダー3ペイン（パレット/キャンバス/プロパティ）＋テンプレ一覧/投票 | 3ペインUI全体・パレット・編集導線・一覧/投票 | **一部**: 保存(POST /builder/canvas)在り。ihl.ui.template.v1 の GET一覧/投票は route未採番→API追加要。ビルダー本体はUI実装（最大工数） | mockup ihl-16 ×2 / ver2 |
| 18 | obs-navigator | 3経路見出し＋薄い部品（二分探索は文だけのスタブ） | 8フィルタ パネル＋4列 result grid＋件数＋類似検索 | フィルタ一式・grid・二分探索対話・候補結果ノード | **UIのみ**: targets/catalog・targets/search・observation/search・画像endpoint 実装済 | mockup ihl-05-search-grid |
| 20 | terms | heading＋1段落＋navigate button の3ノード | 版ラベル+草案Badge/複数セクションcard/同意checkbox gate | セクションcard・版・同意gate・規約fetch | **API追加要**: /terms 相当なし。ハードコード文面のみならUI可、版/セクションはAPI要 | ver2 terms/page.tsx |
| 20 | obs-detail | 単一カラム flat（ドメイン/種/計測list/写真の4種） | 2カラム高密度＋類似個体サイドバー（この画面の主目的） | 類似SimilarHitカード全欠・引用CTA・撮影条件・計測table・パンくず | **一部**: 詳細本体は GET /observation/:id で可。類似は score しか返さず各hitのメタは hydrate ループ or API拡張要 | mockup ihl-05-obs-detail-similar |
| 20 | knowledge-thread | flat list（post_id:body / consensus数値）＋2欄form | サイドバー/投稿カード(アバター@著者+引用/指摘)/compose/二部屋論争 | アバター・著者/時刻・アクション・consensusバー・dispute画面 | **UIのみ(大半)**: projectThread/consensus/stance/dispute/投票 全投影在り。欠はアバター表出とアクションUI・dispute専用screen-def | mockup ihl-07/ihl-11 |
| 24 | profile | 4枚の単一行カード縦積み | アバター+3大カード横並び（karmaバー/貢献内訳table/評価3カラム+tag pill） | アバター・karmaバー・内訳table・3カラム・tag pill | **一部**: 中核3指標は投影済→UI化可。アバター/country/language・源泉別内訳・評価タグは投影追加要 | mockup ihl-profile-three-metrics |
| 25 | platinum-shop | price card（免罪符 N PT）＋button の7ノード | 残高/大カード/価格ラダー箱/購入履歴table/注記 | 残高・アート・ラダー・履歴table | **一部**: price/購入は在り→カード/ボタンUIのみ。履歴tableは listPtEvents 公開endpoint追加要 | mockup ihl-22 / ver2 |
| 25 | economy-status | h1＋見出し3＋1行bind card/list（全て単一行に潰れ） | ヒーロー円リング/内訳3タイル/加算タイムラインtable | 円リング・progressバー・内訳3タイル・加算table | **UIのみ(投影完備)**: status/contribution/ledger 在り。mockup内訳ラベル(いいね/コピー/上流)は源泉別で一部投影追加 | mockup ihl-14 |
| 25 | settings | 現在値card＋pref-form のみ | 左サイドナビ4タブ＋取引前PII フォーム（氏名/電話/住所） | サイドナビ・PIIフォーム全体・開示スコープ表示 | **一部+要人間裁定**: 選好は完備。取引前PII保存はスキーマ/route新設要、かつ不変条項③(住所不保持)と整合の人間裁定要 | mockup ihl-12-settings-pii |
| 25 | theme-gallery | flat list（`{{name}}（{{mode}}）` 1行） | pack毎card/grid＋色スウォッチ/mode badge/active/系譜/投票/適用 | card化・色見本・badge・系譜・投票・その場適用 | **ほぼUIのみ**: theme-packs一覧/詳細/投票/fork在り。色スウォッチのみ check-ui-tokens が raw hex拒否→lib/theme.ts側 client処理 | ver2 ui-template |
| 28 | research-newspaper | 号title＋digest list＋button の8ノード | 新聞レイアウト（記事本文/セクション/難易度階層/号アーカイブ/再生成トリガ） | 記事本文・アーカイブ・再生成配線・難易度グルーピング | **一部**: newspaper取得/手動トリガ在り→再生成配線+描画でUI可。号の中身の厚みは generateNewspaper 生成側拡張要 | ver3新規(PPR-17) |
| 30 | device | list=display_name の1行＋登録form | 行=アイコン+名+ステータスbadge+ドライバ+最終同期+解除、空状態 | badge・ドライバ・最終同期・アイコン・行アクション・空状態 | **一部**: GET /devices は name/provider/placement 返す→UIのみ。status/last_reading は GET投影に無く→API追加要 | mockup ihl-13 / ver2 |
| 30 | species | flat name list＋2欄追加form | 統計カード(平均体長/体重/市場平均価格)/morph一覧/alias承認/fork系譜/詳細 | 統計・morph・alias承認・系譜・詳細・409feedback | **UIのみ(API潤沢)**: species CRUD/stats/alias/morphs 全在り。UIで束ねるだけ | ver3新規(taxon-routes) |
| 30 | match | pair card（左右を item_id text）＋button×3 | 実画像2枚＋撮影条件キャプション＋収束度インジケータ＋詳しく導線 | 実画像・撮影条件・収束度・詳細導線・出所ラベル | **ほぼUIのみ**: ranking/preference 在り、画像はthumbnail。収束度(convergence)のみ投影追加要 | mockup ihl-10 |
| 30 | knowledge-board | 板=3プレーンlink＋threads=1行flat list | タブ行＋2x2リッチカードgrid（アイコン+スレッド数+開く→） | 板セレクタのカード/タブ・アイコン・スレッド数badge・スレッドカード | **UIのみ**: threads(topic/board_kind/post_count)・posts 在り。カード化はRenderer/JSON側のみ | mockup ihl-07 |
| 30 | paper-detail | paper card 内 flat list（6節/計測/引用）＋3button | 条件チップ/充足度progress/5段ステッパー/value_origin badge | 条件チップ・progress・ステッパー・確信度badge | **一部(shape ずれ)**: 再解析/bundle/citations のロジックは在り。GET /:id が paper ラッパ/section_list/citations join を返さず→集約投影(または /bundle+citations 合成)要 | mockup ihl-09(PPR-01) |
| 30 | knowledge-github | 3ノード(title/lead/外部link)のみ | (設計は意図的link-out) 参考ver2: issue/改善履歴 in-app行リスト | in-app issue/フォーク追跡・スレッド行・PR要約 | **設計通りなら実質完成(API不要)**。ver2相当のin-app化には GitHub API連携投影が要（route無し）。目標密度自体が低い | ver2 component-board / design-c5 §K6 |
| 35 | home | 18ノード（ledger=muted text 2行/summary=1行/nav button群） | 4枚KPIタイルgrid＋heroデュアルCTA＋アイコン付き今日の要約 | KPIタイル化・トレンド・heroCTA・要約card | **一部**: ledger/summary 在り→karma/観測セッションはタイル化可。「進行中の取引」「未読の指摘」の2タイルは market/annotation 集計投影追加要 | mockup ihl-01 / ver2 page.tsx |
| 35 | project-hub | project card（best/timeline/versions/lots を薄list） | プロフィール/Ver分岐ツリー/lot QR一覧/contents/citations集約 | contents/citations未描画・ツリー・lot別QR・timeline実イベント | **API/投影追加要**: projectHub は {project,contents,citations,versions} 返すが screen-def は best_version/timeline/lots にバインド(別endpoint or 未投影)→統合か projectHub マージ要 | ver3新規(PPR-16) |
| 35 | country-select | select 5国ハードコード＋button の3ノード | 網羅的国リスト＋検索＋永続化(+国旗) | 網羅リスト・検索・永続化先・国旗 | **API追加要**: pref-set schema に country 無し(additionalProperties:false で拒否)・PREF_FIELDS に無し・国マスタ無し→schema/投影新設要 | ver3新規(mockup無し) |
| 40 | research-search | form(query/type/tags)＋結果=1行flat list | 結果行(スニペット/タグ/スコア/日時/投稿者)＋ファセット＋ページング | 結果行の厚み・種別badge・ファセット・ページング・状態分離 | **一部**: POST /research/search(unifiedSearch 4本柱)在り→form/フィルタはUIのみ。行のスニペット/スコア等 無い項目は投影拡張要 | ver3新規(WIK-13/14) |
| 42 | data-descriptor | descriptor-form 9フィールド＋claims preview（5画面中最進捗） | 完成度progress/✓充足/条件を温度湿度餌に分割chip/自動差し込み/分岐保存 | progressバー・✓・条件chip分割・autoFill・claim色分け | **API追加要**: 保存は在り。応答が {content_id,key} のみで preview の claims 未返却。autoFillDescriptor はサーバ実装なし(コメント言及のみ)→API追加要 | mockup ihl-09-template-fill |
| 55 | obs-domain-select | domains 5button のみ | 各ドメインのアイコン/短説明/直近件数/カード化 | アイコン・説明・件数・カード化 | **UIのみ**(純ナビ、API不要。件数出すなら catalog で補完可) | ver3新規(mockup無し) |
| 55 | bio-card | 種/最新サイズ text2＋qr＋button の6ノード | 名刺型レイアウト＋特徴タグ＋morph＋部数選択 | 特徴タグ・morph・名刺レイアウト・部数選択UI | **一部**: species/latest_size/qr は投影済→UI可。morph=null/feature_tags=[] は stub→API追加要 | ver3新規(IND-15) |
| 55 | paper-match | form＋result(match_rate見出し+3 list)＋button | 条件キー判定table(期待×観測×verdict)＋一致率ゲージ＋descriptorプレビュー | 判定table・ゲージ・descriptorプレビュー・ブリッジ状態 | **UIのみ(完備)**: matchConditions/autoFillDescriptor 返却済。UI描画拡張のみ | ver3新規(PPR-01/30) |
| 55 | ai-profile-settings | 単一保存フォーム（select2+text+textarea） | 5機能の現在値一覧＋機能選択で既定プリフィル＋鍵保存状態 | 設定済み一覧・既定プリフィル・provider/model・鍵状態 | **UIのみ**: 正本 ai-profiles/*.json + schema 実在。JSON読むだけで到達可、API不要 | ver3新規(mockup薄) |
| 58 | obs-entry | domain select＋計測1行の入力form（8フィールド） | 対象確定チップ→ドメイン→テンプレ適用→複数計測行→写真→確認 | 複数計測行・テンプレ適用・確定チップ・phase・単位/方法 | **UIのみ**: captures/upload/measurements 実装済。obs-confirm へ遷移。API不要 | ver3新規(mockup無し) |
| 58 | individual-detail | 6文化ブロック+timeline を平坦 1行 list | timeline視覚化/観測計測table/市場/改善 実データ/属性明示 | timeline視覚化・計測table・市場/改善実データ・属性・親ピッカー | **一部**: timeline/observations/schedules/templates/data_sources 返す→UI可。market_offers/improvements は空stub→結合API追加要 | ver3拡張(IND-13) |
| 65 | language-select | heading＋select(ja/en)＋button の3ノード | Card枠＋補助説明＋（保存アクション） | Card枠・説明文・永続化アクション | **UIのみ**: locales/pref-set 在り。目標が軽量ピッカー、API不要 | ver2 language |
| 70 | qr-resume | resolve card(text3)＋button の7ノード | 読取確認+観測遷移＋手入力フォールバック | 手入力フォールバック・副次アクション・視覚フィードバック | **UIのみ**: GET /qr/{token}?prefill=1 投影済。追加API不要 | ver2 scan / individuals qr |
| 70 | knowledge-hub | 3柱カード（heading+desc+navigate） | (設計は意図的ミニマル BBS-01)＋各柱アイコン/スレッド数/開く→ | アイコン・スレッド数badge・開く→アフォーダンス | **UIのみ**(ナビ集約、API不要。件数出すなら集計投影配線) | ver3新規PROTECTED(design-c5 §K6) |
| 80 | login | email field＋規約checkbox＋submit＋dev-login の7ノード | BrandLogo＋補助コピー＋新規登録link＋状態バナー | BrandLogo・補助コピー・register link・状態バナー | **UIのみ**: magic-link/verify/dev-login/session 実装済。視覚要素のみ | mockup ihl-00 / ver2 |
| 85 | observation-input | 全10セクション高密度card（table/segmented 実装済） | mockup要素を内包しver2の10セクション再現済 | 機器/親のoptions実データ・カメラ実起動・テンプレ動的取得 | **UIのみ**: templates/dictionary/captures/individuals 全在り。空optionsは既存API結線で埋まる、残りはフロント配線 | mockup ihl-05 / ver2(1836行) |

---

## §2 共有レンダラ語彙の不足（A層 = 一度直せば全画面に効く）

薄い画面の 8 割は「本番なら table / card / badge のはずが、Renderer にその語彙が無いので 1行テキスト list に潰れている」ことが原因。**個別画面を直す前に、以下の共有部品を Renderer に足すのが最短。** 頻度は §1 の欠落を横断集計したもの。

| 順 | 不足部品 | 出現画面数 | 代表画面 | 効果 |
|---|---|---|---|---|
| 1 | **複数行×複数列データテーブル**（列ヘッダ+行+セル種別: badge/バー） | ~11 | cross(世代/死亡)・obs-detail(計測method/origin)・platinum-shop(履歴)・economy-status(加算)・profile(内訳)・paper-match(判定)・template-market(項目編集)・obs-confirm(recap)・paper-detail・individual-detail・device | 最大。表化するだけで「潰れ」の主因が消える |
| 2 | **リッチカード コンテナ**（アイコン+タイトル+メタ+badge、vs プレーン list item） | ~10 | home・device・species・match・knowledge-board・knowledge-hub・template-market・theme-gallery・obs-domain-select・research-search | 「list を card に」で体感密度が段違い |
| 3 | **ステータス badge / チップ**（接続中/未接続・草案・phase・確信度・良好 pill） | ~10 | device・market-trade・knowledge-board・theme-gallery・terms・knowledge-paper・data-descriptor・paper-detail・profile・species | 状態の可視化。単独では小さいが遍在 |
| 4 | **プログレスバー / ゲージ** | ~7 | cross(率)・economy-status(次コイン)・data-descriptor(完成度)・paper-detail(充足度)・paper-match(一致率)・profile(karma)・knowledge-paper(ギャップ) | 「N%」の数値を視覚化。実装小・効果大 |
| 5 | **タブ / セクション切替行** | ~7 | template-market・knowledge-board・knowledge-thread・knowledge-paper(8)・market-trade・settings・research-search | 1画面に複数ビューを畳む本番の常套。無いと縦に伸びて潰れる |
| 6 | **画像グリッド / サムネカード**（スコアバー・メタ付き） | ~5 | obs-navigator・market-trade(browse)・obs-detail(類似)・match・template-market | 検索/市場の中核。thumbnail.ts は在るので配線 |
| 7 | **ステッパー**（多段進捗・現在ハイライト） | ~5 | market-trade(4段)・knowledge-paper(5段)・paper-detail・data-descriptor・template-market(fork 3段) | 取引/研究フローの状態表示 |
| 8 | **KPI / 統計タイル**（大数字+ラベル+トレンド） | ~5 | home(4枚)・cross(極値)・economy-status(内訳3)・profile・platinum-shop(残高) | ホーム/貢献度の顔 |
| 9 | **フィルタパネル**（select/range/segmented の縦積み） | ~3 | obs-navigator(8)・market-trade・research-search | 検索面の左カラム |
| 10 | アバター / チャット吹き出し / チャート(折れ線・棒) / range スライダ | 各 1-3 | knowledge-thread・market-trade(chat)・cross(chart)・obs-navigator(slider) | 局所的。個別画面フェーズで対応 |

> segmented control と measurement-table は observation-input で既に語彙化済（素材に明記）。**A層の実質は「上位 1-8」で、うち 1(テーブル)・2(カード)・3(badge)・4(progress) の 4 つを足すだけで、薄い 20 画面のほぼ全ての「潰れ」が解消する。** これが observation-input の 85 点を他画面に横展開できる技術的根拠。

---

## §3 作り直しの推奨順（重要 × 薄さ × backend_ready）

原則: **(a) 中核ユーザー動線 > (b) 薄い > (c) backend が UIのみ（= observation-input と同じ「厚い UI を既存 API に結線」で速い）** を優先。API 新設が要る画面は後段の「API 波」へ回す。

**第0段: A層（§2 の 1-8 部品）を Renderer に実装。** これ無しで個別を触ると同じ潰れを繰り返す。最初にやる。

**第1段 — UIのみ・中核・薄い（observation-input と同型の速い勝ち筋）**
1. `obs-confirm`(15, UIのみ) — 観測フローの完結点。chunk 部品を screen-def に定義するだけ。
2. `obs-navigator`(18, UIのみ) — 検索の中核。フィルタ+grid、既存 targets/search・observation/search に結線。
3. `template-market`(15, list/fork はUIのみ) — fork ウィザード。編集 body の構造化のみ API 波へ分離。
4. `market-trade`(15, 大半UIのみ) — 事業中核。写真/仕様/trust/stepper を結線。チャット吹き出しと GMO 詳細面のみ API 波へ。
5. `knowledge-thread`(20, 大半UIのみ) — コミュニティ中核。投影は全在り、アバター/アクション/dispute screen-def を追加。
6. `species`(30, API潤沢) — 統計/morph/alias は投影済、束ねるだけ。
7. `knowledge-board`(30, UIのみ) — カード/タブ化のみ。
8. `economy-status`(25, 投影完備) — タイル/リング/progress。内訳ラベルのみ一部投影。

**第2段 — UIのみ・重要度中 / 部分API**
9. `home`(35) — KPIタイルは A層で大半。2タイル(取引/指摘)のみ集計投影追加。
10. `theme-gallery`(25) — カード/系譜/投票は在り。色スウォッチのみ client 処理。
11. `paper-match`(55)・`bio-card`(55)・`individual-detail`(58) — 描画拡張中心、一部 stub の実データ化。

**第3段 — API 波（投影/スキーマ追加が主因。UI と並行 or 後追い）**
12. `obs-detail`(20) — 類似サイドバー(主目的)は各 hit の hydrate ループ or API拡張。
13. `cross`(15) — 集計は在り、親/子/死亡個別/帯チャートは投影追加。
14. `device`(30) — status/last_reading 投影追加。
15. `platinum-shop`(25) — 購入履歴 endpoint 追加。
16. `paper-detail`(30)・`project-hub`(35)・`research-search`(40)・`research-newspaper`(28) — shape 合わせ / 生成拡張。
17. `data-descriptor`(42) — autoFillDescriptor 未実装、サーバ側新規。
18. `profile`(24) — アバター/内訳/評価タグの投影追加。

**第4段 — 要人間裁定 / 設計判断**
19. `settings`(25, 取引前PII) — 不変条項③(住所不保持)と衝突。スキーマ新設は人間裁定待ち。
20. `country-select`(35) — pref-set schema 拡張 + 国マスタ。
21. `ui-templates`(15) — ビルダー本体は工数最大。公開は人間ゲート。
22. `knowledge-github`(30) — 設計上は link-out で完成扱い。in-app 化は方針判断。
23. `terms`(20) — /terms API 新設 or ハードコードで妥協するかの判断。

**低優先(既に到達 / 目標低)**: login(80)・observation-input(85)・qr-resume(70)・knowledge-hub(70)・language-select(65)・obs-domain-select(55)・obs-entry(58)・ai-profile-settings(55) は現状で許容範囲、微調整のみ。

---

### 正直な注記
- score は素材の採点をそのまま採用（独自再測はしていない）。中核性の重み付けは動線推定に基づく主観を含む。
- 「UIのみ / API追加要」は素材の backend_ready 記述に準拠。`market-trade`・`match`・`research-search`・`research-newspaper` は「大半UIのみだが一部投影追加」の**境界例**で、本地図では安全側に「API追加要」側(=20画面)へ算入した。純粋な UI 結線で 8-9 割到達できる点は上表に明記。
- 平均 37 は「配線済み・密度未達」の正直な現在地。observation-input(85) は到達可能性の実証であって、37→70 台への引き上げは §2 の A層投資が前提。
