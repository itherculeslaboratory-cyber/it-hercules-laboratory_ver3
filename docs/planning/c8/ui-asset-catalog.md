---
id: c8-ui-asset-catalog
title: UI資産適用カタログ（画面目的×既製資産）
date: "2026-07-17"
status: active
---

棚卸し表・OSS資産・ver2トリアージの3入力を、実レンダラ語彙(`apps/web/src/renderer/renderer.tsx` の NodeView dispatch)とトークン正本(`apps/web/src/app/tokens.generated.css`／enforcerは `scripts/check-ui-tokens.mjs`)に接地して統合した。以下が納品物。

---

## UI資産適用カタログ（ver3・47画面／15クラスタ）

### 導入方針3行（この順で必ず実行）
1. **丸ごと採用** — 目的に合う「完成した既製ブロック」を1つ選び、手組みしない。採用単位は *マークアップ構造＋インタラクション＋CSS* であって、React部品を無検証で route に落とすことではない(本アプリは ScreenDef JSON を描画する data-driven 方式のため／出典: `renderer.tsx` L36-46, L4846 NodeView)。
2. **トークン差し替え** — 採用ブロックの生 hex・px・font 値を全て `--civ-*` 意味トークンへ置換する。生 hex は `scripts/check-ui-tokens.mjs` が CI で禁止、コントラストは `scripts/check-contrast.mjs` が検査。使える色系トークンは `--civ-bg / -surface(-*) / -text / -text-muted / -border / -primary / -primary-text / -focus / -danger / -danger-bg`、寸法は `--civ-radius / -tap / -motion / -font / -fs-*`(出典: `tokens.generated.css` L10-29)。
3. **レンダラ語彙化** — 画面を既存ノード型の合成として ScreenDef に落とす(Path A)。既存語彙で表せない一発物リッチ部品のみ、専用ノード型を1つ追加して採用ブロックをその中に閉じ込める(Path B)。専用ノードの追加は最終手段(既に `individual-profile`/`search-navigator` 等7種が前例)。

> **接地事実(検証済・出典 `renderer.tsx` L4850-4978)**: 汎用ノード語彙は `app-shell / page / heading / text / button / form / field / list / card / image / qr-code / measurement-table / table / badge / progress / tabs / image-grid / stepper / kpi-tile / visit-tracker / recent-chips / disclosure / link`。専用(一発物)ノードは `clutch-intake / batch-roster / batch-summary / batch-done / search-navigator / growth-chart / individual-profile` の7種。`field` の variant は `text/number/date/select/segmented/photo/checkbox/hidden`(**textarea は未実装**)。`table` の cell は `text/badge/progress/date/observed/link`(**button/action セルは未実装**)。**ノードの scope 条件表示(`{{params.stage}}==X` で出し分け)は現状レンダラに無い** — これが P0 の唯一の共通不足(後述)。

### ライセンス上／スタック上 使えない資産の除外リスト
| 資産 | 除外理由 | 許容される用途 |
|---|---|---|
| Discourse (GPL-2.0) | コピーレフト強・Ruby/Ember | UI/IA 目視参照のみ |
| NodeBB (GPL-3.0) | コピーレフト強・非React | 目視参照のみ |
| eLabFTW (AGPL-3.0) | 改変物公開義務・PHP | IA発想源のみ、コード取込不可 |
| Cal.com (AGPL-3.0) | 非公開利用は商用ライセンス別途・コード取込不可 | 設定画面のUXパターン目視のみ |
| Grocy (ライセンス未確認・PHP monolith) | LICENSE未確認＋スタック不一致 | 採用判断保留、バーコード一括UIのIA参照のみ |
| arhamkhnz/next-shadcn-admin-dashboard (LICENSE未取得) | 商用可否未確認 | 確認まで採用不可 |
| shadcnblocks.com / shadcnstudio 等 商用ブロック集 | 独自EULA(再配布・マーケット組込禁止) | デザイン参考止まり |
| AG Grid **Enterprise** 機能(ピボット等) | 商用ライセンス別途 | Community(MIT)機能のみ採用可 |
| Flarum (MIT だが PHP/Mithril) | ライセンスは可・**スタック不一致で移植不能** | IA/投票UXの参照のみ |
| Medusa バックエンド一式 | ライセンス(MIT)は可だが**常駐DB=不変条項①違反リスク** | Storefront の *UIブロックのみ* 抜き出し、Medusaサーバは採用しない |

> 未確認事項(全候補共通): clone/`npx shadcn add`/レンダリングの実地検証は未実施(WebSearch 情報のみ)。Tremor全量OSS化・Preline Fair Use・Apache Answer の Tailwind非採用は各リンク先で最終確認が必要。

---

### アーキタイプ別 適用カタログ

#### A. マーケットプレイス(market-trade / template-market / theme-gallery)
| 画面 | 目的(1行) | 第1候補(URL・license) | 代替 | ver2部品(A評価) | カスタマイズ要点(civ token・node語彙) | 優先度 |
|---|---|---|---|---|---|---|
| **market-trade** | 出品〜支払/受取/評価/引継ぎを貫く統合取引 | Medusa Storefront の商品詳細+一覧ブロック `github.com/medusajs/nextjs-starter-medusa`(MIT・**UIブロックのみ**) | Tremor Blocks `blocks.tremor.so`(MIT・要license最終確認)＝ダッシュ側 / shadcn data-table `ui.shadcn.com/docs/components/data-table`(MIT)＝GMO振込/入札 table | MarketDetailBoardW2(stepper19+GMO振込table)、MarketEntityDetailShellW2(bid-history table+StatusChip)、MarketBrowseW2(4タブ+画像grid)、MarketBidEntryW2/PriorityApplyW2 | 下段【最優先1】で詳述。stepper/table/image-grid/kpi-tile/badge の既存語彙合成(Path A)＋stage出し分けの小改修1点 | **P0** |
| template-market | 観測/論文/重みの fork 一覧・複製・投票 | shadcn/ui Blocks `ui.shadcn.com/blocks`(MIT) fork gallery + ReUI Stepper(fork 3手順) | HyperUI cards `hyperui.dev`(MIT) | (該当薄) | `image-grid`(fork一覧カード)→複製`button`→`measurement-table`(計測項目編集)の3段。投票は`badge`+`button`。トークン: カード枠=`--civ-surface`/`--civ-border` | P2 |
| theme-gallery | 配色/トークンの fork 一覧・投票・適用 | HyperUI card grid(MIT) | Flowbite gallery(MIT無料枠) | (該当薄) | `image-grid` に色スウォッチ(item_image=生成SVG)＋`badge`(系譜)。API `theme-packs` 既存 | P2 |

#### B. フォーラム/スレッド(knowledge-thread / knowledge-board / knowledge-hub)
| 画面 | 目的 | 第1候補 | 代替 | ver2部品 | カスタマイズ要点 | 優先度 |
|---|---|---|---|---|---|---|
| **knowledge-thread** | 結論候補/争点ピン+Polis型合意可視化+返信 | Apache Answer の質問/回答/投票UI `github.com/apache/answer`(Apache-2.0・**参照移植**。Tailwind非採用未確認のためclone不可) | shadcn blocks(MIT) 投稿カード+avatar | **BoardThreadViewW2**(cite-preview composer・227行)、CiteMiniCardW2(引用badge atom)、BoardThreadListW2 | 下段【最優先2】で詳述。stance を `field variant:segmented`(Agree/Disagree/Pass=既存!)へ、consensus を `table`+progress cell へ | **P0** |
| knowledge-board | トピック軸ホーム+割れている論点ビュー | shadcn blocks カードグリッド(MIT) | HyperUI(MIT) | **BoardHubW2**(2x2カードgrid・#15)、OfficialBoardHubW2(重複バリアント=参考) | 板セレクタを `card`×4(2x2)＋スレ数`badge`、割れ論点は `list` bind_items。白画面クラッシュはT1修理済 | P1 |
| knowledge-hub | 3柱への入口ハブ | (現状で許容) shadcn hero + card 3枚 | — | HomeCommandPanelW2 の stat-grid 流用可 | 意図的ミニマル(BBS-01)。`heading`+`card`×3 のまま。改修不要 | P3 |

#### C. データテーブル/記録系(obs-register-entry・batch / device / species / measurement)
| 画面 | 目的 | 第1候補 | 代替 | ver2部品 | カスタマイズ要点 | 優先度 |
|---|---|---|---|---|---|---|
| obs-register-entry | 継承ヘッダ+差分だけ入力の追観測中核 | (実装済) shadcn form blocks(MIT)で磨き | — | ObsRegistrationW2(obs-confirmチャンク側) | 既存 `measurement-table`+`field(compare_source)` で前回Δ表示済。トークン整えのみ | P1(実装済) |
| obs-register-batch | お世話/移動/ペアリング/割り出し一括 | shadcn Data Table + **TanStack Table** `github.com/TanStack/table`(MIT・headless) | AG Grid Community(MIT・セル編集内蔵) / Glide Data Grid(MIT・大量行) | (専用 `batch-roster` 実装済) | 専用ノード内で TanStack のセル編集構造を採用しトークン化(Path B)。異常行=`--civ-danger-bg` | P2(実装済) |
| device | IoT機器の棚join・CSV連携 | shadcn Data Table(MIT) | AG Grid Community(MIT) | NumericFilterRow(フィルタ実装例) | `table`(display_name/鮮度badge列)＋「要対応」を最上部`card`集約。鮮度=`badge` tone | P2 |
| species | 種/形態の標準化・alias承認・産地統計 | shadcn Data Table(MIT) | Tremor 統計カード(MIT) | (該当薄) | `table`(morph一覧)＋`kpi-tile`(産地層別統計)＋alias承認=`list`+`button`。API(CRUD/stats/alias) 既存 | P2 |

#### D. 個体詳細/プロフィール+タイムライン(individual-detail / obs-detail / cross / paper-detail)
| 画面 | 目的 | 第1候補 | 代替 | ver2部品 | カスタマイズ要点 | 優先度 |
|---|---|---|---|---|---|---|
| individual-detail | 「次に動く」判断3指標+血縁レール | (実装済・専用`individual-profile`) shadcn-timeline `github.com/timDeHof/shadcn-timeline`(MIT)で変化点軸強化 | Tremor Chart(AreaChart/LineChart・MIT)＝成長曲線 / ReUI Timeline(MIT) | (専用ノード実装済) | 専用ノード内の成長チャートを Tremor LineChart 構造でトークン化。交配相手ピッカー/市場来歴帯の網羅は要個別確認 | P1(実装済) |
| cross | 交配/系統の失敗率を集合単位で判断 | Tremor Blocks 統計ダッシュ(MIT) | shadcn charts(MIT) | (該当薄) | `kpi-tile`×3(死亡/完品/羽化不全率)＋two-layer(クラッチcount層→individual層)を`table`+`progress`。集計API有・UI未結線 | P2 |
| paper-detail | 実験計画の充足度・仮説検証状況 | ReUI Stepper(MIT・5段) + Tremor progress | shadcn blocks | **PaperProgressW2**(`w2-paper-phase__track`=stepper済)、PaperTemplateFillW2 | `stepper`(5段)＋条件`badge` chip＋充足度`progress`。API shape不一致の解消要 | P2 |

#### E. ウィザード/多段フォーム(obs-register-new/confirm/done/clutch, data-descriptor, paper-match/data-descriptor, 論文フロー)
| 画面 | 目的 | 第1候補 | 代替 | ver2部品 | カスタマイズ要点 | 優先度 |
|---|---|---|---|---|---|---|
| data-descriptor | 観測方法テンプレ6節記入 | **ReUI Stepper** `reui.io/components/stepper`(MIT) | Next Stepper `allshadcn.com/components/next-stepper`(MIT) | **PaperTemplateFillW2**(progress/✓/chip土台・390行) | `stepper`+`form`(6節)+`progress`バー。autoFillDescriptor はサーバ未実装(要API) | P2 |
| paper-match | 実験計画×観測の決定論突合 | shadcn form + Tremor | — | PaperTemplateFillW2 | API完備(matchConditions)。`form`+`list`(候補)描画拡張のみで到達 | P2 |
| obs-register-new | 新規個体登録(F1-N) | shadcn form blocks(MIT) | — | ObsRegistrationW2 | `field(photo)`+種候補`field(select)`+クラッチ化`field(segmented)`。現状2項目を厚く | P1 |
| obs-register-clutch/confirm/done 系 | 割り出し一括/確認/完了 | (専用ノード実装済) | — | — | 既存専用ノードのトークン整えのみ | P2(実装済) |

#### F. 設定(settings / ai-profile-settings / platinum-shop)
| 画面 | 目的 | 第1候補 | 代替 | ver2部品 | カスタマイズ要点 | 優先度 |
|---|---|---|---|---|---|---|
| settings | AI接続/PII/通知/バックアップ自己管理 | Preline Application UI(settings) `preline.co/blocks`(MIT+Fair Use・自社組込は実質MIT) | Flowbite Account settings(MIT無料枠) | (該当薄) | 左サイドナビ4タブ=`tabs`。**取引前PII保存は不変条項③と衝突＝人間裁定待ち**、ここは実装ブロック | P3(裁定待ち) |
| ai-profile-settings | 機能別 BYOK 接続 | Preline settings form(MIT) | Flowbite(MIT) | — | `form`+`card`。正本 `ai-profiles/*.json`+schema実在、API不要で到達。複数端末鍵同期は改稿新設計=未 | P2 |
| platinum-shop | 免罪符購入(カルマ消費) | Flowbite pricing/shop block(MIT無料枠) | HyperUI(MIT) | KarmaSummaryW2(karma-bar+履歴table) | 残高`kpi-tile`+ラダー`table`+購入履歴`table`。economy統合の一部として実装 | P2 |

#### G. ダッシュボード/ホーム(home / economy-status / profile / project-hub / research-newspaper / knowledge-paper)
| 画面 | 目的 | 第1候補 | 代替 | ver2部品 | カスタマイズ要点 | 優先度 |
|---|---|---|---|---|---|---|
| home | 認証後司令塔・triage+次の一手 | **Kiranism/next-shadcn-dashboard-starter** `github.com/Kiranism/next-shadcn-dashboard-starter`(MIT・スタック完全一致=最有力) | shadcn dashboard-01 `ui.shadcn.com/view/new-york-v4/dashboard-01`(MIT) / Tremor Blocks(MIT) | **HomeCommandPanelW2**(`ihl-stat-grid/card`=KPIタイル済・#11) | triage を `kpi-tile`×4(計測due/長期不在/取引/未読)＋「次の一手」`card`。現状18ボタン羅列を置換 | P1 |
| economy-status | カルマ・貢献3軸・プラチナ現在地 | Tremor Blocks(円リング/KPI・MIT) | shadcn charts(MIT) | **KarmaSummaryW2** | 3画面統合の主。`kpi-tile`(karma)+貢献3軸`progress`×3+加算`table`。profile/platinum と横並び1画面3セクション | P1 |
| profile | 自分の公開ページ | Flowbite Profile/Account overview(MIT無料枠) | Preline(MIT) | ProfileW2(薄ラッパー=**C評価**・実体は `packages/ihl-ui-catalog/src/components/features/profile/`) | avatar+内訳`table`+評価`badge`。economy統合セクションとして | P1 |
| project-hub | 研究版/ロット/引用集約 | Kiranism starter のダッシュ構成(MIT) | Tremor(MIT) | — | 版分岐`stepper`+引用`list`+lot別`qr-code`。投影統合要 | P2 |
| research-newspaper | 日次蒸留の新聞体裁 | shadcn blog/article block(MIT) | HyperUI(MIT) | — | 記事`card`+セクション`list`+難易度`badge`+号アーカイブ`table` | P3 |
| knowledge-paper | 論文クラスタ入口(v1差し戻し改稿) | Tremor + shadcn tabs(MIT) | — | PaperProgressW2(stepper) | 8タブ=`tabs`+進行中論文`image-grid`+条件chip`badge`+ギャップ`progress` | P2 |

#### H. 検索(obs-search / research-search)
| 画面 | 目的 | 第1候補 | 代替 | ver2部品 | カスタマイズ要点 | 優先度 |
|---|---|---|---|---|---|---|
| obs-search | 頭の像→在庫個体集合へ最短着地(3段梯子) | (実装済・専用`search-navigator`) shadcn Command palette(MIT)+Data Table | AG Grid Community(MIT) | **ObsSearchW2**(フィルタ+grid・866行)、**NumericFilterRow**(gap#9唯一の実装例) | 専用ノード内。F3類似度/ステージ別グルーピング/軽量グリッド/cold-startプリセットは対象外=拡張要 | P1(実装済) |
| research-search | 論文/wiki横断4本柱 | shadcn search block(MIT) | Tremor(MIT) | — | `form`+結果`list`(スニペット/タグ/スコア)＋ファセット`badge`。POST /research/search 有・行未描画 | P2 |

#### I. 好み学習/スワイプ(match)
| 画面 | 目的 | 第1候補 | 代替 | ver2部品 | カスタマイズ要点 | 優先度 |
|---|---|---|---|---|---|---|
| match | 言語化できない好みを YES/NO で教え rerank | (OSS弱) shadcn card + 手組み swipe | HyperUI card(MIT) | **PreferenceLearningW2**(`w2-mch-converged`=収束度UI済・parity欠落そのもの) | 専用 or `card`+`image`(写真必須=現状欠)+`button`×3。ver2の収束度インジケータを移植。cold-start閾値ゲート要 | P1 |

#### J. QR/物理ラベル(bio-card / QRラベル一括印刷[新規])
| 画面 | 目的 | 第1候補 | 代替 | ver2部品 | カスタマイズ要点 | 優先度 |
|---|---|---|---|---|---|---|
| bio-card | 即売会で1匹1枚渡す名刺型QR | (実装済) `qr-code`ノード+印刷CSS | — | — | 単票実装済。トークン整えのみ | P3(実装済) |
| **QRラベル一括印刷**[新規screen-def] | クラッチ単位A4シート・途中再開・部分再印刷 | ネイティブ `@media print` + CSS grid(ライブラリ不要) | — | — | 新規採番候補。`image-grid`(QRセル)+`@media print`でA4=不変条項準拠(常駐なし)。series命名/連番 | P3 |

#### K. 認証・オンボーディング(login / country / language / terms) + 新規ギャップ
| 画面 | 目的 | 第1候補 | 代替 | ver2部品 | カスタマイズ要点 | 優先度 |
|---|---|---|---|---|---|---|
| login | マジックリンク+dev-login | shadcn auth block(MIT) | Preline auth(MIT) | — | 実装済(score80)。改稿要求のhandle第2ゲート/数字コード入力欄常設は未反映=要追加 | P3 |
| terms | 規約同意(版差分再同意ゲート) | shadcn legal block(MIT) | — | — | `text`(版ラベル)+セクション`card`+`field(checkbox required)`(既存consent gate=`FormValidityCtx`活用)。/terms相当API無し | P3 |
| language/country-select | 表示言語/国選択 | shadcn combobox(MIT) | — | — | `field(select)`。country は pref-set schema拡張要 | P3 |
| **dispute**[新規] | 二人部屋紛争解決(市場/広場共用) | shadcn blocks(MIT) | Apache Answer 参照 | MarketDetailBoardW2 の board | 新規screen-def。API(`gov-routes.ts` dispute)既存・画面欠。`stepper`+`list`(主張)+`form` | P1(market/thread両P0の分岐先) |
| **handle確定**[新規] | @id 不可避第2ゲート(晒し事故防止) | shadcn form(MIT) | — | — | login.json統合か専用か不明瞭=分化要。`field`+即時重複チェック | P2 |
| ui-templates(builder) | 画面レイアウトの fork/ビルダー | (OSS弱・工数最大) | — | — | 3ペイン(パレット/キャンバス/プロパティ)。**公開は人間ゲート**。P最後 | P3(人間ゲート) |

---

### 【最優先1】market-trade 組み立て手順(どの資産のどのブロック→どのノード型)

**現状**(出典 `screen-defs/market-trade.json`): `app-shell>page>` に `heading`+`text`(stepperと称すが実体はミュート文1行)+ `card`×4(detail/state/price/shipping の bind_text)+ `list`(board)+ `button`。写真・仕様table・trust・4段stepper・チャット・GMO振込table は全欠。

**目標**: stage クエリ駆動(公開stage1→成立後 非公開board stage2)。第4稿ワイヤー F1出品/F2購買/F2b詳細/F3ダッシュ/F3b発送/F4検品。

**ブロック→ノード割り当て**:

| ワイヤー要素 | 供給元ブロック | 割り当てノード型 | トークン化/実装メモ |
|---|---|---|---|
| 4段 stepper(出品→申込→成立→発送受取評価) | **ver2 MarketDetailBoardW2** の `stepper`(className stepper19箇所) ／ 代替 ReUI Stepper(MIT) | `stepper`(既存) `props.current`={{params.stage}} | 現行の飾りテキストを本物の `stepper` ノードへ置換。step枠=`--civ-border`、current=`--civ-primary`。`civ-stepper` CSS は実装済(`renderer.tsx` L1231) |
| 個体写真ギャラリー | **Medusa Storefront** 商品詳細gallery(MIT・UIのみ) ／ ver2 MarketBrowseW2 の画像grid | `image-grid`(既存) `bind_items`=写真配列 | サムネ枠 radius=`--civ-radius`。`civ-image-grid`/`civ-thumb-card` 実装済(L1179) |
| 仕様 table(種/サイズ/産地/血統) | **shadcn Data Table**(MIT) ／ ver2 MarketEntityDetailShellW2 | `table`(既存) columns=[label/value] | セル text。ヘッダ罫線=`--civ-border` |
| trust/出品者バッジ | ver2 MarketEntityDetailShellW2 の **StatusChip** | `card`+`badges[]`(既存 CardNode badges・L933) | StatusChip の色分岐→`badge` tone(success/warning/caution/neutral)。tone は既存4種にマップ(生hex禁止) |
| 推奨価格/推定送料 | **Tremor KPI**(MIT) | `kpi-tile`(既存・L1251) | 現行 `card` bind_text を `kpi-tile` へ格上げ(「推奨 X円」を主数値化)。value={{data.price.anchor}} |
| 入札履歴(from/kind/amount/time) | ver2 MarketEntityDetailShellW2 の **bid-history table** ／ shadcn data-table | `table`(既存) columns + amount列 | `civ-table` L1102。金額右寄せは CSS |
| 非公開ボード=チャット | ver2 MarketDetailBoardW2 の board | `list` bind_items(既存・現行流用) item_text=1メッセージ | stage2 のみ表示(下記出し分け) |
| GMO振込 table(項目/金額) | ver2 MarketDetailBoardW2 の **GMO振込table** | `table`(既存) columns=[項目/金額] | 着払い/振込は `--civ-text-muted` 注記 |
| 発送(追跡番号入力)/検品(受取・相違) | shadcn form blocks(MIT) ／ ver2 MarketBidEntryW2 | `form`+`field`+`button`×2 | 「相違/死着」button → **navigate to `dispute`(新規screen-def・gap#1)** |

**必要な小改修1点(P0共通の唯一不足)**: stage1/stage2 のノード出し分け。レンダラに **scope条件表示(`when` prop)が無い**(`renderer.tsx` の条件は `button.auto_when` のみ)。最小対応=**(a)** `TabsNode` の `default_tab` を scope 補間可にする1行改修(現状 L1141 は `String(p.default_tab)` で非補間)→ `tabs` を stage にバインドして出し分け、または **(b)** 汎用 `when` prop を NodeView に1箇所追加。ponytail 判断: (a) が既存語彙(`tabs`)を活かす最小差分。ver2 MarketBrowseW2 が既に4タブ構造を持つので (a) の donor になる。

---

### 【最優先2】knowledge-thread 組み立て手順(どの資産のどのブロック→どのノード型)

**現状**(出典 `screen-defs/knowledge-thread.json`): `head` card + `posts` list(item_text=「post_id: body」)+ `consensus` list(item_text=賛成/反対/保留の数)+ `stance` form(**text 2欄=statement_id と value を手打ち**)+ back `link`。アバター・アクションUI・Polis可視化・dispute分岐が欠。

**目標**: 結論候補/争点ピン+Polis型合意可視化+返信 compose。API は投影済(GET `/plaza/threads/{id}`, `/consensus`, POST `/plaza/stances`)。

**ブロック→ノード割り当て**:

| ワイヤー要素 | 供給元ブロック | 割り当てノード型 | トークン化/実装メモ |
|---|---|---|---|
| 投稿(avatar+handle+body+引用+アクション) | **ver2 BoardThreadViewW2**(cite-preview composer・227行・自社=クリーン) ／ 参照 Apache Answer(Apache-2.0・移植) | **専用ノード `thread-posts` を1つ追加(Path B)** | 汎用 `list` の item_text は text+image止まりでavatar+action/postを表せない。BoardThreadViewW2 の markup を専用ノードへ閉じ込めトークン化。avatar枠=`--civ-surface`、本文=`--civ-text` |
| 引用バッジ(invalid状態含む) | **ver2 CiteMiniCardW2**(`ihl-cite-mini__badges`・gap#3最小単位) | `thread-posts` 内 or `badge`(既存) | invalid=`--civ-danger` tone。生hex禁止で tone マップ |
| Polis 合意可視化(賛成/反対/保留 比率) | shadcn/Tremor の水平バー(MIT) | `table`(既存)+ **progress cell**(既存 renderCell L1073) | 現行の数値text list を、statement列+3数値列+賛成比率 `progress` セルへ。追加コード不要(progress cell実装済) |
| **stance 投票(Agree/Disagree/Pass)** | — | `form`+`field variant:segmented`(**既存!** L619) + statement `field variant:select` | **現行の text2欄を撤去** し、Agree/Disagree/Pass を `segmented`(横トグル・native radio・既定1つ選択済)へ。純既存語彙で核心欠落を解消。POST `/plaza/stances` に `static` で body 整形 |
| 返信 compose(cite-preview 付き) | ver2 BoardThreadViewW2 の composer | `form`+`field`(本文) | **`field` に textarea variant が無い**(現状 text/number/date/select/segmented/photo/checkbox/hidden)→ 複数行返信は **textarea variant を FieldNode に1追加**(L705 の else 分岐に `variant==="textarea"` を足す最小差分)。ponytail: ここだけ1 variant 追加が正当 |
| dispute 分岐(Polis対立の裁判2room) | shadcn blocks(MIT) ／ MarketDetailBoardW2 board | `button`→**navigate `dispute`(新規screen-def・gap#1)** | API(`gov-routes.ts` dispute)既存・画面のみ新規。market-trade と共用の dispute 画面 |

**必要な小改修2点**: ① `field` に `textarea` variant 追加(返信本文・1分岐)。② 専用ノード `thread-posts` 追加(avatar+action の per-post リッチ表示・BoardThreadView 移植)。①は汎用語彙拡張として他画面(規約本文等)も裨益。②は既存7専用ノードと同格の一発物。consensus と stance は既存語彙(`table`+progress cell / `segmented`)で **コード追加ゼロ** で核心欠落を埋められる — ここが最大の発見。

---

### 未確認・要フォロー
1. OSS全候補は clone/`npx shadcn add`/レンダリング未検証(WebSearch のみ)。採用前に各 LICENSE 直接確認+実導入テスト必須(Tremor全量OSS化・Preline Fair Use・Apache Answer の Tailwind非採用が特に要確認)。
2. レンダラの **scope条件表示(`when`)不在** は P0 両画面の共通ブロッカー。最小差分は `TabsNode.default_tab` の scope補間化(`renderer.tsx` L1141)。
3. `field` の **textarea variant 不在**・`table` の **button/actionセル不在** — フォーラム系/紛争系で再出するため、専用ノード乱造より汎用語彙2拡張が費用対効果高。
4. ver2 A評価18本のうち `MarketEntityDetailShellW2`/`NumericFilterRow`/`CiteMiniCardW2` は共有部品化候補=P0/P1で先取り採用が効率的(gap の table/filter/badge を横断充足)。
5. `ProfileW2` は C評価(薄ラッパー)だが実体は `packages/ihl-ui-catalog/src/components/features/profile/` 下層 — profile 実装時は下層44ファイルの別トリアージが必要。
6. 実装優先度は市場(market-trade)・広場スレ(knowledge-thread)を P0 とし、両者の分岐先 `dispute`(新規)を P1 に引き上げた(P0完成に不可欠なため)。

---

## 付録A: ver3 全画面 目的・現状 棚卸し表(47 screen-def)

### 方法論(誇張ゼロ)
- 出典: `screen-defs/*.json`(47ファイル・実データから node 種別を機械抽出)、`docs/planning/c7/usecase-driven-design.md`(全1225行・15クラスタの grilling 正本)、`docs/planning/c7/wireframes-core5.md`(重要5画面ワイヤー)、`docs/planning/c7/ui-parity-map.md`(2026-07-12・38画面 score 採点)、`docs/planning/c7/screen-verification-report.md`(2026-07-11〜12・全画面実ブラウザ検証)、git log(実装コミット)。
- ui-parity-map の score は **2026-07-12 時点の baseline**。その後 `individual-detail`(0076681)・`obs-search`(56b5851)・`knowledge-thread`(6f84716)・`obs-register*` 系列(b7aa88b/66f9da9/689fb00)は追加実装が入っているため、該当行は「score→現状」で更新注記した。他の大半(20画面超)は 2026-07-12 から未着手のまま。
- 「画面の型」はアーキタイプの主観分類(node構成から判定)。

---

### クラスタ1: observation-register(観測登録・9画面)— 割り出し/一括登録/再計測/IoT/環境記録の統合入口

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| obs-register | /observe/register | 記録全ユーザーの入口。「記録する」1ボタンから対象継承(親ペア/前回個体/検索)→新規/追観測/一括へ分岐 | recent-chips, table, form/field, button×2, link | dispatcher/triage | C7新規設計(2026-07-12・CI赤根治79e91b5)。E2E green(obs-register.spec.ts)。中密度実装 |
| obs-register-new | /observe/register/new | 検索0件・カメラ「新規」から来た人が新規個体登録(wireframes F1-N) | field:2, form:1, button:1, text:1 | form(single) | 薄い。F1-Nが要求する写真/種候補/クラッチ化選択等が欠、フォーム2項目のみ |
| obs-register-entry | /observe/register/entry | 既存個体への追観測、継承済みヘッダ+今回の差分だけ入力(wireframes F2) | field:6, form:3, disclosure:2, visit-tracker:1, card:2 | form(段階表出) | 実装済(b7aa88b「1個体動線」実E2E・66f9da9で13件磨き直し)。5画面中の中核導線 |
| obs-register-confirm | /observe/register/confirm | 追観測1個体の保存前1画面確認(F5) | text:2, card:1, form:1, field:1, button:1 | confirmation-summary | 実装済(スライス1に含む) |
| obs-register-done | /observe/register/done | 保存後「測った甲斐」(成長差分)を返す完了画面(F6) | button:3, text:2, card:1, link:1 | completion | 実装済(スライス1) |
| obs-register-clutch | /observe/register/clutch | クラッチ(同腹)一括の割り出し登録・匿名プール→匹数入力(F3) | clutch-intake:1(専用) | batch-wizard-step | 実装済(689fb00「F3割り出し」実E2E) |
| obs-register-batch | /observe/register/batch | お世話/移動/ペアリング/割り出しの一括記録(F4) | batch-roster:1(専用) | batch-grid | 実装済(689fb00)。E2E green(obs-register-batch.spec.ts) |
| obs-register-batch-confirm | /observe/register/batch/confirm | 一括記録の1画面確認・異常だけ赤ハイライト(F5) | batch-summary:1(専用) | confirmation-summary(batch) | 実装済(689fb00) |
| obs-register-batch-done | /observe/register/batch/done | 一括保存後の完了画面 | batch-done:1(専用) | completion | 実装済(689fb00) |

**旧世代(C5・observation-register/search grilling前の実装。navigation.json に新設計と並存)**

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| obs-domain-select | /observe | 観測ドメイン(生体/環境等)を選ぶナビ | button:5, heading:1, list:1 | nav-menu | score 55/100。純ナビ・API不要、カード化すれば足りる軽微欠 |
| obs-entry | /observe/entry | ドメイン選択後の観測入力フォーム(V3-UIX-02 3クリック導線終点) | field:8, button:2, form:1 | form(single) | score 58/100。複数計測行・テンプレ適用・確定チップが欠。obs-register-entry が実質後継だが並存 |
| obs-navigator | /observe/navigator | OBS-02/03、3経路(学名substring/二分探索/分類ツリー)で対象特定 | heading:4, text:2, form:1, list:1 | form(multi-path) | score 18/100「二分探索は文だけのスタブ」。obs-search が後継だが navigation.json に両方登録され未整理 |
| obs-confirm | /observe/confirm | obs-entry入力後の確認・登録 | text:3, card:1, button:1 | confirmation-summary | score 15/100(全画面中最薄クラス)。6チャンク確認(recap/写真/環境/命名/次回/テンプレ)の1card実質のみ |
| obs-detail | /observe/detail | 保存済み観測(capture)の詳細+類似個体サイドバー | heading:3, text:2, list:2, card:1 | detail-profile | score 20/100。類似SimilarHitカード(主目的)全欠 |
| qr-resume | /qr/resume | QRスキャンから個体文脈付きで観測入力へ即着地 | text:4, card:1, button:1 | resolver/redirect | score 70/100(到達組)。GET /qr/{token} 投影済、E2E通貫確認済 |

---

### クラスタ2: observation-search(観測 — 個体画像検索)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| obs-search | /observe/search | 頭の中の像から在庫内の該当個体集合へ最短着地し計測/出品/血統照合へ流す。3段決定論梯子(whitelist→subset→embedding 384次元cosine) | search-navigator:1(専用一体型) | search-navigator/data-grid | 実装済(56b5851「検索スライスA」)。**但しscreen-def notesが明記**: F3類似度検索・ステージ別グルーピング・F1L軽量グリッド・コールドスタート自動プリセットは対象外(wireframes-core5 §2フルデザインの部分実装)。E2E green |

---

### クラスタ3: market(ヘラクレス個体の売買)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| market-trade | /market/trade | 出品・購買・成約後の支払い/受取/評価/引継ぎを貫く統合取引 | heading:5, card:4, list:1 | marketplace-listing+transaction-dashboard | score 15→T2でcard値バインド根治(market.spec.ts green)。第4稿ワイヤー(F1出品/F2購買/F2b詳細/F3ダッシュ/F3b発送/F4検品)の写真・仕様table・trust・4段stepper・チャット・GMO振込tableは大半UIのみ未結線 |

---

### クラスタ4: individual-detail(個体詳細)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| individual-detail | /individuals/detail | 「見る」でなく「次に動く」起点。判断3指標(親比較成長曲線/血統健全度/近交リスク)で「この血を次に使うか」を最短判断 | individual-profile:1(専用一体型) | detail-profile(action-hub) | 実装済(0076681「スライスA — 判断3指標+血縁レール+変化点タイムライン」)。旧score 58から大幅前進。QR/NFC直着・交配相手ピッカー・市場来歴帯・画像類似タブ分離の全網羅は要個別確認。E2E green |

---

### クラスタ5: breeding-taxonomy-stats(血統統計・種族/形態管理)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| cross | /individuals/cross | この交配(sire×dam)/系統の失敗率(死亡率/完品率/羽化不全率)を集合単位で判断。individual-detail経由のみ到達(ホーム直行不可=競争煽り構造封じ) | heading:4, text:4, card:3 | analytics/stats-dashboard | score 15/100「率を数値textのみ」。v3改稿が要求するtwo-layer投影(クラッチcount層+昇格individual層)・産地層別統計・系統ツリー・消息不明レーンはほぼ全未実装(集計APIは在りUI未結線) |
| species | /species | 種/形態(morph)の標準化基盤。別名候補承認・産地層別統計・fork継承 | heading:3, field:2, list:1, form:1 | data-table | score 30/100「flat name list+2欄form」。統計カード/morph一覧/alias承認UI/fork系譜が欠(API=CRUD/stats/alias/morphs充実、UI束ねのみ) |

---

### クラスタ6: preference-match-learning(マチアプ/ValueCheck)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| match | /match | 言語化できない好みをYES/NOで気軽に教え、市場/検索のrerankに活かす(目的達成型のobs-searchとは目的関数が逆) | text:3, button:3, card:1 | swipe-card | score 30/100。現状 `item_id`文字列+ボタン3つで**写真が無い**=画像直感評価の核心が未達。主ジェスチャ単一化・両方good2正例化・cold-start閾値ゲートは未実装 |

---

### クラスタ7: contribution-economy-status(実績/信用/通貨)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| profile | /me/profile | 自分の公開ページ(相手から見えるあなた) | heading:4, card:4, button:1 | dashboard(profile) | score 24/100。T2でカード4枚のbind_text根治済(値は表示される)。アバター/内訳table/評価タグは未 |
| economy-status | /economy/status | カルマ・貢献度3軸・プラチナの現在地+履歴 | heading:4, list:2, card:1 | dashboard(stats) | score 25/100。T2(karmaカード値)・T3(貢献度3軸axis_list)で根治済。円リング/内訳3タイル/加算timelineのビジュアル化は未 |
| platinum-shop | /shop/platinum | 免罪符購入(カルマカウント消費) | heading:2, button:2, card:1 | settings-panel(shop) | score 25/100。残高/ラダー/購入履歴tableが欠 |

> **設計意図と実装の乖離**: 改稿版は3画面を「1本のステータス画面3セクション(合算せず横並び)」へ統合する設計を確定しているが、実装は旧来の3分離画面のまま未着手。

---

### クラスタ8: machines-environment-io(機器/環境データ連携)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| device | /devices | SwitchBot等IoT機器の棚join・CSVファースト環境連携 | field:5, heading:3, list:1, form:1 | data-table(device-list) | score 30/100「list=display_name1行+登録form」。「要対応」最上部集約・複数CSVバルク投入口・鮮度バッジが全欠。SwitchBot13台の実疎通はAPI側で確認済(C3)だがUI未反映 |

---

### クラスタ9: qr-physical-label-ops(QR/物理運用)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| bio-card | /individuals/bio-card | 即売会/現金譲渡で1匹1枚渡す名刺型QRカード(種/サイズ/特徴/QR) | text:2, card:1, qr-code:1 | card/label(single) | score 55/100。単票のみ実装。**クラッチ一括QRラベル印刷(A4シート部分再印刷・使いかけシート継続・series命名/連番不変識別子)は新規採番候補=未着手** |

---

### クラスタ10: fork-template-culture(fork×投票のテンプレート文化)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| template-market | /market/templates | 観測/論文/グラフ/重み/AIパック/プロンプトのfork一覧・複製・投票 | heading:2, list:1 | fork-gallery/wizard | score 15/100「text ランキングlistのみ」。fork 3ステップウィザード(一覧→複製→計測項目編集table)全欠 |
| ui-templates | /s/ui-templates | 画面レイアウトのfork/ビルダー | field:3, form:1 | builder | score 15/100「保存フォーム1枚」。3ペインビルダー(パレット/キャンバス/プロパティ)全欠。工数最大・公開は人間ゲート |
| theme-gallery | /s/theme-gallery | 配色/トークンのfork一覧・投票・適用 | link:2, list:1 | gallery-grid | score 25/100「flat list」。カード化/色スウォッチ/系譜/投票UIが欠(API=theme-packs一覧/投票/forkは在り) |
| knowledge-github | /knowledge/github | 開発者貢献(OSS/PR)の柱3。設計上は意図的link-outで完成扱い | heading:1, text:1, link:1 | link-out(minimal by design) | score 30/100だが目標密度自体が低い。設計通りなら実質完成。in-app化(issue/PR要約)は方針判断待ち(未定) |

---

### クラスタ11: knowledge-plaza(知の広場/公式掲示板)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| knowledge-hub | /knowledge | 3柱(公式掲示板/論文/GitHub掲示板)への入口ハブ | heading:4, card:3 | hub/landing | score 70/100。意図的ミニマル(BBS-01)設計で目標密度自体が低く、現状で許容範囲 |
| knowledge-board | /knowledge/board | トピック軸ホーム(探す/書く+割れている論点自動ビュー)。困りごとを症状タグ付き1問投稿 | link:5, field:2, form:1 | forum-board | score 30/100。板セレクタのカード化/タブ/スレッド数badgeが欠。白画面クラッシュはT1で修理済 |
| knowledge-thread | /knowledge/thread | per-thread画面。結論候補/争点ピン+Polis型合意可視化(Agree/Disagree/Pass)+返信compose | heading:4, list:2, field:2, card:1, form:1 | forum-thread | 実装済(6f84716「T1欠落ゼロ化」新規産出)。stance投票・consensus集計はE2E green。アバター表示・アクションUI・**dispute分岐screen-defは未** |

---

### クラスタ12: paper-research-discovery(論文/研究)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| knowledge-paper | /knowledge/paper | v1カードはユーザー判定「薄すぎ」で差し戻し、本クラスタへ改稿統合 | heading:1, text:1, list:1 | list | score 15/100(最薄クラス)。8タブ/進行中論文カード/条件チップ/ステッパー/ギャップprogressが全欠 |
| paper-detail | /research/paper/detail | 実験計画(条件軸マトリクス)の充足度・仮説検証状況 | heading:5, list:3, button:3 | detail(structured-review) | score 30/100。条件チップ/充足度progress/5段ステッパーが欠。API shape不一致 |
| data-descriptor | /research/descriptor | 観測方法テンプレの6節記入(応答変数・条件軸の宣言) | field:9, form:1, list:1 | form(structured multi-section) | score 42/100(5画面中最進捗)。progressバー/条件chip分割/autoFill差し込みが欠、autoFillDescriptorはサーバ未実装 |
| paper-match | /research/paper/match | 実験計画の条件×観測の決定論突合 | heading:5, list:3, field:2, form:1 | form(matcher) | score 55/100。API完備(matchConditions/autoFillDescriptor)、UI描画拡張のみで到達可 |
| project-hub | /research/project/hub | 研究プロジェクトの版/ロット/引用集約ハブ | heading:6, list:3, qr-code:1 | hub/dashboard | score 35/100。contents/citations未描画・版分岐ツリー・lot別QR欠(投影統合要) |
| research-search | /research/search | 論文/wiki横断統合検索(4本柱) | field:3, form:1, list:1 | search-form | score 40/100。POST /research/search在り、結果行(スニペット/タグ/スコア/ファセット/ページング)未描画 |
| research-newspaper | /research/newspaper | 日次蒸留ダイジェストの新聞体裁配信 | heading:2, card:1, list:1 | content-feed(article) | score 28/100。記事本文/セクション/難易度階層/号アーカイブが欠 |

---

### クラスタ13: auth-onboarding-locale(認証・初期設定)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| login | /login | マジックリンク+dev-loginでの認証入口 | field:2, button:2, form:1 | auth-form | score 80/100(到達組)。magic-link/verify/dev-login実装済。**改稿版が要求するhandle(@id)不可避第2ゲート・別端末/webview対応の数字コード入力欄常設・規約再同意ゲート列挙漏れは未反映**(設計改稿が実装未到達) |
| country-select | /onboarding/country | 国選択(改稿版は必須オンボーディングから除外・後回し推奨の設計方針) | heading:1, field:1, button:1 | form(single-select) | score 35/100「select 5国ハードコード」。網羅リスト・検索・永続化・国旗が欠。pref-set schemaにcountry無し=API追加要 |
| language-select | /onboarding/language | 表示言語(locale)選択。改稿版で「必須2ゲートの1つ」 | heading:1, field:1, button:1 | form(single-select) | score 65/100。locales/pref-set在り、軽量ピッカーとしては到達済 |
| terms | /onboarding/terms | 規約同意。改稿版は版差分の再同意ゲート(観測公開切替時含む)を要求 | heading:1, text:1, button:1 | legal-consent | score 20/100「1段落+ボタンのみ」。/terms相当API無し。版ラベル/複数セクションcard/同意checkboxゲートが欠 |

---

### クラスタ14: account-settings-privacy(アカウント設定)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| settings | /s/settings | AI接続/取引前PII/通知/バックアップの自己管理 | text:3, field:3, card:1, form:1 | settings-panel | score 25/100・**要人間裁定**。左サイドナビ4タブ/取引前PIIフォーム全欠。取引前PII保存は不変条項③(住所非保持)と衝突するため人間裁定待ち。改稿版が要求するzero-knowledge blob(クライアント暗号化)複数端末対応も未実装 |
| ai-profile-settings | /s/ai-profile-settings | 機能ごとのBYOK(自分のAPIキー)AI接続設定 | field:4, card:1, form:1 | settings-form | score 55/100。正本ai-profiles/*.json+schema実在、API不要で到達可。複数端末鍵同期(パスフレーズ暗号バンドル)は改稿版新設計だが未実装 |

---

### クラスタ15: home-command-center(ホーム)

| screen_id | route | 誰が何のために来るか | 主要素 | 型 | 現状の出来 |
|---|---|---|---|---|---|
| home | / | 認証後司令塔。今日の状態(triage)+次の一手 | button:6, link:6, card:1, list:1 | dashboard(command-center) | score 35/100。still_shallow差し戻し後の改稿版が要求するtriage(クラッチcount層のサンプル計測due・季節性ゲート付き長期不在検知・取引/未読指摘バッジ)はほぼ未実装。現状は18個のnavボタン羅列に近い「目次」型のまま |

---

### screen-def未作成のギャップ(要件はあるが画面が存在しない)

1. **dispute(二人部屋紛争解決)画面** — market cluster(相違/死着で receive確定でなくdispute分岐)と knowledge-plaza cluster(Polis対立の裁判2room)の両方が要求。API(`gov-routes.ts`にdispute実装済)はあるがscreen-defが存在しない。screen-verification-report §4-3でも「per-thread画面は産出したがdispute専用screen-defは未」と明記。
2. **handle(@id)確定専用ステップ** — auth-onboarding-locale改稿の核心要求(不可避第2ゲート・晒し事故防止機構)。login.jsonに統合されているか不明瞭で専用screen-defなし。いわゆる「signup」単体画面はマジックリンク一本化方針のため意図的不在だが、handle確定を伴う初回オンボーディング画面は未分化。
3. **QRラベル一括印刷画面**(クラッチ単位バッチ・A4シート途中再開・部分再印刷・series命名) — qr-physical-label-opsクラスタの主要求。usecase-driven-design.md末尾の「新規採番候補」に明記、裁定待ちで未着手。
4. **SwitchBot CSV importer画面**(機器選択→CSV投入→期間重複put-if-absent自動スキップ) — 新規採番候補2。device画面の「複数CSVバルク投入口」要求に対応する専用UI未着手。
5. **Docker collector配布/設定画面** — 新規採番候補3(任意レイヤー)。
6. **検索のグラフビュー+ホバー簡易カード**(血縁/類似のエンティティ紐づき図) — 新規採番候補1。obs-searchとpaper-research-discoveryのギャップ可視化で部品共有可能性ありと明記されるも未着手。
7. **contribution-economy-statusの3画面統合** — 「profile/economy-status/platinum-shopを1本のステータス画面3セクションへ」の設計は確定済みだが実装未着手(現状3画面分離のまま)。
8. **旧世代観測入力チェーンの未整理** — `obs-entry`/`obs-confirm`/`obs-navigator`/`obs-domain-select`(C5)と新設計`obs-register*`/`obs-search`(C7)がnavigation.jsonに両方登録されたまま並存。統合または廃止の裁定が必要。

### 出典
- `D:\claude\systems\ihl-ver3\screen-defs\*.json`(47ファイル)
- `D:\claude\systems\ihl-ver3\docs\planning\c7\usecase-driven-design.md`
- `D:\claude\systems\ihl-ver3\docs\planning\c7\wireframes-core5.md`
- `D:\claude\systems\ihl-ver3\docs\planning\c7\ui-parity-map.md`
- `D:\claude\systems\ihl-ver3\docs\planning\c7\screen-verification-report.md`
- git log(コミット: 0076681, 56b5851, 79e91b5, 689fb00, 66f9da9, b7aa88b, 6f84716, 5af4b1d)

---

## 付録B: OSSデザイン資産スイープ結果(画面アーキタイプ別・Web調査)

前提: 技術スタック Next.js15+React19+Tailwind v4。判定基準は「商用可ライセンスか」「Tailwind適合度」「丸ごと度(コピペ/clone で完成品になるか)」。すべて WebSearch 経由の未実地検証情報(実際に clone/レンダリング未実施)。ライセンス条文は各リンク先で最終確認必須。

### ① marketplace(一覧+詳細・出品カード・フィルタ)

| 名前 | URL | ライセンス(商用可) | 丸ごと度 | Tailwind適合度 | 備考 |
|---|---|---|---|---|---|
| shadcn/ui 公式 Blocks | https://ui.shadcn.com/blocks | MIT(shadcn/ui本体) | 中(パーツ単位、要組立) | 適合(Tailwind v4 New York style) | 一次情報源。安定して更新 |
| Tremor Blocks | https://blocks.tremor.so/ (src: https://github.com/tremorlabs/tremor-blocks) | MIT(2025-01 Vercel買収後にPro分含め全面OSS化・ライセンスページ https://blocks.tremor.so/license で要最終確認) | 高(テンプレ単位) | 適合(Tailwind+Radix) | 250+ブロック。ダッシュボード/一覧系が厚い |
| Medusa.js Next.js Starter Storefront | https://github.com/medusajs/nextjs-starter-medusa | MIT | 非常に高(動く完成アプリ・商品一覧+詳細+フィルタ+カート一式) | 適合(Tailwind) | ヘッドレスコマースだが「マーケットプレイス一覧+詳細」の実物として最有力候補。バックエンド(Medusa)込みで採用するかは要判断 |
| HyperUI Ecommerce components | https://hyperui.dev/ | MIT(確認済) | 低〜中(コンポーネント単位) | 適合 | 226+components、無料・帰属表示不要 |
| Flowbite E-commerce blocks | https://flowbite.com/blocks/e-commerce/ (account-overview: https://flowbite.com/blocks/e-commerce/account-overview/) | MIT(無料枠のみ。全量はPro) | 中 | 適合 | 459ブロック中、無料枠は一部 |
| Preline Ecommerce templates | https://preline.co/templates/ecommerce/ | MIT + Preline Fair Use License(詳細: https://preline.co/docs/license.html) | 中〜高 | 適合 | Fair Use条項は「競合UIライブラリとしての再配布」のみ制限。自社アプリ組込は実質MIT相当 |

### ② フォーラム/スレッド(Q&A・投票)

| 名前 | URL | ライセンス | 丸ごと度 | Tailwind適合度 | 備考 |
|---|---|---|---|---|---|
| Apache Answer | https://github.com/apache/answer (公式: https://answer.apache.org/) | Apache-2.0(商用可) | 高(質問/回答/投票/タグのUI一式が動く完成品) | 不適合(Go backend + 独自React、Tailwind非採用の可能性が高い・未確認) | Q&A+投票の要件に最も直接ヒット。**フロントのUIパターンを参照移植する用途が現実的**、丸ごとcloneはスタック統合コスト要検討 |
| Flarum | https://github.com/flarum/framework (公式: https://flarum.org/) | MIT | 低(PHP/Mithril、Next.jsと統合不可) | 不適合 | 「いいね/inappropriate」投票あり。UI/IA参照専用、コード再利用は非推奨 |
| Discourse | https://github.com/discourse/discourse | **GPL-2.0(除外候補: コピーレフト強・スタック不一致)** | — | 不適合 | Ruby on Rails+Ember。参照のみ |
| NodeBB | https://github.com/NodeBB/NodeBB | **GPL-3.0(除外候補: コピーレフト強・スタック不一致)** | — | 不適合(Benchpress/Webpack、Reactでない) | 参照のみ |

### ③ データテーブル/記録系(一括入力・観測ログ)

| 名前 | URL | ライセンス | 丸ごと度 | Tailwind適合度 | 備考 |
|---|---|---|---|---|---|
| shadcn/ui 公式 Data Table block | https://ui.shadcn.com/docs/components/data-table | MIT | 高 | 適合 | TanStack Table + shadcn組合せの一次情報源 |
| TanStack Table | https://github.com/TanStack/table | MIT | 部品(headless、UIは自作/shadcn併用前提) | 適合(ヘッドレスなのでTailwindと自由に組める) | 一括入力・大量行編集の基盤として事実上の標準 |
| AG Grid Community | https://github.com/ag-grid/ag-grid (https://www.ag-grid.com/react-data-grid/community-vs-enterprise/) | MIT(Community版のみ。Enterprise機能は商用ライセンス別途) | 高(編集・ソート・フィルタ内蔵) | 適合(テーマCSSカスタム可) | 一括編集(セル編集)が要件に直接ヒット。Enterprise機能(ピボット等)には手を出さない前提で採用可 |
| Glide Data Grid | https://github.com/glideapps/glide-data-grid | MIT | 高(Canvas描画で大量行に強い) | 適合 | 観測ログのような高頻度行データに向く |
| InvenTree | https://github.com/inventree/InvenTree (公式: https://inventree.org/) | MIT | 低(コード流用は困難) | **不適合(Mantine UI採用、Tailwindでない・未確認要検証)** | 在庫/一括入力のIA参照用途に限定。フロントはReact SPAだがMantineベースの可能性が高い |
| eLabFTW | https://github.com/elabftw/elabftw | **AGPL-3.0(除外候補: コピーレフト最強・改変物の公開義務)** | — | 不適合(PHP/Twig) | 観測ログ/バルク入力のIA発想源としてのみ参照可。コード取り込みはAGPL汚染リスクで非推奨 |
| Grocy | https://github.com/grocy/grocy (公式: https://grocy.info/) | **未確認(要GitHubのLICENSEファイル確認)** | — | 不適合(PHP monolith、PWA) | バーコード一括処理UIのIA参照のみ。ライセンス未確認のため採用判断保留 |

### ④ 個体詳細/プロフィール(チャート+タイムライン)

| 名前 | URL | ライセンス | 丸ごと度 | Tailwind適合度 | 備考 |
|---|---|---|---|---|---|
| shadcn-timeline | https://github.com/timDeHof/shadcn-timeline | MIT | 高(コピペで垂直タイムライン完成) | 適合(Next.js+Tailwind+Framer Motion) | 成長チャートのタイムライン軸に直接使える |
| ReUI Timeline / Stepper | https://reui.io/components/timeline / https://reui.io/components/stepper (repo: https://github.com/keenthemes/reui) | MIT(確認済) | 高 | 適合(shadcn/ui互換のcopy-and-own方式) | 1000+パターン、実例ダッシュボード内で確認可能 |
| Tremor Chart components(AreaChart/LineChart) | https://www.tremor.so/ (repo: https://github.com/tremorlabs/tremor) | MIT | 高(成長チャート時間軸に直結) | 適合 | 既にプロジェクトのC7要件「成長チャート時間軸」と一致 |
| Flowbite Profile/Account overview block | https://flowbite.com/blocks/application/ 内 profile系 | MIT(無料枠) | 中 | 適合 | プロフィールカード+統計サマリの型 |

### ⑤ ウィザード/オンボーディング

| 名前 | URL | ライセンス | 丸ごと度 | Tailwind適合度 | 備考 |
|---|---|---|---|---|---|
| ReUI Stepper | https://reui.io/components/stepper | MIT | 高(アカウント設定/プロフィール/設定のオンボーディング例内蔵) | 適合 | ④と共通ライブラリで統一感を出せる |
| Next Stepper | https://allshadcn.com/components/next-stepper/ | MIT(記事内で明記) | 高 | 適合(Next.js template) | 動的マルチステップフォーム専用 |
| Shadcn UI Multi Form / Multi Step Form Template | https://shadcn-ui-multi-form.vercel.app/ 、 https://www.shadcn.io/template/marcosfitzsimons-multi-step-form | 個別要確認(shadcn.io掲載テンプレは概ねMIT系だが**未確認**) | 中〜高 | 適合(Zod+shadcn/ui) | Zodバリデーション込みで実用的 |

### ⑥ 設定

| 名前 | URL | ライセンス | 丸ごと度 | Tailwind適合度 | 備考 |
|---|---|---|---|---|---|
| Preline Application UI(profile/settings系) | https://preline.co/blocks/ 、 https://preline.co/templates/dashboards/ | MIT+Fair Use(④と同条件) | 高 | 適合 | 「profiles, settings, account summaries」を明示的にカバー |
| Flowbite Account settings block | https://flowbite.com/blocks/application/ | MIT(無料枠) | 中 | 適合 | フォーム主体の設定画面パターン |
| Cal.com 設定画面(参照専用) | https://github.com/calcom (LICENSE: https://github.com/calcom/cal.com/blob/main/LICENSE) | **AGPL-3.0(除外候補: コード取り込み不可・非公開repoでの利用は商用ライセンス別途必要)** | — | 適合(Next.js+Tailwind本体は一致) | IA/UXパターンの目視参考のみ。コードクローンは非推奨 |

### ⑦ ダッシュボード/ホーム

| 名前 | URL | ライセンス | 丸ごと度 | Tailwind適合度 | 備考 |
|---|---|---|---|---|---|
| Tremor Blocks(ダッシュボード系) | https://blocks.tremor.so/ | MIT(①に同じ) | 非常に高 | 適合 | ホーム画面のKPIカード+チャート構成に直結 |
| shadcn/ui 公式 dashboard-01 block | https://ui.shadcn.com/view/new-york-v4/dashboard-01 | MIT | 高(`npx shadcn add dashboard-01`で導入完了) | 適合(New York v4テーマ = Tailwind v4) | サイドバー+チャート+データテーブル一式。一次情報源かつ最軽量導入 |
| Kiranism/next-shadcn-dashboard-starter | https://github.com/Kiranism/next-shadcn-dashboard-starter | MIT(README内で明記) | 非常に高(Next.js16+shadcn+TypeScript+Tailwindの完成スターター) | **最適合(スタック完全一致)** | 本プロジェクトのNext.js15+Tailwind v4に最も近い技術構成。⑦の最有力候補 |
| arhamkhnz/next-shadcn-admin-dashboard | https://github.com/arhamkhnz/next-shadcn-admin-dashboard | **未確認(LICENSEファイル要直接確認)** | 高 | 適合(Next.js16+shadcn/ui) | ライセンス未確認のまま採用不可、確認後に再評価 |
| satnaing/shadcn-admin | https://github.com/satnaing/shadcn-admin | MIT(最もフォークされているshadcn admin) | 高 | **要注意(Vite+TanStack Router、Next.jsでない)** | IA/コンポーネント参照は可、フレームワーク移植コストあり |

### 除外候補(ライセンス/スタック不一致で明記)

- **Discourse**(GPL-2.0)、**NodeBB**(GPL-3.0)、**eLabFTW**(AGPL-3.0)、**Cal.com**(AGPL-3.0) — コピーレフト系。コード取り込みは非推奨、UI/IAの目視参照専用に限定。
- **Grocy** — ライセンス未確認、PHPスタック不一致。
- **arhamkhnz/next-shadcn-admin-dashboard** — ライセンス未確認(LICENSEファイル未取得)。
- **shadcnblocks.com / shadcnstudio.com 等の商用ブロック集** — 個別ライセンス(独自EULA、再配布・マーケットプレイス組込禁止条項あり)。無料公式(ui.shadcn.com)・MIT系(HyperUI/Tremor/Kiranism)を優先し、有料ブロック集は「デザイン参考」止まりを推奨。

### 総括(アーキタイプ→最有力1件)

① Medusa.js Next.js Starter Storefront(丸ごと度最高、要バックエンド統合判断) / ② Apache Answer(UI参照、丸ごとcloneはスタック統合コスト要検討) / ③ shadcn/ui Data Table + TanStack Table + AG Grid Community(部品組合せが最も安全) / ④ shadcn-timeline + Tremor Chart(MIT・Tailwind適合済み) / ⑤ ReUI Stepper(④と同一エコシステムで統一) / ⑥ Preline Application UI(settings系) / ⑦ Kiranism/next-shadcn-dashboard-starter(スタック完全一致・最優先候補)。

**未確認事項**: 全候補ともnpm install/clone実行による実地検証は未実施(WebSearch経由の情報のみ)。採用前に各GitHub repoのLICENSEファイル直接確認・`npx shadcn add`等での実導入テストが必要。

---

## 付録C: ver2カタログ良品トリアージ結果

### 対象と誤り訂正
指定パス `packages\ihl-ui-catalog\src\w2\*` は実在しない。実体は **`apps\ui-parts-lab-w2\src\w2\*`**（tsxコンポーネント28本＋mock/config用.ts 18本）。この28本は `registry.ts` の `DEDICATED_W2_OVERRIDES` で「3100番台ベースカタログ(`packages/ihl-ui-catalog`)を手作業で上書きした最良層(B軸 W2 hand UI)」と明記されており、ver2内で最も作り込まれた部品群＝ユーザーの言う「作り込めてる画面」の実体候補。この28本のみを機械採点した（.tsの18本は挙動なしのmock/config/routing定義でコンポーネントではないため対象外）。

### 判定基準（機械的指標）
- 行数・hooks数(useState等)・handler数(onClick等)・className数
- スタイル密度: className文字列を `apps/ui-parts-lab-w2/dist/assets/index-*.css`（コンパイル後CSS、ベースカタログのcssも合流済み）で実在確認 → 全ファイル共通で本物のBEM階層CSSが存在（空スケルトンではない）。TODO/stub文字列は全件grepしたが実質ゼロ、"mock"ヒットは全て`bidMock`等の変数名で未実装マーカーではないと確認済み。
- 対応する ver3 screen_id と `docs/planning/c7/ui-parity-map.md` のscore（`registry.ts`のcomponent_id接頭辞から機械的に特定）
- mockup該当: `D:\mockups`（キュレーション正本）＋`apps\ui-parts-lab-w2\public\mockups`（ruling記載の正本の一部）の両方を確認
- **A**=そのまま部品として使える（自己完結・実データ構造あり・対応mockup/screen_idあり）　**B**=参考のみ（薄い/対応mockup不在/兄弟コンポーネントの重複バリアント）　**C**=使わない（ver2 SPA固有の配線・薄いラッパー・実マークアップなし）

### 全件表（28ファイル、行数降順ではなくA→B→C）

| # | ファイル | 行数 | hooks/handler | 対応 screen_id (ver3) | parity score(現状/欠落) | mockup正本 | 判定 | 転用先・理由 |
|---|---|---|---|---|---|---|---|---|
| 1 | ObsContextPickerW2.tsx | 1593 | 27/42 | ihl-05-obs-context-picker → obs-navigator系 | 18 | ihl-05-obs-context-picker.png(有) | **A** | 唯一 `--civ-*` トークンを既に使用(14箇所)。対象確定フロー丸ごと転用可 |
| 2 | MarketBrowseW2.tsx | 1261 | 21/28 | ihl-06-market-browse | market-trade=15 | ihl-06-market-browse.png(有) | **A** | browse/auction/lottery/priorityの4タブ内包。table/card/badge/画像grid/filterを同時充足 |
| 3 | ObsSearchW2.tsx | 866 | 24/29 | ihl-05-obs-search-grid | obs-navigator=18(目標:8フィルタ+4列grid) | 有 | **A** | フィルタ+grid実装済。gap欄「二分探索は文だけのスタブ」の解消材料 |
| 4 | ObsRegistrationW2.tsx | 590 | 14/32 | ihl-05-obs-input-row/obs-device-link(→observation-input=85 達成済) + ihl-05-obs-confirm(=15 未達成) | 85 / 15 | ihl-05-obs-input-row.png等(有) | **A** | 自己完結。ただし転用価値は主に**obs-confirmチャンク**側(input-rowは既にver3で85点達成済＝重複) |
| 5 | PreferenceLearningW2.tsx | 579 | 15/19 | ihl-10-preference-pairwise | match=30(目標:収束度インジケータ) | ihl-10-preference-pairwise.png(有) | **A** | `w2-mch-converged`＝収束度UI実装済。parity map記載の欠落そのものを埋める |
| 6 | MarketEntityDetailShellW2.tsx | 514 | 6/9 | Market系複数から共有される土台 | market-trade=15 | 複数market mockup共通 | **A**(共有部品) | bid-history table・StatusChip実装確認。gap#1(table)/#3(badge)を横断的に充足 |
| 7 | MarketDetailBoardW2.tsx | 453 | 5/24 | ihl-06-market-detail-board | market-trade=15(行完全一致) | ihl-06-market-detail-board.png(有) | **A** | stepper19箇所・GMO振込table実装を確認。parity map記載欠落「4段stepper/GMO振込table」を正確に埋める |
| 8 | PaperTemplateFillW2.tsx | 390 | 7/16 | ihl-09-paper-template-fill | data-descriptor=42(5画面中最進捗) | ihl-09-paper-template-fill.png(有) | **A** | 対象そのもの。progress/✓/chip系の実装土台 |
| 9 | PaperProgressW2.tsx | 261 | 0/8 | ihl-09-paper-in-progress | knowledge-paper=15(目標:5段ステッパー/ギャップprogress) | ihl-09-paper-in-progress.png(有) | **A** | `w2-paper-phase__track`＝stepper実装済。gap#4(progress)/#7(stepper)充足 |
| 10 | BoardThreadViewW2.tsx | 227 | 7/8 | ihl-07-board-thread-view | knowledge-thread=20(目標:アバター/引用/dispute) | 直接一致なし(board-thread-post近似) | **A** | `cite-preview`付きcomposer実装。gap記載「アバター表出とアクションUI」の解消材料 |
| 11 | HomeCommandPanelW2.tsx | 222 | 0/2 | ihl-01-nav-home | home=35(目標:4枚KPIタイル) | ihl-01-nav-home.png(有) | **A** | `ihl-stat-grid/card`＝KPIタイル実装済。gap#8を直接充足 |
| 12 | MarketBidEntryW2.tsx | 228 | 7/5 | ihl-06-market-auction-bid | market-trade=15 | ihl-06-market-auction-bid.png(public/mockupsに有) | **A** | className39・自己完結。入札UI転用可 |
| 13 | MarketPriorityApplyW2.tsx | 284 | 7/5 | ihl-06-market-priority-queue | market-trade=15 | ihl-06-market-priority-queue.png(public/mockupsに有) | **A** | className50と密度高。優先申込フロー転用可 |
| 14 | NumericFilterRow.tsx | 187 | 4/13 | obs-search-gridの子部品(共有) | obs-navigator=18 | — | **A**(共有部品) | gap#9「フィルタパネル」の唯一の実装例(`obs-direction-control`チップ含む) |
| 15 | BoardHubW2.tsx | 106 | 0/3 | ihl-07-board-hub | knowledge-board=30(目標:2x2リッチカードgrid) | ihl-07-board-hub.png(有) | **A** | カードgrid実装済。gap#2充足 |
| 16 | KarmaSummaryW2.tsx | 107 | 0/5 | ihl-08-karma-summary | economy-status近似=25 | ihl-08-karma-summary.png(public/mockupsに有) | **A** | karma-bar+履歴table自己完結（ベースcatalogの`profile/shared`部品を利用しつつ内容は独自） |
| 17 | CiteMiniCardW2.tsx | 95 | 4/2 | Board/Paper系から呼ばれる共有atom | — | — | **A**(共有部品) | 引用badge(`ihl-cite-mini__badges`、invalid状態含む)。gap#3の最小再利用単位 |
| 18 | BoardThreadListW2.tsx | 203 | 2/6 | ihl-07-board-post---(愚痴)+ihl-07-board-thread-post(改善) | knowledge-board/thread=20-30 | ihl-07-board-post-愚痴.png・ihl-07-board-thread-post.png(両方有) | **A** | 2mockup直接一致。composerのcite-preview実装含む |
| 19 | MarketListingDetailW2.tsx | 310 | 7/9 | ihl-06-market-listing-detail | market-trade=15 | 該当なし(「listing-create」はあるが「detail」mockupが存在しない) | **B** | 自己完結だがclassName密度17と兄弟より薄く、対応する完成mockupで目視検証できない |
| 20 | MarketLotteryApplyW2.tsx | 138 | 0/4 | ihl-06-market-lottery-apply | market-trade=15 | ihl-06-market-lottery-apply.png(public/mockupsに有) | **B** | mockupはあるが実装密度が兄弟(bid/priority)より明確に薄い(hooks=0・className14) |
| 21 | GitHubBoardHubW2.tsx | 109 | 0/5 | ihl-07-github-board-hub | knowledge-github=30 | なし(ver2 component-board参考のみ) | **B** | 部品自体は良品だが、parity map上「設計は意図的link-outで目標密度自体が低い」screen＝転用優先度が低い |
| 22 | OfficialBoardHubW2.tsx | 93 | 0/3 | ihl-07-board-official-hub | knowledge-board=30 | なし | **B** | BoardHubW2(#15)とほぼ同一カードパターンの重複バリアント。二重採用不要、参考止まり |
| 23 | BrandChromeW2.tsx | 49 | 0/3 | 共有headerクロム | — | — | **B** | 実CSS(`brand-chrome.css`)ありだが小規模。ver3は別header設計のため参考程度 |
| 24 | W2UniversalStatePanel.tsx | 72 | 2/1 | 共有state panel(loading/empty/error) | — | — | **B** | 汎用状態パネル機構は参考になるが単体では小規模すぎ転用に値せず |
| 25 | ProfileW2.tsx | 62 | 0/6 | ihl-profile-three-metrics | profile=24 | ihl-profile-three-metrics.png(有) | **C** | **薄いラッパー**。実体は `packages/ihl-ui-catalog/src/components/features/profile/*.tsx` に委譲しているだけ(フッターnav追加のみ) |
| 26 | withW2Shell.tsx | 149 | 0/2 | インフラ(HOC) | — | — | **C** | ver2 SPA固有のfeature→hub遷移マップ。ver3 ScreenDefレンダラの語彙と無関係 |
| 27 | W2ScreenRenderer.tsx | 180 | 0/0 | インフラ(レンダラ本体) | — | — | **C** | ver2独自のcomponent registryレンダラ。ver3は別設計のScreenDefレンダラが既稼働中で直接移植不可 |
| 28 | w2-global-chrome.tsx | 51 | 0/0 | header/footer nav設定 | — | — | **C** | classNameゼロ＝実マークアップなし(定数リストのみ)。ナビ項目名は参考データ程度 |

### 内訳サマリ（ユーザー評価「30点・作り込めてる画面とそうでないのがある」の機械的裏付け）

| 判定 | 件数 | 割合 |
|---|---|---|
| A(そのまま部分利用) | 18 | 64% |
| B(参考のみ) | 6 | 21% |
| C(不使用) | 4 | 14% |

- **最良層(W2 hand UI, 28本)の中でも64%は転用可、残り36%は薄いか対象外** — 「作り込めてる画面とそうでない画面がある」はこの最良層の内部でも成立する。
- A評価18本は ver3 の `market-trade`(15点)・`obs-navigator`(18点)・`knowledge-paper`(15点)・`knowledge-thread`(20点)・`home`(35点)・`match`(30点)・`data-descriptor`(42点) など**低スコア screen の欠落を正確に埋める形**で実装されている(`ui-parity-map.md` §1 の「主な欠落」欄と1対1で一致)。特に共有部品化候補3本(`MarketEntityDetailShellW2`・`NumericFilterRow`・`CiteMiniCardW2`)は §2 の「共有レンダラ語彙の不足」(table/filter/badge)を埋める実装そのもの。
- C評価4本のうち `ProfileW2.tsx` は重要な例外：**ver2内でも「本体はさらに下層(`packages/ihl-ui-catalog/src/components/features/`)にある」ケース**が存在する。今回のスコープ外だが、`profile/`・`market/`・`observation/`など44ファイルのベースカタログ層は未採点。profileの実体調査が必要なら次パスで対象に含めるべき。

### 未検証・要フォローの注記
- mockup正本を `D:\mockups` 単独ではなく `D:\mockups` + `apps\ui-parts-lab-w2\public\mockups` の合算で判定した（ruling「正本=ui-parts-lab+D:\mockups」に基づく）。`D:\mockups` 単独には market-auction-bid / lottery-apply / priority-queue / obs-context-picker / karma-summary が欠けており、キュレーション同期漏れの可能性がある（要ユーザー確認、削除保護対象ではないので同期自体は可逆）。
- 目視でのレンダリング確認（Obsidian等と同じ「見て使える」ゲート）は今回未実施。機械的指標のみでの採点であり、`npm run dev` 起動 or スクリーンショットでのA評価18本の実見は次工程で必要。
- ver2ベースカタログ層(`packages/ihl-ui-catalog/src/components/features/*.tsx`、44ファイル)は今回のスコープ外。ユーザー指定パスの誤りにより本来対象だった可能性もあるため、必要なら別途トリアージする。
