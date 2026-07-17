---
type: Topic
title: 文明の脳 — 統合検索(RAG)基盤の設計(V3-AIP-90)
description: 観測・論文・掲示板・UI・テンプレートを同一384次元embedding空間で検索する多段複合検索の設計。新規ベクトルDBは導入せず既存の決定論梯子+ruri-v3-70m選定を横展開する
tags: [rag, embedding, search, ai-process, v3-aip-90]
timestamp: 2026-07-17T00:00:00+09:00
---

# 統合検索(RAG)基盤 — V3-AIP-90

## 結論(選定)

**新規 RAG 基盤・専用ベクトル DB は導入しない。** [観測パイプライン](./observation-pipeline.md)の決定論梯子(metadata 絞り込み→subset cosine→rerank)と、[wiki 統合基盤の技術選定](../../planning/b2-research/research-wiki-integration.md)で確定済みの実用テキスト埋め込み `cl-nagoya/ruri-v3-70m`(384次元・ローカル ONNX・API費ゼロ)を、観測(画像 DINOv2 384)以外のドメイン(論文・掲示板・UI・テンプレート)へ**同一 384 次元 embedding 空間**として横展開する。

## 多段複合検索(要件本文どおりの梯子)

```
タグ → type/kind → payload → 要約(description) → embedding
```

1. **タグ**: frontmatter `tags`(docs/knowledge)・投稿の `tags`(掲示板)・要件 `requirement_ids` 等、決定論の完全一致/部分一致フィルタ。既存 [観測パイプライン](./observation-pipeline.md) の「metadata 絞り込み」(検索梯子節)と同型。
2. **type/kind**: OKF `type`(Topic/Source/Question)・イベント `kind`(観測/掲示板/GOV等)による粗い区分。
3. **payload**: 構造化フィールド(要件 ID・日付・スコア等)での絞り込み。
4. **要約(description)**: 短文 description/summary へのキーワード一致(`tools/knowledge_search.py` の index.md スコアリングと同型 — 決定論が主役)。
5. **embedding**: 上記で絞られた候補集合だけに対して cosine 類似度(補助・第2段)。全件embedding総当たりはしない。

この順序自体が「決定論優先・モデル呼び出しは最小化」という不変条項①と観測パイプラインの設計思想の踏襲であり、5段目(embedding)は常に**補助**であって主役ではない。

## 永続化とキャッシュ(不変条項①: 常駐 DB を SSOT にしない)

- **唯一の真実 = CSV/JSON(mini/theme/feedback チャンク)を R2 派生層に保存**。`docs/knowledge/.vector-index/`(`ids.json` + `matrix.npy`)は既存プロトタイプで、CSV/JSONへ一般化する際も「派生・再生成可能なキャッシュ」という位置づけを変えない(observation の embedding-manifest と同じ append-only 派生物モデル)。
- **専用ベクトル DB は持たない**。R2(正本) + KV(ホット系のポインタ/カウンタ)で完結させる。faiss 等は本 repo では未接続のまま(observation 側 ADR-V3-EMB-01 §Consequences と同じ判断: 件数が増えるまでは numpy 全走査で足りる)。
- **embedding はメモリキャッシュに留める**(プロセス内・再起動で消える一時データ)。永続層は上記 CSV/JSON のみ。

## 再計算タイミング(要件本文どおり)

embedding の再計算は「投稿追加/論文更新等の変更が起きたとき」だけに限定する。常時ポーリングやリアルタイム全件再計算はしない。

- **即時反映が要る経路**: 投稿後 5 分以内のバッチ(小規模差分のみ処理)。
- **通常経路**: 1 時間バッチ(蓄積分をまとめて処理)。

いずれも [wiki 統合基盤の技術選定](../../planning/b2-research/research-wiki-integration.md) §1-2 の「ingest CLI の決定論拡張」パターンと同じ運用(蓄積→タグ集計→embedding 再計算→index 更新)に乗せる。専用スケジューラは新設せず、V3-AIP-96/98(夜間/時間帯予約バッチ)の 1 タスクとして実行できる([夜間自動運転](../../ops/nightly-autorun.md)参照)。

## LLM/Vision 既定 OFF との関係

RAG の「検索」自体は決定論+embedding(補助)で完結し、LLM 呼び出しを必須としない。回答生成にLLMを使う場合(質問応答型 UI 等)は `ai-profiles/rag.json` の BYOK プロファイル(既定 `provider: openai` / ユーザー鍵)を経由し、サーバ常駐 LLM は持たない([ai-profile.schema.json](../../../schemas/ai-profile.schema.json) 参照)。

## 対象ドメインの拡張範囲(段階実装)

| ドメイン | 現状 | 本設計での位置づけ |
|---|---|---|
| 観測(画像) | 実装済み(DINOv2 384・決定論梯子) | 変更なし。既存实装がこの設計の原型 |
| wiki/知識(docs/knowledge) | 決定論梯子(index.md スコアリング)実装済み・embedding は dummy プロトタイプ(`.vector-index/`) | ruri-v3-70m への差替は[別途裁定/実装](../../planning/b2-research/research-wiki-integration.md#5-リスクと再検証条項)(embedding 実用化は人間ゲート後の判断) |
| 掲示板(BBS/知の広場) | plaza-routes 実装済み・検索は未統合 | 投稿の tags/type + description の決定論梯子から着手し、embedding 段は wiki と同一バックエンドを共有 |
| UI(screen-defs) | 未着手 | ScreenDef の `title`/`description` 相当フィールドをpayload段の対象に加える(第2波) |
| テンプレート(theme-packs等) | 未着手 | 同上(第2波) |

観測とwikiの2ドメインは既に決定論梯子の実装・選定が済んでおり、本設計はこの2つを「同一パターンの適用例」として一般化し、掲示板/UI/テンプレートへ**新規基盤を作らず**横展開する方針を確定させるものである。

## Citations

- [観測パイプライン](./observation-pipeline.md) — 決定論梯子(metadata→cosine→rerank)の原型
- [wiki 統合基盤の技術選定](../../planning/b2-research/research-wiki-integration.md) — ruri-v3-70m(384次元)選定・「新規 RAG 基盤禁止」の既存決定
- [ADR-V3-EMB-01](../../../02-design/adr/adr-v3-emb-01-embedding-dimension.md) — 384次元一本化・faiss 未接続の判断根拠
- [ai-profile.schema.json](../../../schemas/ai-profile.schema.json) — BYOK/BYOC プロファイル契約(V3-AIP-40/V3-AIP-104と共通の器)
- [夜間自動運転](../../ops/nightly-autorun.md) — embedding再計算バッチの実行先(V3-AIP-96/98)
- 要件本文: `01-requirements/srs.md#V3-AIP-90`
