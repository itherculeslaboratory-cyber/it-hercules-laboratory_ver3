---
type: Topic
title: 研究ノートモデル（論文6節スキーマとappend-onlyフロー）
description: 進行中を一級とする研究ノートの6節テンプレ・5ステップ進行・append-only構造（PROVISIONAL）
tags: [research, paper, append-only, provisional, w2]
timestamp: 2026-07-09T00:00:00+09:00
---

# 研究ノートモデル

> **ステータス**: **仮採用（PROVISIONAL・ゲート中）**。W2 checkpoint 論文柱のたたき台で、実装 Go 不可。

## メンタルモデル

> 「観測から始め、条件を埋め、試し、記録し、引用する — 途中のまま消えない研究ノート」

論文は完成品の重圧を外し、**`in_progress` を一級**とする。**下書き概念を使わない**（append-only なので消えない）。velocity の敵は LaTeX と Dashboard、味方は 6 節テンプレ + 5 ステップ + 観測逆流 + append-only（ADR-H-09）。

## 6 節スキーマ `PaperSectionsV1`

| 節 | 内容 |
|---|---|
| 目的 (purpose) | 何を明らかにするか |
| 仮説 (hypothesis) | P⇒Q |
| 条件 (conditions) | 温度 / 湿度 / 餌（+ 将来 IoT / placement キー） |
| 検証 (verification) | 検証したいこと |
| 現在のフェーズ (current_phase) | 5 ステップの enum |
| ギャップ (gaps) | `missing_keys` / `violated_keys` / 〔不足〕タグ |

各節は `filled` フラグを持ち、`completeness_pct`（0–100）が完成度メータになる（walkId `09t`）。未記入はプレースホルダ、埋め済みは緑チェック。文体スキン（美学テンプレ）は別ファイル `aesthetic_skin_id` で後追いし、構造とは分離する。

## 5 ステップ進行

**観測 → 仮説 → 試す → 記録 → 引用** をタイムライン表示し現在地をハイライト。各ステップから 1 クリックで該当操作へ（「試す」= 観測 Capture へ戻る）。一周 **7〜9 クリック・往復ゼロ**が設計目標（ADR-H-09）。

## エンティティと append-only

- `content_id`（正本キー・UUID）。`content_type` = `research_note` | `hypothesis` | `paper` | `replication_report` | `review`。`status` = `in_progress` | … | `published`。`paper_id` は API 互換エイリアス。
- **INSERT ONLY**: 節更新・status 遷移・Citation・match record はすべて追記。「上書き」は新 event として書き、UI は最新 event の materialized view を表示。R2 キー: `world/research/content/{content_id}/events/{event_id}.json`、`world/research/citations/{citation_id}.json`。
- **BBS 議論分離**: 論文 Content（Truth）と掲示板スレッド（議論）は別エンティティ。詳細から〔論文板で議論する〕リンクのみで、BBS タブ内に 6 節テンプレを埋め込まない。BBS 抜粋は Citation リンクとし本文を複製しない。

## Paper Match と 6 節の接続（DET-KN-5）

```
sections.conditions → POST /api/v1/research/match → gaps.missing_keys / score → gaps 節 UI
                                                   → match_id → match_refs[] append
```

RAG / LLM は Phase 1 非必須で、ギャップ節に**静的ヒント 1 行**まで。これがサブブレイン wiki の `open-questions.md` から静的ヒントを供給できる最初の差し込み点（LLM 層の価値を最小コストで見せる枠）。

## 禁止と分離

- **LaTeX 禁止（Phase 1）**: TeX ソース編集 UI を出さない。構造は JSON/YAML 節 + プレビュー。
- ユーザー向けに「未実装」「WIP」「下書き」文言を出さない（内部に `draft` があっても UI は「進行中」に統一）。

## 科学OS統合の docs 成果物（PROVISIONAL・実装ゲート外）

`DESIGN-science-os-integration.md`（Wikidata 正規ID軸 + AI 査読の組み込み）から、この 6 節モデルを**新スキーマを作らず拡張**する 3 つの docs 成果物が起こされた。いずれも「docs 層の提案」であり canonical 層・AI 査読の**コード実装は人間ゲート後**。

| 成果物 | 6 節モデルとの接続 |
|---|---|
| 観点辞書 v0 | 条件 (conditions) 節を「観点キー + 値 + 単位 + 欠損フラグ」の観点ベクトルへ正規化する辞書草案。`schemas/dictionaries/*.yaml` と同格の未確定 |
| 論文テンプレート JSON Schema v0 | `PaperSectionsV1` に観点ベクトルを足す提案。`schemas/` への新規追加ではなく将来実装時の入力ドラフト |
| AI査読チェックリスト v0 | 査読パイプライン段階 1〜5（構造・欠損・再現性・整合性・統計）を**決定論コードで実装可能**とする仕様。LLM 必須は段階 6（要約・改善提案）のみで DET-KN-5 と一致 |

# Citations

- 論文柱 仮採用設計（6 節・5 ステップ・append-only・Paper Match）: [`docs/planning/w2-checkpoint/知の広場-仮採用-02-論文-v1.md`](../../planning/w2-checkpoint/知の広場-仮採用-02-論文-v1.md)
- サブブレインでの位置づけ（DET-KN-5 静的ヒント枠）: [`docs/planning/claude-plans/DESIGN-subbrain-knowledge-layer.md`](../../planning/claude-plans/DESIGN-subbrain-knowledge-layer.md)
- 科学OS統合設計（Wikidata 正規ID・AI 査読・観点ベクトル拡張）: [`docs/planning/claude-plans/DESIGN-science-os-integration.md`](../../planning/claude-plans/DESIGN-science-os-integration.md)
- 観点辞書 v0 / 論文テンプレート JSON Schema v0 / AI査読チェックリスト v0: [`docs/planning/science-os/perspective-dictionary-v0.md`](../../planning/science-os/perspective-dictionary-v0.md) · [`docs/planning/science-os/paper-template-schema-v0.md`](../../planning/science-os/paper-template-schema-v0.md) · [`docs/planning/science-os/ai-review-checklist-v0.md`](../../planning/science-os/ai-review-checklist-v0.md)
