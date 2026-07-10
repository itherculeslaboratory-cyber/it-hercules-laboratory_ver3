---
id: RES-PLAZA-PAPERS-2026-07-10
title: 知の広場・論文生成・不足検出/重複防止の設計調査（掲示板より良い形はあるか）
date: "2026-07-10"
status: active
---

# 知の広場・論文生成・不足検出 設計調査

> 対象要件: V3-BBS-01（知の広場=3柱ハブ）/ V3-PPR-01（論文照合）/ V3-BBS-09（固定ユーザーネーム）/ V3-GOV-14（段階的ペナルティ）。
> ユーザーの真の目的:「意見交換や化学反応」+「一番論文が作りやすい、研究者にとって天国のような場」。
> 全出典は 2026-07-10 にアクセス。実在 URL のみ。誇張ゼロ・未実装を「動く」と書かない。

参照する ver3 内部制約(既存正本):
- 検索梯子(決定論優先): `docs/knowledge/topics/observation-pipeline.md` §検索梯子 = ①whitelist(`ALLOWED_FILTERS`)絞り込み → ②subset cosine → ③rerank top-K。
- 埋め込み: 画像 DINOv2 ViT-S/14 **384**、テキスト **ruri-v3-70m 384**(`docs/architecture.md`・`ADR-V3-EMB-01`・`research-wiki-integration.md`)。LLM/FAISS 既定 OFF。
- 5 不変条項: 常駐 DB を SSOT にしない/派生値は都度再計算(projection)/Truth は append-only(R2 は INSERT ONLY)/人間ゲート/検証されないものは納品しない。

---

## Q1 — 掲示板より良い形はあるか

### ① 調査結果(出典 URL 付き)

- **Zulip(トピック中心スレッド)**: すべてのメッセージが channel+topic に属し、topic を第一級市民として UI 全体を設計。1 チャンネル内で 10 の会話が干渉せず並走し、非同期でも文脈が保たれ、履歴がそのまま知識ベースになる。フラット BBS の「文脈崩壊(context collapse)」への直接的回答。出典: https://zulip.com/why-zulip/ / https://zulip.com/help/introduction-to-topics
- **Polis(意見クラスタリング)**: 参加者が短い statement を投稿し他者の statement に Agree/Disagree/Pass。投票行列に PCA + K-means を適用して意見空間 2 次元と意見グループを学習し、**全クラスタが賛成する consensus statement** と**グループを分ける divisive statement** を surface。これが「化学反応」を可視化する具体機構(合意点と対立点の自動抽出)。出典: https://compdemocracy.org/polis/ / https://www.envisioning.com/research/polis/opinion-clustering-algorithms
- **Discourse(信頼レベル)**: TL0→TL3 の自動昇格で新規ユーザーを sandbox しつつ経験者に権限を委譲、モデレーションを自動化。V3-GOV-14(段階的ペナルティ・信用の自然減衰)と設計思想が一致。出典: https://blog.discourse.org/2018/06/understanding-discourse-trust-levels/
- **GitHub Discussions**: カテゴリごとに format(open-ended / Q&A / announcement)を選べる。V3-BBS-01 の「GitHub 掲示板」柱と親和。出典: https://docs.github.com/en/discussions/collaborating-with-your-community-using-discussions/about-discussions
- **Hypothesis(社会的アノテーション)**: 論文・Web ページの特定箇所の余白に注釈を付け、脱文脈な掲示板と違い**対象テキストに紐付いた**議論を生む。オープン査読・研究にも使用。出典: https://academictech.uchicago.edu/2022/02/25/social-annotation-beyond-the-classroom/
- **OpenReview**: top-level note(投稿)に replyto でスレッドが連鎖する forum モデル。査読後も継続議論できる。出典: https://openreview.net/about
- **デジタルガーデン(Quartz / Obsidian Publish)**: 時系列ブログではなく、双方向リンクと graph view で「よく繋がったノート=成熟」「孤立ノート=未発達の種」を可視化。継続的な書き換え文化。出典: https://notes.hamatti.org/technology/building-a-digital-garden-with-obsidian-and-quartz

### ② ver3 制約との適合分析

- **フラット BBS の弱点は文脈崩壊**。V3-BBS-01 は既に「画面ごと/機能ごと」に投稿先を分けており、これは Zulip の channel に相当する。足りないのは channel 内を束ねる **topic 層**(第一級のスレッド)。
- **Polis は projection 機構そのもの**: 投票(Agree/Disagree/Pass)は append-only イベント、クラスタと consensus は**都度再計算する派生値** → 不変条項①(常駐 DB を SSOT にしない・派生値は再計算)と完全一致。PCA+K-means は決定的(seed 固定)で LLM 不要。
- Discourse 信頼レベルはカルマ経済 + V3-GOV-14 と一致。公開処刑せず信用減衰で自浄する方針に、TL の自動昇降格が対応。
- Hypothesis 型アノテーションは「論文柱」との橋渡し(論文の一節に対する異論=次の観測課題)を生むが、実装コストは topic 層より高い。段階導入向き。
- デジタルガーデンの graph view は魅力的だが、常駐グラフ DB は不変条項①に反する。graph は projection として都度生成すべき(骨格に足さない)。

### ③ 具体的推奨案(要件文粒度)

- **推奨(骨格 + 2 機構)**: BBS 骨格(V3-BBS-01 の 3 柱)は維持し、次を足す。掲示板を丸ごと置換しない。
  - **[要件案 V3-BBS-1x] topic 第一級化**: 各柱の投稿は `channel(=画面/機能) + topic(必須スレッド見出し)` の 2 層に属す。ハブは Zulip 型に「未読 topic」を並べ、フラットな時系列一覧を主動線にしない。topic は append-only イベント、topic 一覧・未読数は projection として都度再計算。
  - **[要件案 V3-BBS-2x] 合意/対立の projection(Polis 型)**: 論点 topic では投稿への Agree/Disagree/Pass を append-only R2 イベントとして記録し、**consensus statement と divisive statement を PCA+K-means(seed 固定・決定的・LLM 非依存)で都度算出**して表示する。これが「意見交換と化学反応」の可視化機構。クラスタ結果は SSOT 化しない。
  - 信頼レベルは V3-GOV-14 のカルマ減衰に写像(新規は sandbox、経験者に権限委譲)。Hypothesis 型アノテーションは Phase 後半のエスケープハッチとして記載のみ(今は実装しない)。

---

## Q2 — 最高の論文とは何か + 一般ユーザーが作れるか

### ① 調査結果(出典 URL 付き)

- **IMRaD 構造**: Introduction/Methods/Results/Discussion。20 世紀後半に医学系で標準化した「科学論文の骨格」。Sollaci & Pereira (2004, JMLA) の 50 年調査が基礎文献。出典: https://pubmed.ncbi.nlm.nih.gov/15243643/
- **Registered Reports(登録報告)**: 2 段階査読。Stage 1 で**結果を出す前に**研究設問と方法を査読し in-principle acceptance、Stage 2 で protocol 準拠と結論の妥当性を確認。null 結果でも棄却できず、publication bias を減らす。「良い論文=事前に設問と方法が妥当」という価値観を制度化。出典: https://www.cos.io/impact/2022/registered-reports / https://authorservices.taylorandfrancis.com/publishing-your-research/peer-review/registered-reports/
- **Data paper / Data Descriptor(データ論文)**: データセットを記述・検証する軽量ジャンル。データ収集法と品質検証を強調し、**投稿時にテンプレートで記述を作成**、1 論文 1 データセット、データは公開デポジット必須。非研究者でも到達しやすい「論文グレード成果物」の現実的な最初の一歩。出典: https://www.nature.com/sdata/aims-and-scope / https://info.hsls.pitt.edu/updatereport/2014/july-2014/scientific-data-a-new-journal-for-formal-descriptions-of-datasets/
- **anthropics/skills(専門手法をどう構造化するか)**: `github.com/anthropics/skills` の `skills/` に doc-coauthoring, skill-creator, docx, pdf, pptx 等。
  - **doc-coauthoring**: 3 段階(①Context Gathering ②Refinement & Structure ③Reader Testing)。機構=各節 5-10 の clarifying questions、5-20 案の brainstorm→ユーザーが curate、placeholder を使う節単位ドラフト、"Reader Claude" による盲点検査。出典: https://raw.githubusercontent.com/anthropics/skills/main/skills/doc-coauthoring/SKILL.md
  - **skill-creator**: 専門手法を「frontmatter(description=起動条件)+ SKILL.md 本体 + references/scripts/assets」に符号化し、**progressive disclosure**(メタデータ→本体→リソースの 3 層ロード)で認知負荷を抑える。「専門知を穴埋め構造として符号化する」モデルそのもの。出典: https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md

### ② ver3 制約との適合分析

- ユーザー仮説「テンプレート化と穴埋め(観測データ自動リンク)」は、**Data Descriptor の投稿テンプレート + doc-coauthoring の節単位穴埋め**という 2 つの実在手法の合成であり、妥当。ただし「テンプレを埋める=良い論文」ではない。Registered Reports が示すとおり、価値は**設問と方法の事前妥当性**と**主張-証拠のリンク**にある。単なる穴埋めは形式は満たすが主張の質を保証しない。
- ver3 は V3-PPR-01 で既に「論文が要求する条件 P(JSON)× 観測 JSON をフィールド単位で突合し、充足/不足/違反/一致率」を持つ。これは Registered Reports の「Stage 1 で方法の妥当性を先に確認」の機械版に写像でき、Data paper の「品質検証」節を自動生成できる。
- doc-coauthoring の clarifying questions と Reader Test は LLM 前提だが、ver3 は LLM 既定 OFF。質問群は**静的テンプレートの穴(必須フィールド)として決定的に符号化**し、LLM は任意トグルの助言 1 行に留める(V3-PPR-01 の既存方針と一致)。

### ③ 具体的推奨案(要件文粒度)

- **[要件案 V3-PPR-2x] データ論文テンプレート(観測イベント自動充填)**: 非研究者向けの第一ジャンルを Data Descriptor 型に定める。テンプレートの構造化フィールド(対象種・条件・N・観測法・期間・データ locator)を**観測イベント(append-only)から projection で自動充填**し、ユーザーは主張(claim)1 行と考察の穴だけを埋める。生成物は機械可読正本 + frontmatter。
- **[要件案 V3-PPR-3x] 主張-証拠リンクの必須化(Registered Reports 型 Stage 1 の機械化)**: 各 claim に対し V3-PPR-01 の条件 P × 観測 JSON 突合を走らせ、**充足キーが claim を支持する証拠として自動リンク**、不足/違反キーは「未検証」として明示表示(不変条項:未実装を動くと書かない=未検証 claim を検証済みと書かせない)。一致率が閾値未満の claim は「仮説」ラベル固定。
- **[要件案] progressive disclosure な穴埋め UI**: doc-coauthoring の 3 段階を静的化 — ①観測 context を自動収集 ②節単位で必須穴を提示(5-10 の決定的プロンプト)③投稿前に「不足キー一覧」を Reader Test 代わりに提示。LLM 助言はギャップ節に静的ヒント 1 行 + 任意トグルのみ(V3-PPR-01 既存契約踏襲)。

---

## Q3 — 足りていないもの検出 + 重複防止

### ① 調査結果(出典 URL 付き)

- **Stack Overflow 重複サジェスト**: 質問作成時に as-you-type で類似/重複質問を提示。tag の共有度で関連質問を surface する**語彙(tag)ベース**の proactive 提案 + コミュニティによる reactive な duplicate クローズの二段構え。出典: https://stackoverflow.blog/2009/04/29/handling-duplicate-questions/ / https://stackoverflow.blog/2009/05/20/linking-duplicate-questions/
- **BEIR ベンチマーク(BM25 は強いベースライン)**: 18 データセットの zero-shot 評価で **BM25(語彙的)がドメイン適応なしの密ベクトルを多くの場合上回る**。密ベクトルは効率的だが汎化に難あり、in-domain 性能は汎化性能と相関しない。→ ドメイン特化学習なしの環境では語彙検索を先に置くのが妥当。出典: https://arxiv.org/abs/2104.08663
- **Semantic Scholar / SPECTER**: 論文の title+abstract を引用関係で学習した文書埋め込みで related papers を推薦(Recommendations API は seed list から ML 推薦)。埋め込みは「テキスト系」と「引用グラフ系」で得意が分かれる。出典: https://github.com/allenai/specter / https://www.semanticscholar.org/product/api
- **Evidence Gap Map(3ie, 不足検出)**: 行=介入・列=アウトカムの**マトリクス**。交点のバブルが研究の有無/量/質を示し、**空セル=研究ギャップ**を一目で特定。「まだ誰も書いていない論文」を faceted coverage matrix で機械検出する確立手法。出典: https://www.3ieimpact.org/evidence-hub/evidence-gap-maps / https://pmc.ncbi.nlm.nih.gov/articles/PMC8428058/

### ② ver3 制約との適合分析

- ver3 の検索梯子(①whitelist → ②subset cosine → ③rerank)は、まさに **BM25 の教訓(語彙/構造フィルタを先、埋め込みを後)を既に体現**。重複サジェスト・関連提案はこの既存梯子にそのまま乗る。新規 RAG 基盤・ベクトル DB は不要(不変条項①・B6 維持)。
- **不足検出は Evidence Gap Map = projection**: 行を「観測条件(whitelist facet: 種 × 環境条件 × …)」、列を「アウトカム/論点」に取り、観測イベントと論文/topic を都度集計して**空セル**を出す。マトリクスは常駐せず append-only イベントから再計算 → 不変条項①適合。384 埋め込みも LLM も不要で、facet の直積 + カウントだけ。
- **重複提案は SO 型が最適**: 新スレッド/新論文作成時に、①whitelist(同一 channel/facet/tag)で候補を絞り ②subset cosine(ruri-v3-70m 384、既存 index)で類似上位を「既に立っています → そちらへどうぞ」提示。ユーザー override 可(V3-GOV-14 の非強制思想と一致)。FAISS は既定 OFF のまま numpy subset cosine で足りる(候補は whitelist で小さい)。

### ③ 具体的推奨案(要件文粒度・決定論優先)

- **[要件案 V3-BBS-3x] 新規作成時の重複サジェスト(決定論梯子)**: スレッド/論文/topic 作成時、既存梯子で類似候補を提示する。①whitelist(同一 channel + 共有 tag/facet)で候補集合を確定 → ②subset cosine(ruri-v3-70m 384、既存テキスト index)で上位 K → ③一致率付きで「既存スレッドへどうぞ」を提示。ユーザーは override して新規作成可(強制しない)。LLM/FAISS 不使用。閾値未満なら黙って新規作成を通す。
- **[要件案 V3-BBS-4x] 不足検出マトリクス(Evidence Gap Map の projection)**: 知の広場に「まだ埋まっていない交点」ビューを置く。行=観測 facet(whitelist の直積)、列=論点/アウトカム。セル値は観測イベント数と論文/topic 数を append-only ソースから都度集計。**空セル(N=0 の条件、誰も書いていない論文題)を「募集中の問い」として提示**。ここが V3-PPR-01 の paper match と接続(不足キー=次に観測すべき条件)。マトリクスは SSOT 化せず projection。
- **決定論ラダーの明文化**: 全ての類似/不足機能は `whitelist → subset(BM25 相当の語彙 or facet) → embedding(384) → (任意)LLM` の順で、上位段で決着したら下位を呼ばない。BEIR の知見(語彙先行)と ver3 の既存梯子を同一契約に統一する。

---

## 残課題(人間裁定 or 後続 Phase)

- 上記 [要件案] は未採番。レジストリ登録(採番)は要件レジストリ更新プロセス(ruling-record)経由が正道 — 本調査は要件文粒度の提案までで、採番自体は保留。
- Polis 型クラスタリングの K・seed・最小投票数の閾値は実装前に決定要(可逆なので実装後チューニング可)。
- Hypothesis 型アノテーションは今回「記載のみ・実装しない」エスケープハッチ扱い。
