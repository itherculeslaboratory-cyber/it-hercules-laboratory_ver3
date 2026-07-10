---
type: Topic
title: 観測パイプライン（capture→embedding→類似検索）
description: 写真取り込みから埋め込み生成・決定論的な類似検索梯子までの仕組みと重み付け
tags: [observation, embedding, search, dinov2, ci-safe]
timestamp: 2026-07-09T00:00:00+09:00
---

# 観測パイプライン

## 全体の流れ（ITO）

**IN**（写真・env・metadata）→ **Transform**（thumbnail → embedding → manifest）→ **OUT**（R2 セッション JSON・Parquet・類似検索）。IHL が主担当し、個体画像レイク・ingest・類似検索・tag/usage の append-only 記録を持つ（#05 観測、#18 写真解析と連携）。

## 埋め込み（embedding）

- **本番**: DINOv2（`dinov2_vits14`・384 次元）で埋め込みを作り L2 正規化（OBS-IMG-03）。torch hub 経由・GPU 任意。
- **既定**: `dummy` 決定論バックエンド。torch を要求せず **CI 安全**。sha256 ハッシュ → 正規乱数 → L2 正規化で決定論ベクトルを返す。切替は `IHL_EMBEDDING_BACKEND=dinov2`。
- モデル差し替え点を Protocol（`EmbeddingBackend`）で一本化し、外部 API キー非依存を保つ。埋め込みモデルを変えたときは**旧 run を残し新 snapshot を採用**（append-only・OBS-REP-IHL-03）。

## 検索梯子（決定論優先）

1. **metadata 絞り込み**: whitelist フィルタ（`ALLOWED_FILTERS`）で候補を絞る。全走査ではなく Parquet 列 + locator index を引く。
2. **subset cosine**: 絞った候補だけで L2 正規化ベクトルの内積（= cosine）を計算。
3. **rerank → top-K**: 重み付き合成スコアで並べ替え、上位 K 件を返す。

cosine は `[-1,1]` を `(x+1)/2` で `[0,1]` へ写像してから合成する。

## rerank 重み（ADR-H-12 v0.2）

```
final = 0.50·embedding + 0.20·color + 0.20·size + 0.10·lineage
```

- 欠測時の既定: color / size は `0.5`（中立）、lineage は `0.0`。
- 現状 Phase 1 実装は embedding 成分のみ実効（color/size/lineage は欠測既定）で、色・サイズ・血統成分は今後の join 拡張点。

## 性能前提と RAG

- Phase 1 IHL は**低レイテンシ非要求**（manifest 検索は数秒、バッチは数分でよい）。決定論コードを優先し、モデル呼び出しを最小化する。
- 検索の正本は R2 セッション JSON。RAG は短文チャンク（種・日時・環境・観測方法・未確定点を含む）を別に持つ（OBS-RAG-01/02）。

## サブブレインとの関係

このパイプラインは Truth 層（不変の captures）を生む。サブブレイン知識レイヤーの「検索梯子」は同じ発想の水平展開 — まず決定論コード（index.md スコアリング）で当たりを付け、モデル呼び出しは蒸留の 1 回だけに寄せる。テキスト埋め込み検索を足すときも `EmbeddingBackend` に `embed_text` を追加する既存 Protocol 拡張で済む（[research-notes-model](./research-notes-model.md) のギャップ節ヒント供給と接続）。

# Citations

- 埋め込みバックエンド実装: [`libs/ihl/observation/embedding.py`](../../../libs/ihl/observation/embedding.py)
- 類似スコアリング・rerank 実装: [`libs/ihl/observation/scoring.py`](../../../libs/ihl/observation/scoring.py)
- 写真解析・embedding 要件（§4.8）・RAG（OBS-RAG）: [`01-要件/05-観測.md`](../../../01-要件/05-観測.md)
