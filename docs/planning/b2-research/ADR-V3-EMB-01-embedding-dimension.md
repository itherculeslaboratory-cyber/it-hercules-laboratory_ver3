---
source: "docs/planning/ver3/b2/ADR-V3-EMB-01-embedding-dimension-v1.md@4a56cf6"
id: ADR-V3-EMB-01
title: 埋め込み次元 ADR — 384 vs 768(DIFF-C-18)
date: 2026-07-10
status: verified   # ADR ステータス: Proposed
decision: "画像埋め込みは 384 次元(DINOv2 ViT-S/14 系)に一本化。ColorHist/Lab は embedding に連結せず rerank 特徴として分離維持。768 はエスケープハッチとして移行手順のみ定義。"
sources_count: 13
revalidate_before_impl: true
---

# ADR-V3-EMB-01: 埋め込み次元の一本化(384 vs 768)

- **ADR status**: Proposed
- **対象差分**: DIFF-C-18(実装 384 一貫 vs 撮影チャンバー構想ノートの 768 記述)
- **調査日**: 2026-07-10(Phase B2 deep-research)

## 結論(選定)

ver3 の画像埋め込み次元は **384(DINOv2 ViT-S/14 系、L2 正規化 float32)に一本化**する。実装は既に全経路 384 で一貫しており(`libs/ihl/observation/embedding.py:83-85`)、要件 V3-OBS-09 も 384 を明記済み。768 の唯一の出所である撮影チャンバー構想ノート(`docs/knowledge/topics/shooting-chamber.md:43-46`)の `embedding = [DINOv2(768), ColorHist(96), LabFeatures]` という連結設計は**採用しない**。色情報(ColorHist/部位別 Lab)は V3-OBS-14 のとおり rerank 側特徴(現行重み: embedding 0.50 / color 0.20 / size 0.20 / lineage 0.10)として分離維持する。768 への移行はエスケープハッチとして条件と手順のみ本 ADR に定義し、実装しない。

## Context(ADR)

- 実装: `DINOV2_MODEL_NAME="dinov2_vits14"` / `DINOV2_DIM=384`、dummy バックエンドも 384、torch hub 経由サーバ側実行(`libs/ihl/observation/embedding.py:83-85`)。
- 類似検索: numpy cosine + rerank 実装済み。次元不一致は `scoring.py:44` で `ValueError`(類似検索全断)。faiss は任意依存・未接続。
- 768 の記述は構想ノート 1 系統のみで、要件化されていない。
- 方針裁定 V3-FND-19: 重い計算はユーザー端末(WASM/WebGPU/ONNX)へオフロードし、サーバ変動費近ゼロを維持する。

## 根拠(最低5件・各出典付き)

1. **精度差は約 3pt で、本用途(数千〜数万件の個体類似検索)には 384 で十分。**
   DINOv2 公式モデルカードの ImageNet-1k 評価では、ViT-S/14 は kNN 79.0% / linear 81.1%、ViT-B/14 は kNN 82.1% / linear 84.5%。差は kNN で 3.1pt。汎用 100 万クラス級の識別ではなく「同一種昆虫個体の類似 rerank 第1段」であり、色・サイズ・系統の rerank 特徴が補完するため、この差がユーザー体験を左右する規模ではない。
   出典: https://github.com/facebookresearch/dinov2/blob/main/MODEL_CARD.md (kNN 79.0 vs 82.1 / linear 81.1 vs 84.5、ViT-S 21M params / ViT-B 86M params)、原論文 https://arxiv.org/abs/2304.07193

2. **端末オフロード(V3-FND-19)の実現可能性はモデルサイズで決まり、S と B で約4倍差。**
   Transformers.js 互換の公開 ONNX 変換済みモデル Xenova/dinov2-small の実ファイルサイズは fp32 88.5 MB / q8 24.5 MB / q4f16 12.9 MB。ViT-B(86M params)は fp32 で約 344 MB(=86M×4B)・int8 でも約 86 MB となり、ブラウザ初回ダウンロード・メモリの両面で S の約4倍。将来ブラウザ実行へ移す際、384(ViT-S)側だけが現実的なサイズに収まる。
   出典: https://huggingface.co/Xenova/dinov2-small/tree/main/onnx (実サイズ一覧)、https://huggingface.co/Xenova/dinov2-small 、https://huggingface.co/Xenova/dinov2-base (base も ONNX 化自体は存在)

3. **ブラウザ側 ONNX 実行(WebGPU/WASM)は 2026 時点で実用段階だが、小型モデル前提。**
   onnxruntime-web は WebGPU EP を公式サポートし、Microsoft 公式ブログは SAM エンコーダ級の ViT を WebGPU で WebAssembly 比 19 倍高速化した実績を示す。テキスト系要件 V3-WIK-23(MiniLM/e5-small=384 の端末実行)とも「端末で回すモデルは small 系=384」で揃い、パイプライン全体の次元規約が単一になる。
   出典: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html 、https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/

4. **保存・検索コストは次元に線形比例し、768 は恒常的に 2 倍。**
   float32 でベクトル1件あたり 384 次元=1,536 B、768 次元=3,072 B。実務報告でも、particula.tech は「384 次元ベクトルの類似度計算は 1536 次元比で約 4 倍高速」「1536→384 次元への切替でクエリレイテンシ半減・ベクトル DB コスト 75% 減(検索精度の低下は計測されず)」と報告し、milvus.io は「768 次元モデル(Sentence-T5)は 1536 次元(ada-002)比で検索レイテンシが 50ms→20ms に短縮され得る」と例示する。数万〜数十万件スケールの numpy 全走査(現行実装)では、次元 2 倍が毎クエリの CPU 時間に直結する。①コスト最小の不変条項に対し、768 は精度 3pt のために恒常 2 倍コストを払う選択になる。
   出典: https://particula.tech/blog/embedding-dimensions-rag-vector-search 、https://milvus.io/ai-quick-reference/how-does-embedding-model-choice-affect-the-size-and-speed-of-the-vector-database-component-and-what-tradeoffs-might-this-introduce-for-realtime-rag-systems

5. **numpy cosine / faiss いずれも計算量は O(n·d) で次元に線形依存(自明な計算量分析)。**
   brute-force のベクトル検索は全 n 件との内積(各 d 回の乗加算)であり、1 クエリあたりの計算量は定義から O(n×d)。これは出典を要しない自明な分析である。現行の numpy cosine(`scoring.py`)も、faiss の index なし brute-force 検索(faiss はこの利用形態を公式 wiki で案内している)も同じ計算量クラスに属し、384 化は将来 faiss(IndexFlat)接続時もそのまま半分のコストで効く。
   参考(brute-force 検索の利用形態のみ。計算量の記述は当該ページにはない): https://github.com/facebookresearch/faiss/wiki/Brute-force-search-without-an-index

6. **「次元を上げるより低次元+補助特徴/rerank で稼ぐ」は 2026 時点の主流知見と整合。**
   Matryoshka Representation Learning 原論文は「ImageNet-1K 分類で同精度のまま最大 14 倍小さい埋め込みサイズ」「大規模検索で最大 14 倍の実速度向上」を報告する。Hugging Face の Matryoshka 解説(著者実験)でも、MRL 訓練モデルは埋め込みサイズを 8.3% まで切詰めても性能の 98.37% を保持した。近年の研究(SMEC, arXiv:2510.12474)も 256 次元への圧縮でベースライン比 +1.1pt を報告しており、次元可変訓練を採用する公開モデルも登場している(Nomic embed-text-v1.5 等。HF 解説に記載)。つまり「次元増=精度増」の限界効用は小さく、本 repo が既に持つ rerank 分離設計(V3-OBS-14: 部位別 Lab + ColorHist を rerank 色成分へ供給)の方が、ドメイン固有情報(色管理された Lab 値)を確実に効かせられる。連結(768+96+…)は次元非互換(`scoring.py:44`)と再生成コストだけを増やす。
   出典: https://arxiv.org/abs/2205.13147 (MRL 原論文)、https://huggingface.co/blog/matryoshka 、https://arxiv.org/abs/2510.12474 (SMEC)

7. **repo 内整合(互換必須レイヤー CL-08)。**
   本番 R2 の既存埋め込みは 384 で書かれており(実装が全経路 384 のため)、768 へ切替えると既存件数分すべてが `scoring.py:44` の次元不一致で検索対象から脱落する。384 維持は CL-08 を最も単純に満たす選択(並行運用など互換を保つ代替案もあるが、保存二重化・系列分断のコストを伴う)。
   repo 出典: `libs/ihl/observation/embedding.py:83-85`、`libs/ihl/observation/scoring.py:44`、`docs/knowledge/topics/shooting-chamber.md:43-46`

## Decision(ADR)

1. **次元は 384 に一本化。** モデルは `dinov2_vits14`(サーバ torch hub)を正とし、将来の端末実行は同系 small(Xenova/dinov2-small 等の ONNX)で同一 384 を維持する。L2 正規化必須・NaN 禁止(V3-OBS-09 のまま)。
2. **ColorHist / 部位別 Lab は embedding に連結しない。** rerank 特徴として分離維持(V3-OBS-14)。shooting-chamber.md:46 の連結式は「未採用の構想」であることをノート側に追記する(ノート本文は append 追記のみ、既存行の書換え不要)。
3. **EmbeddingBackend Protocol / manifest**: `embedding_dim` は manifest で自己記述済みのため、**スキーマとして凍結**する(キー名・型 int・必須)。読取側は manifest の dim を信頼し、ハードコード 384 との照合を起動時 1 回だけ行う。新規フィールド追加は不要。
4. **768 エスケープハッチ**(実装しない。条件のみ):
   - 発動条件: (a) rerank 込みの top-k 精度が実データ評価で運用上不足と人間ゲート(④)が裁定、かつ (b) 端末実行要件が撤回されるかブラウザで 86M 級が実用化、かつ (c) 全件再埋め込みコストが許容内。
   - 移行手順(append-only ③ 準拠): 旧 384 ベクトルは削除・更新しない → 新モデルで全 capture を再埋め込みし**新 manifest(embedding_dim=768, model_name 明記)として別系列に append** → searchable parquet の snapshot を新系列へ切替 → 旧系列は読み取り専用で保持。scoring は manifest の dim を読むため混在系列の誤比較は `scoring.py:44` 相当の検証で遮断。

## Consequences(ADR)

- 良: ストレージ/検索 CPU が 768 比で半分(①コスト最小)。端末 ONNX 化の道が現実的サイズ(q8 24.5 MB)で残る(V3-FND-19)。CL-08 を無条件充足。V3-WIK-23(テキスト 384)と次元規約が統一。
- 負: ViT-B 比で kNN 約 3pt の素の精度を放棄。ドメイン固有精度は rerank 特徴(Lab/ColorHist/size/lineage)で補う前提になり、rerank 重みの実データ検証が必要。
- 中立: faiss 未接続は継続(数万件までは numpy で足りる。faiss 接続は件数増時の別判断)。

## 比較した代替案と却下理由(Rejected)

| 代替案 | 却下理由 |
|---|---|
| 768(ViT-B/14)へ切替 | 精度 +3pt に対し、ストレージ/検索コスト恒常 2 倍・端末 ONNX 約 344 MB(fp32)で V3-FND-19 と衝突・既存 R2 埋め込みと非互換(CL-08 違反)・全再埋め込み必要。 |
| 連結ベクトル 768+96+Lab(shooting-chamber 構想) | 異種特徴の単一 cosine 混合はスケール調整が不透明で、rerank 分離設計(V3-OBS-14・実装済み)の下位互換。次元も肥大。 |
| 384/768 の二本並行運用 | manifest 上は表現可能だが、検索系列が分断され(dim 不一致は比較不能)、保存も二重。④人間ゲートに出す価値のある利得がない。 |
| Matryoshka 的に 768 を保存し 384 に切詰めて検索 | DINOv2 は Matryoshka 訓練されておらず、単純切詰めの品質保証がない。保存コストは 768 のまま。 |
| 今すぐ faiss 接続で高速化し 768 を許容 | O(n·d) の d 半減の方が依存追加ゼロで同等以上の効果。faiss は件数問題が顕在化してからで足りる(YAGNI)。 |

## ver3 要件との接続

- **V3-OBS-09**(dinov2_vits14・384・L2 正規化・EmbeddingBackend 一本化): 本 ADR で確定。差分なし。
- **DIFF-C-18**: 本 ADR で解消(shooting-chamber.md の 768 連結式は未採用構想と裁定)。
- **CL-08**(互換必須): 384 維持により既存 R2 埋め込みと完全互換。検索全断リスクなし。
- **V3-OBS-14**(部位別 Lab + ColorHist → rerank 色成分): 分離設計を本 ADR が正式採用。
- **V3-FND-19 / V3-WIK-23**(端末オフロード・small 系 384): small 系 ONNX の実サイズで裏付け。
- 不変条項: ①コスト最小(半分のストレージ/CPU)②fork 文化(manifest 自己記述で fork 側が別次元を選べる)③append-only(エスケープハッチは全再生成+新系列 append+snapshot 切替で旧データ不変)④人間ゲート(768 発動は人間裁定必須)⑤批評家ゲート(本 ADR は Proposed であり批評家レビュー対象)。

## リスクと再検証条項

本 ADR の数値・URL は **2026-07-10 時点**の情報。実装着手時に以下を再検証する(`revalidate_before_impl: true`):

1. Xenova/dinov2-small ONNX の配布継続とファイルサイズ(HF リポジトリは削除・改版があり得る)。transformers.js の dinov2(with registers)対応状況。
2. onnxruntime-web WebGPU EP の対応ブラウザシェア(特にモバイル Safari)。端末実行を実際に採る場合は q8/q4f16 量子化での埋め込み品質(サーバ fp32 との cosine 乖離)を実測。
3. 本番 R2 の既存埋め込み**件数**(ローカル未同期で未確認)。件数が想定外に多い場合もエスケープハッチの再埋め込みコスト見積りを更新。
4. rerank 重み(0.50/0.20/0.20/0.10)の実データでの top-k 精度。384+rerank で不足が観測された時のみエスケープハッチ検討を開始。
5. DINOv2 後継(v3 等)や Matryoshka 訓練済み視覚埋め込みの登場。後継が 384 系を提供するなら乗換えの方が 768 化より優先。

## 未解決の問い

1. 本番 R2 の既存埋め込み件数と品質(dummy backend 由来ベクトルが混入していないか)— manifest の model_name で判別可能か要確認。
2. 端末実行時、サーバ fp32(torch hub)と端末 q8(ONNX)で同一画像の埋め込みが十分近い(cosine ≥ 閾値)ことをどう CI 検証するか。
3. rerank 重みの最適化を人間ゲート付きでどう回すか(評価用の正解ペアセットが未整備)。
4. manifest スキーマ凍結の適用範囲: embedding_dim のほか model_name / model_version / normalize フラグまで必須化するか。

## 出典一覧

- https://github.com/facebookresearch/dinov2/blob/main/MODEL_CARD.md
- https://arxiv.org/abs/2304.07193
- https://huggingface.co/Xenova/dinov2-small/tree/main/onnx
- https://huggingface.co/Xenova/dinov2-small
- https://huggingface.co/Xenova/dinov2-base
- https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
- https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/
- https://particula.tech/blog/embedding-dimensions-rag-vector-search
- https://milvus.io/ai-quick-reference/how-does-embedding-model-choice-affect-the-size-and-speed-of-the-vector-database-component-and-what-tradeoffs-might-this-introduce-for-realtime-rag-systems
- https://github.com/facebookresearch/faiss/wiki/Brute-force-search-without-an-index (brute-force 利用形態の参考のみ)
- https://arxiv.org/abs/2205.13147
- https://huggingface.co/blog/matryoshka
- https://arxiv.org/abs/2510.12474
- repo: `libs/ihl/observation/embedding.py:83-85` / `libs/ihl/observation/scoring.py:44` / `docs/knowledge/topics/shooting-chamber.md:43-46`
