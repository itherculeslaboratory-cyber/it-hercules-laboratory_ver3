---
source: "docs/planning/ver3/b2/research-wiki-integration-v1.md@4a56cf6"
id: research-wiki-integration-v1
title: wiki 統合基盤の技術選定 — 埋め込みバックエンド / 小wiki→大wiki 自動統合 / 月次Lint / 境界規約
date: 2026-07-10
status: draft
decision: 実用埋め込みは cl-nagoya/ruri-v3-70m(384次元・Apache-2.0・ONNX変換あり・端末ローカル実行・API費ゼロ)を採用し、小wiki→大wiki 統合は既存 ingest CLI の決定論拡張(sources/ タグ集計→閾値超過で DISTILL pending→Sonnet 1回で topics/ 昇格→index.md 更新)+月次Lint は lychee + 既存 Python の軽量チェックで実装する。新規 RAG 基盤・ベクトルDB は導入しない(B6 維持)。
sources_count: 11
revalidate_before_impl: true
---

# wiki 統合基盤の技術選定レポート

調査日: 2026-07-10 / 担当: ver3 Phase B2 deep-research / 読者: 将来の AI と開発者

前提(repo 調査済み事実): 既存サブブレインは `docs/knowledge/`(OKF 準拠 markdown+frontmatter、`index.md` 1行カタログ、`topics/` 5件、`sources/` 空)。検索の主役は決定論梯子(`tools/knowledge_search.py`: キーワード抽出→index.md スコアリング→最良1ファイル→該当節→モデル1回、読解量 1/6.8 自己証明済み)。第2段の semantic 検索は dummy embedding(384次元)のみで実用バックエンド未選定。ingest は `tools/knowledge_ingest.py`(決定論・イベントリプレイ・冪等・DISTILL 2段分離)。制約 B6: **新規 RAG 基盤を作らない**。

---

## 1. 結論(選定)

### 1-1. 実用テキスト埋め込みバックエンド: **cl-nagoya/ruri-v3-70m**(384次元・ローカル ONNX・API費ゼロ)

- **モデル**: `cl-nagoya/ruri-v3-70m`(名古屋大 cl-nagoya、ModernBERT-Ja ベース、70M パラメータ、**埋め込み次元 384**、最大系列長 8192、Apache-2.0)。JMTEB 平均 **75.48**(Retrieval 79.96)で、同次元の multilingual-e5-small(JMTEB 69.52 / Retrieval 67.27)を日本語検索で大きく上回る。
- **次元 384 は埋め込み次元 ADR(384 優勢)と完全整合**。`knowledge_search.py` の dummy(384)を差し替えるだけで `.vector-index/` の形式を変えずに済む。
- **実行場所: 端末ローカル(ONNX Runtime)**。コミュニティ ONNX 変換(sirasagi62/ruri-v3-70m-ONNX、量子化含む4サイズ揃い)が存在し、Python 非依存ランタイム(Node/Rust/ブラウザ)でも動く。トークナイザは SentencePiece のみで fugashi 等の形態素依存なし — Windows 端末での導入障壁が低い。
- **コスト: 推論 API 費ゼロ**(70M はノート PC の CPU で数十ms/文オーダー)。R2 派生層(V3-WIK-19: raw float32 の embeddings.bin + manifest.json)にそのまま書ける。ベクトルDB は引き続き持たない。
- **位置づけ**: あくまで決定論梯子の**第2段(補助)**。梯子第1段(index.md スコアリング)が主役である構図は変えない。
- フォールバック: ruri の ONNX 変換が公式でない点が受容できない場合は `intfloat/multilingual-e5-small`(384次元・MIT・fastembed 公式サポート)に降格可能。インデックスの次元・正規化契約(L2 正規化・NaN 禁止、V3-OBS-09 Protocol)は共通なので差し替えは backend 名の切替のみ。

### 1-2. 小wiki→大wiki 自動統合フロー: **ingest CLI の決定論拡張のみ**(新規基盤ゼロ)

karpathy「LLM Wiki」パターン(raw は不変・wiki は LLM が維持・index.md + log.md + 定期 lint)は、既存 `docs/knowledge/` の構造(sources/=raw、topics/=wiki、index.md 1行カタログ、「保存とインデックスは不可分」)と**ほぼ同型**であることを web 調査で確認した。よって導入するのは「構造」ではなく「**昇格(promotion)の運用**」だけである:

1. **蓄積**: 論文/掲示板単位の小wiki を `sources/` に OKF 準拠で ingest(既存 CLI、出典必須 # Citations)。
2. **クラスタリングの代わりにタグ集計(決定論)**: frontmatter の tags/keywords を ingest 時に集計し、`同一タグの sources が閾値 N 件(初期値 3)を超えたら` DISTILL pending スタブを自動生成。埋め込みクラスタリング(RAPTOR 型 GMM 等)は**採用しない** — 決定論梯子の思想と B6 に反し、タグ集計で同じ入力が得られるため。
3. **昇格**: pending スタブ→Sonnet 1回で `topics/` に大wiki 記事を蒸留(既存 DISTILL 2段分離をそのまま流用)。蒸留記事は RAPTOR の知見(下位チャンクの再帰要約が multi-hop 質問で有効)に従い、**sources/ への相対リンクを必ず残す**(要約ツリーの葉を捨てない)。
4. **index 更新**: 昇格と同時に index.md 1行カタログ + log.md 追記(karpathy パターンの log 規約 `## [DATE] operation | Title` を踏襲)。
5. **人間レビュー点**: 蒸留結果の topics/ 昇格コミットは人間ゲート(diff レビュー)を必須とする。pending スタブ生成までは全自動でよい。
6. **V3-WIK-25(RAG 未一致質問→スレッド→ノード化)**は、この同じ昇格パイプラインに「未一致質問ログ」を sources/ 入力として合流させるだけで実現できる(専用機構を作らない)。

### 1-3. 月次 Lint(V3-WIK-07): **lychee + 既存 Python チェックの2本立て**

- リンク切れ: **lychee**(Rust 製・非同期・Markdown 対応・Windows バイナリ配布・CI/JSON 出力対応)を月次で `docs/knowledge/` に実行。
- 矛盾・孤立ページ・鮮度: 決定論 Python(index.md に載っていないファイル、どこからもリンクされないファイル、frontmatter date が閾値超の古い記事の列挙)を `tools/` に 1 スクリプト追加。graphify の参照グラフ可視化は任意の補助(要件どおり「してよい」)。
- 結果は log.md に追記。markdownlint 等の文体 lint は**導入しない**(OKF frontmatter 検証は ingest CLI が既にやっており重複)。

### 1-4. D:\notes(個人)と docs/knowledge(IHL)の境界: **現行維持(変更なし)**

V3-WIK-02 の規約(同一 OKF v0.1 規約・境界は「個人の作業ログ/アイデア=D:\notes、IHL ドメイン知識=docs/knowledge」)をそのまま維持する。karpathy/Chase AI 型の raw/wiki/output 3階層は docs/knowledge 内部の sources/=raw、topics/=wiki に既に対応しており、output 層は `docs/planning/` 等の成果物側が担う。**ボールト統合や双方向同期は導入しない**(civ-os ミラー禁止と同じ理由: 正本の二重化はドリフトの温床)。

---

## 2. 根拠(出典つき)

### 根拠1 — ruri-v3-70m: 384次元・JMTEB 75.48・Apache-2.0(HF 公式モデルカード)
cl-nagoya/ruri-v3-70m のモデルカードに、埋め込み次元 384・70M パラメータ・最大 8192 トークン・Apache-2.0・JMTEB 平均 75.48(Retrieval 79.96 / STS 79.82 / Clustering 52.70)が明記されている。同カードの比較表で multilingual-e5-small(118M)は JMTEB 平均 69.52・Retrieval 67.27 であり、**半分近いパラメータ数で日本語検索性能が約 +12.7pt** 上回る。ruri-v3 系は 1+3 プレフィックス方式(検索クエリ: / 検索文書: 等)を要する点は実装時の注意。
出典: https://huggingface.co/cl-nagoya/ruri-v3-70m (アクセス 2026-07-10)

### 根拠2 — ruri-v3-30m: 256次元のためADR不整合で不採用(HF 公式モデルカード)
最小の ruri-v3-30m(37M・JMTEB 74.51)は魅力的だが**埋め込み次元が 256** であり、既存 dummy インデックス・埋め込み次元 ADR(384)・V3-OBS-09 の次元統一方針と不整合。SentencePiece のみで形態素依存なし(fugashi 不要)という導入容易性は 70m にも共通する。
出典: https://huggingface.co/cl-nagoya/ruri-v3-30m (アクセス 2026-07-10)

### 根拠3 — ruri-v3 の ONNX 変換が 4 サイズ全て公開済み(70m 含む)
コミュニティ変換コレクション sirasagi62/ruri-v3-onnx に 30m/70m/130m/310m の ONNX 版が公開されており(70m 版は 2025-10-09 更新)、ONNX Runtime によって Python 非依存の端末ローカル推論が可能。別系統として Japan-AI-Consulting/ruri-v3-310m-onnx も存在する。**公式(cl-nagoya)提供の ONNX ではない**点はリスク欄に記載。
出典: https://huggingface.co/collections/sirasagi62/ruri-v3-onnx / https://huggingface.co/sirasagi62/ruri-v3-70m-ONNX (アクセス 2026-07-10)

### 根拠4 — JMTEB は日本語埋め込みの標準ベンチ(sbintuitions 公式)
JMTEB(Japanese Massive Text Embedding Benchmark)は SB Intuitions が公開する日本語版 MTEB で、Retrieval/STS/Classification/Reranking/Clustering/PairClassification の 6 カテゴリで評価する。本選定の性能比較はすべて JMTEB スコアに基づく。
出典: https://github.com/sbintuitions/JMTEB (アクセス 2026-07-10)

### 根拠5 — multilingual-e5-small(フォールバック): 多言語 E5 テクニカルレポート + fastembed 公式サポート
multilingual-e5 系は弱教師 2 段階学習の多言語埋め込みで、small は 384 次元・118M・MIT。ONNX ローカル推論ライブラリ fastembed(qdrant 公式、ONNX Runtime ベース、完全ローカル動作)が multilingual-e5 系をサポートしており、導入の枯れ度・運用実績では ruri より上。ただし日本語 Retrieval が JMTEB で 67.27 と弱い(根拠1)ため第一候補にしない。
出典: https://arxiv.org/abs/2402.05672 / https://github.com/qdrant/fastembed (アクセス 2026-07-10)

### 根拠6 — karpathy「LLM Wiki」原典(2026-04 の idea file)と既存 docs/knowledge の同型性
karpathy の idea file(gist)は raw/(不変ソース・LLM は読むだけ)/ wiki/(summaries・concepts・entities・index.md 1行カタログ・log.md 追記専用)/ スキーマ(CLAUDE.md/AGENTS.md)の3層と、ingest・query・**lint** の3操作を定義する。「中規模までは埋め込み基盤なしで index + BM25 で足りる」「lint pass is not optional」と明言しており、決定論梯子主役・埋め込みは補助という本 repo の設計を外部から裏付ける。2026-04-03 の元ツイートは 2,100万 view 超で、Obsidian を IDE としエージェントが保守する運用が発展形として定着している。
出典: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f (アクセス 2026-07-10)

### 根拠7 — RAPTOR(ICLR 2024): 階層的要約ツリーの学術的裏付けと「借りる範囲」
RAPTOR(Stanford)はチャンクを再帰的に埋め込み→クラスタリング→要約してツリーを構築し、抽象度の異なる層から検索する手法。multi-hop QA で SOTA(QuALITY +20%)を示した。**小wiki→大wiki の「下位文書の要約を上位に積む」発想には学術的裏付けがある**。ただし RAPTOR 本体は埋め込みクラスタリング+専用検索器を要する RAG 基盤であり B6(新規 RAG 基盤禁止)に抵触するため、借りるのは「①要約ツリーは葉(sources/)へのリンクを保持する ②上位層(topics/)は下位の再帰要約として構築する」という**構造原理のみ**。クラスタリングは決定論タグ集計で代替する。
出典: https://arxiv.org/abs/2401.18059 / https://github.com/parthsarthi03/raptor (アクセス 2026-07-10)

### 根拠8 — lychee: 月次 Lint のリンク切れ検査に十分な軽量 CLI
lychee は Rust 製の非同期リンクチェッカで、Markdown/HTML 内の URL・相対リンクを並列検査し、Windows バイナリ配布・JSON 出力・GitHub Action(lychee-action)を備える。576 リンクの検査が約 1 分という実績があり、docs/knowledge 規模(現状 topics/ 5件+sources/)では月次実行のコストは無視できる。
出典: https://github.com/lycheeverse/lychee (アクセス 2026-07-10)

### 根拠9 — Chase AI / Obsidian raw-wiki-output 3階層との互換(境界規約の維持判断)
Chase AI(chaseai.io)の Agentic OS は Obsidian ボールトに karpathy 由来の raw(初期キャプチャ)/wiki(整形済み参照)/output(完成物)を置き、ディレクトリ別 CLAUDE.md で運用規約を注入する(公開 repo なし・パターン抽出のみ — 本件は b2/research-external-knowledge-v1.md 根拠4 で検証済み)。この 3 階層は docs/knowledge の sources/(raw)+ topics/(wiki)、docs/planning(output)に既に対応しており、**新たなボールト構造の導入は不要**という判断の裏付けになる。karpathy パターンの Obsidian 実装例(obsidian-wiki 等)も raw/wiki 分離+index/log を核とし、それ以上の機構を足していない。
出典: https://www.chaseai.io/blog/build-claude-code-agentic-os-3-steps / https://github.com/ar9av/obsidian-wiki (アクセス 2026-07-10)

### 根拠10 — BGE-M3: 高性能だが 1024 次元で ADR 不整合(却下根拠)
BAAI/bge-m3 は 100+ 言語・8192 トークン・dense/sparse/multi-vector の 3 方式対応・MIT と多機能だが、**dense 埋め込みは 1024 次元**で 384 ADR と不整合、モデルも 568M クラスと端末常用には重い。multi-vector(ColBERT 型)はベクトルDB 前提になりやすく「R2 だけが Truth」思想と相性が悪い。
出典: https://huggingface.co/BAAI/bge-m3 (アクセス 2026-07-10)

---

## 3. 代替案と却下理由

| 代替案 | 却下理由 |
|---|---|
| multilingual-e5-small(384・MIT・fastembed 公式) | 日本語 Retrieval が JMTEB 67.27 と ruri-v3-70m(79.96)に大差。wiki は日本語正本のため主候補にしない。**フォールバック第1位として保持**(根拠5) |
| ruri-v3-30m(256次元) | 次元 256 が埋め込み次元 ADR(384)と不整合。性能/サイズ比は最良だが ADR 改定コストが上回る(根拠2) |
| BGE-M3(1024次元) | 次元不整合+568M で重い+multi-vector はベクトルDB 前提思想(根拠10) |
| ruri-v3-130m/310m(JMTEB 76.55/77.24) | 性能は上だが端末常用の重さと引き換えに得るものが小さい(第2段は補助であり主役は決定論梯子)。次元も 512/768 系で要確認 → 70m で不足が実測されたときのみ再検討 |
| OpenAI / Cohere 等の埋め込み API | 10年コスト最小・決定論優先(不変条項①)に反する従量課金+ネットワーク依存。ローカル 70M で十分な規模 |
| RAPTOR そのままの導入(埋め込みクラスタリング+ツリー検索器) | B6(新規 RAG 基盤禁止)に正面から抵触。構造原理のみ借用(根拠7) |
| markdownlint / textlint 常設 | OKF frontmatter 検証は ingest CLI と重複。月次 Lint の目的(矛盾・孤立・鮮度・リンク切れ)に文体 lint は寄与しない |
| D:\notes と docs/knowledge のボールト統合 | 正本の二重化はドリフトの温床(civ-os ミラー禁止と同根)。V3-WIK-02 の境界規約を維持 |

---

## 4. ver3 要件との接続

| 要件/条項 | 本選定での扱い |
|---|---|
| V3-WIK-02(OKF v0.1・D:\notes 境界) | 現行維持。raw/wiki/output は既存構造への読み替えで充足(結論1-4) |
| V3-WIK-07(月次Lint→log.md 記録) | lychee(リンク切れ)+ 決定論 Python(孤立・鮮度・index 不整合)+ log.md 追記。graphify は任意補助(結論1-3) |
| V3-WIK-19(embedding は R2 派生層 raw float32・payload 系のみ) | ruri-v3-70m の 384 次元 float32 をそのまま embeddings.bin + manifest.json へ。embedding 対象は title/description/body 等 payload 系のみという 3 分離(意味/構造/美学)を維持 |
| V3-WIK-25(RAG 未一致質問→スレッド→ノード化) | 未一致質問ログを sources/ 入力として昇格パイプラインに合流(専用機構なし)(結論1-2 手順6) |
| V3-WIK-35(初心者向け大wiki) | topics/ 昇格の蒸留プロンプトに「初心者向け層」を指定するだけで同一パイプラインで生成可能 |
| V3-OBS-09 / DIFF-C-18(次元統一 ADR・EmbeddingBackend Protocol) | 384 選定は ADR(384 優勢)と整合。L2 正規化必須・NaN 禁止の Protocol に ruri backend を実装として追加 |
| B6(新規 RAG 基盤禁止) | 本選定の全項目が docs/knowledge + OKF + ingest CLI の拡張のみ。ベクトルDB・検索サーバ・別ボールトは一切導入しない |
| 不変条項①(10年コスト最小・決定論優先・モデル最小化) | 埋め込みはローカル無料・クラスタリングは決定論タグ集計・LLM 呼び出しは蒸留の Sonnet 1回のみ(既存 DISTILL と同回数) |
| ユーザー発言「階層構造にできないか・精度をよくして安く」(2026-07-09) | 階層=sources/→topics/ の既存 2 層+昇格運用。精度=ruri-v3-70m(日本語 Retrieval +12.7pt)。安く=API 費ゼロのローカル ONNX |

---

## 5. リスクと再検証条項

1. **ruri ONNX が非公式変換**(sirasagi62)。実装着手時に (a) 変換モデルと PyTorch 版の出力コサイン一致を手元で検証、(b) 不一致・保守停止なら sentence-transformers(PyTorch)直載せ or multilingual-e5-small + fastembed へフォールバック。`revalidate_before_impl: true`。
2. **ruri-v3 のプレフィックス規約**(検索クエリ: / 検索文書:)を EmbeddingBackend 実装で吸収し忘れると精度が落ちる。Protocol 実装時のテスト項目に含める。
3. **JMTEB スコアはモデルカード自己申告**。着手時に JMTEB リーダーボード(sbintuitions/JMTEB)最新値で ruri-v3 系の優位が維持されているか再確認(2026-07-10 以降の新モデル含む)。
4. **タグ集計クラスタリングの粒度**はタグ付けの質に依存する。sources が 20 件を超えた時点で「昇格漏れ/過剰昇格」を月次 Lint に計測項目として追加し、閾値 N を再調整する。
5. **lychee の外部 URL 検査**はレート制限・一時故障で偽陽性が出る。月次 Lint では相対リンク(バンドル内)を fail、外部 URL は warn 扱いにする。
6. **karpathy パターンは 2026-04 発の流行**であり長期運用の実証は薄い。ただし本 repo は構造を既に持っており「借りるのは lint と昇格運用のみ」なので、パターンが廃れても資産は残る。
7. 埋め込み実用化そのものが**人間ゲート後の別判断**である前提は変わらない。本レポートは「ゲートが開いたときの選定」を先回りしたものであり、ゲート前に第2段を有効化しない。

---

## 6. 未解決の問い

1. 撮影チャンバー側 768 次元(DIFF-C-18)との統一 ADR が未確定。テキスト 384(ruri)と画像 768(dinov2)を**別空間として併存**させるのか、次元を揃えるのかは ADR 側の裁定待ち — 本選定はテキスト側 384 の前提のみ。
2. topics/ 昇格の閾値 N=3 は仮置き。実データ(sources/ が現状 0 件)での妥当性は運用開始後にしか測れない。
3. ruri-v3-70m の Windows CPU での実測スループット(バッチ埋め込みの所要時間)は未計測。月次一括再イン デックスが現実的か、着手時にベンチが要る。
4. V3-WIK-35(初心者向け層)の蒸留プロンプト設計(用語の読み・買う場所などの実務情報をどの sources から採るか)は本レポートの範囲外。
5. D:\notes 側にも同じ埋め込みインデックスを張るか(個人ノート横断検索)は境界規約上は可能だが、要望として未登録。
