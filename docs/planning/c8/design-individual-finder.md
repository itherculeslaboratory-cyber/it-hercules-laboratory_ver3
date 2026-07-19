---
id: c8-design-individual-finder
title: 理想の個体ファインダー 実装設計(caseB7正本参照・T-42 / V3-UIX-82 統合)
date: "2026-07-17"
status: draft
---

# 理想の個体ファインダー 実装設計

> 正本参照 = `00-hq/dashboard/mockups/caseB7/finder.html`(329行)+ `universe-focus.html`(590行)。persona-model **R45** で最高評価・「絶対にIHLver3に実装する」を受けた成果物。本設計はこの2ファイルの体験を ver3 の実装土台(API・不変条項・UI再設計正本)へ落とし込む。
> **誇張ゼロ方針**: 調査で「スタブ/未接続/欠落」と確認された部分を「ある」とは書かない。実装済みと前提条件を厳密に分ける。

## 1. 機能仕様(ver3語彙)

### 1.1 一覧・絞り込み面(finder.html 相当)
- 個体テーブル: 個体名/種族/世代/体長/体重/色/羽化日/系統/個体ID。列ヘッダクリックで即sort。
- フィルタバー: 種族(排他チップ)・色系統・数値レンジ(体長/体重等)。AND合成。
  - **【IA v2統合注記(2026-07-19・structure-canon v2 §1/§3)】** 種族narrowingの一次手段は**ヘッダーの観測対象セレクタ(グローバル文脈スイッチ)経由**へ移行。ファインダー内の種族チップはヘッダー選択の**下位ファセット**として動作する(ヘッダーで「ヘラクレス」を選べばファインダーは既定でヘラクレスに絞られ、チップはさらに系統を刻む)。原型HTML(caseB7/universe-focus)の「HERAKLES 3D UNIVERSE」等の単一種族前提表記は多種族では不正確 → 実装では観測対象セレクタの選択に追従した動的タイトルにする。
- プリセット(例「上位10%×特定色系統」)は実データの分位点を都度計算して注入(ハードコード閾値でない)。
- 単一行選択→選択情報バー→「★宇宙で見る」で 1.2 の宇宙面へ 1クリック遷移。

### 1.2 宇宙・フォーカス面(universe-focus.html 相当)
- 3D力学配置。ドラッグ回転・ズーム。ノードホバーで簡易カード(名前/種族/世代/系統)。
- ノードクリック→**個体詳細パネル**(個体ID・血統 sire/dam/子・形質)+血統ハイライト(先祖/子孫を発光・無関係を減光)。血統リンククリックでその個体へジャンプ。
- 「★この個体に近い」= 選択個体の近傍上位を切り出しカメラ自動フレーミング。
- 種族フィルタチップ・全体リセット。
- ズーム距離連動の段階的情報開示(遠=色のみ→近=名前ラベル→さらに近=画像カード)。
- 遷移: 一覧の`?focus=個体ID`受信で該当個体へ自動フォーカス+バナー表示。

## 2. データ接続設計

### 2.1 実装済み・そのまま供給できるもの(検証済み)
| ver3機能 | 供給元(実装済み) | 状態 |
|---|---|---|
| 個体一覧+検索+sort | `GET /individuals`(`individual-routes.ts:993` `listIndividualsFor`)。sort ホワイトリスト=`last_capture_at`/`capture_count`/`latest_length_mm`/`latest_weight_g`/`next_observation_at`。フィルタ=`q`(部分一致)・`species`/`stage`/`status`/`parent_id`/`lineage_id` | Truth(R2)全件scan→都度再計算(常駐indexなし) |
| 個体詳細 | `GET /individuals/:id`・`/profile`(`projectIndividualProfile` `:686`) | 実装済み |
| 血統(親たどり) | `buildPedigree`(`:98`)・`GET /individuals/:id/pedigree`。多世代木・circular/truncated検出 | 実装済み |
| 中心個体の周辺グラフ | `projectEntityGraph`(`:167`)・`GET /individuals/:id/graph`(`:1209`)。血縁+画像類似cosine上位topK(既定5)を統合。TC通過(`tests/individual.test.ts:1142`) | 実装済み。**ただしego-graph(自分+血縁+類似上位)であって全個体同時の"宇宙"ではない** |
| 写真サムネ | `GET /observation/{capture}/thumbnail/{photo}` | 実装済み |
| rerank合成スコア | `compositeScore`(`observation-routes.ts:168`)重み 0.50/0.20/0.20/0.10 | 実装済み。**color/size成分は常時 欠測既定0.5**(`:167`,`:538`) |
| 好み学習ブレンド | `match-routes.ts`(`projectPreferenceWeights`/`rankByPreference`) | 実装済み。ただし「好みスワイプ学習」用で形質類似探索そのものではない |

### 2.2 スタブ/未接続 — 前提条件として明記(誇張ゼロ)
| caseB7で見えるもの | ver3の実体 | 正直な状態 |
|---|---|---|
| 「距離=形質類似」の空間配置 | 画像embedding(V3-OBS-09) | **DINOv2は未実装**(`components/obs-manifest/run.py:101` が明示的に `RuntimeError("dinov2 backend is a later wave")`)。既定は`dummy`(sha256由来・決定論だが意味を持たない)。アップロード→embedding自動生成の配線もなし(読むだけ) |
| 色系統フィルタ/色ドット | 色特徴量(OBS-14 `lab_features.py`) | 純numpy関数は完成。だが入力(部位別ピクセル抽出=クライアントOBS-46/47)が未接続。rerankのcolor成分は欠測既定0.5 |
| 胸角mm等の単一形質sort(**T-42⑤必須**) | 単一形質sort/分類 | **バックエンドに存在しない**。sort ホワイトリストに胸角なし。T-42⑤の未充足箇所 |
| 全個体同時の宇宙配置 | 全体座標投影(次元圧縮 PCA/UMAP等) | **repo grep 0件**。`projectEntityGraph`はego-graphのみ。全体宇宙の投影計算は未実装 |
| 横断検索の土台 | `searchable_capture_set.py` | 12カラム契約層のみ。JOIN本体は「CALLER側の後続波」とdocstringが明言=未実装 |
| 3D/グラフ描画ライブラリ | 3d-force-graph / three.js | `package-lock.json` grep 0件(未導入)。caseB7は`caseB5/lib`を相対参照 |
| 検索グラフビューのフロント | V3-UIX-82 描画 | `apps/web/src`に`graph`/`force-graph`/`three` grep 0件(呼び出し画面なし)。バックエンド(ego-graph)のみ`in_progress`(`docs/planning/c8/progress.md:397`) |

### 2.3 単一形質sort の縮退設計(embedding不要でMVPを成立させる)
- 「理想個体を形質で並べる」の**最小充足は今日の既存APIで成立**する: `latest_length_mm`/`latest_weight_g`/`capture_count`/`last_capture_at` の決定論sort + `species`/`stage`/`status`/`lineage_id` の完全一致フィルタ(すべて`listIndividualsFor`に実装済み)。これを MVP とする。
- 胸角mm・色系統は**測定スキーマ拡張が前提**: 胸角=新規measurementカラム(OBS系)、色系統=OBS-14色特徴の入力結線(OBS-46/47)。これらは後続波。MVPでは「体長/体重ソート」で理想個体探しの骨格を先に成立させる。

## 3. 不変条項適合

- **①10年ランニングコスト最小(常駐DBをSSOTにしない・都度再計算)**: `listIndividualsFor`/`projectEntityGraph`は既にTruth全件scan→都度cosine計算方式(常駐index/FAISSなし)。ファインダーもこの方式を継続する。規模上限=V3-FND-03「1000〜1万件はsubset cosineで済ませFAISS不要」。全体宇宙(2.2)の次元圧縮を実装する場合はこの上限で**計算コスト未検証**につき要計測。
- **embedding既定OFF時の縮退が成立する設計**: 一覧・絞り込み面(1.1)はembedding不要で成立(2.3)。宇宙面(1.2)はembedding OFF時「類似=空間距離」は出せない(誇張ゼロ)。決定論で出せるのは (a)血統ツリー配置(`buildPedigree`=実装済み) (b)スカラー形質軸の散布(体長×体重)。学習類似による星空はembedding ON(将来波)が前提。ego-graph(V3-UIX-82)は中心個体の周辺のみ都度再計算で出せる。
- **③Truth append-only**: ファインダーはread投影のみ。Truthへの書き込みなし。
- **⑤検証されないものは納品されない**: caseB7はPlaywright静止画+GIF+批評ゲートPASS+Fable目視で「見て確認」済。ver3実装も同じ検証(機械GATE緑+批評家+目視)を課す。

## 4. UI再設計正本(ui-redesign-round2.md)との整合

- **配置**: §3画面マップの `IND[個体 一覧/詳細/血統]` 領域内の**探索モード**として置く(一覧のリスト表示 ⇔ ファインダー/宇宙表示 の切替タブ)。独立した最上位ナビ項目にするのは §0「1目的1画面」原則に照らし過剰。
- **obs-searchの後継にしない**: `obs-search`は §6.0-A で`obs-register`へ縮退中(観測登録の対象選び専用)。ファインダーは「個体を探す・眺める」用途で方向が逆行。再利用するのは`search-navigator`ノードのロジック(`GET /individuals`+フィルタ)。
- **語彙辞書(§1)遵守**: 内部語(embedding/cosine/6次元ベクトル生値)を画面に出さない。caseB7は種族/胸角mm/色で表現し概ね準拠するが、universe詳細パネルの「6次元観測ベクトルの生値表示」は語彙違反 → ver3では非表示、または「形質プロファイル」等のユーザー語へ言い換える。
- **正本反映が前提条件**: ui-redesign-round2.md 自体がファインダー/宇宙を未記載。同ファイル冒頭「以後の全UI変更はこの正本との整合が納品条件」より、ファインダーを**画面マップ+語彙辞書へ追記すること**が実装の前提。
- **レンダラ統合**: `apps/web/src/renderer/renderer.tsx` の専用ノード路線の8番目として乗せる。先例=`search-navigator`(`:3828`、個体一覧+ファセット+バスケットを1ノードで完結)と同型(専用ノード1個・API複数叩いてクライアントで組み立て)。3D宇宙は個別ライブラリ導入局面(`oss-stack-audit.md:37`「明確な個別ニーズが出た画面でのみ検証導入」に該当)。

## 5. 実装波の位置づけと前提条件(順序)

0. **前提ゲート**: (a) ui-redesign-round2 判定GO + ファインダーを正本(画面マップ/語彙)へ追記 (b) T-42 を ihl-ver3 の `registry.json` へ正式要件として採番(現状はHQ台帳止まりで ihl-ver3 内に "T-42"/"caseB7" grep 0件)。
1. **MVP(一覧・絞り込み面)**: 既存API+決定論sort(2.3)のみ・embedding不要。専用ノード1個。
2. **ego-graph宇宙**: V3-UIX-82 のフロント実装(現状0件)。専用ノード+3d-force-graph の vendor/npm 化。中心個体の周辺(血縁+類似topK)を表示。
3. **全体宇宙**: 全個体の次元圧縮/座標投影の新規実装(現状0件)+ V3-FND-03 上限での規模計測。T-42 の「銀河系全体」体験はここ。
4. **単一形質sort拡充(T-42⑤必須)**: 胸角measurementカラム+色特徴結線(OBS-14/OBS-46/47)。
5. **embedding ON波**: DINOv2実装+アップロード配線 → 「類似=空間距離」の星空が意味を持つ。

> V3-UIX-82(検索グラフビュー=ego-graph)と T-42(全体宇宙+単一形質sort)は**スケールの異なる別要件**。V3-UIX-82 は波2で満たせるが、T-42 の全体俯瞰は波3-4の前提を要する。両者を混同して「宇宙ができている」と主張しない。

## 6. モックからの移植注意

- **ライブラリ依存の一本化**: `universe-focus.html`は`../caseB5/lib/3d-force-graph.min.js`を相対参照するため caseB7 単体を切り出すと壊れる。ver3 では 3d-force-graph を正式な vendor/npm 依存へ格上げする。
- **2ファイルのデータ共通化**: モックは finder と universe が同一乱数シードのアルゴリズムを二重実装して個体IDの1対1一致を担保する(脆い連携)。ver3 では共通データソース(`GET /individuals`)へ置換し、IDは Truth の個体IDで自然一致させる。
- **サンプル注記の扱い**: モックは画面上に「サンプル/実測データ未接続」を明示しており V3-UIX-01(未実装/WIP表記禁止)に抵触しない(モックをモックとして正しく告知)。ver3 実装で実データに結線するまでの間、同様の正直な注記を維持する。
