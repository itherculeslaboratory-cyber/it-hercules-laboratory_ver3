---
id: ADR-V3-LAYER-01
title: Truth 層（append-only・不変）と投影層（再生成可）の分離
date: "2026-07-10"
status: proposed
source: "docs/planning/ver3/ver3-最終要件定義書-v1.md@4a56cf6 (§5.3 ADR-V3-LAYER-01, lines 1305-1328)"
---

# ADR-V3-LAYER-01 — Truth 層（append-only・不変）と投影層（再生成可）の分離

- **Status**: Proposed（DIFF-C-26 の層分離裁定に接続。§5.2.1 の 42 制約・§5.4 の CL-01/02/05/12/13 を束ねる ADR）
- **Date**: 2026-07-10
- **抽出元**: `docs/planning/ver3/ver3-最終要件定義書-v1.md` §5.3（@4a56cf6）。本文は抽出コピーで無変更。

## 文脈（Context）

ver3-live は既に「R2 への書き込みは INSERT ONLY、UPDATE・DELETE・キー上書き禁止（no-overwrite=同一キー再 put 409）」で稼働している（V3-FND-01）。永続正本は Cloudflare R2 のみで、常駐 DB（Postgres/SQLite/Qdrant/pgvector 等）は真実の源泉にしない（V3-FND-02）。一方で検索・一覧・類似・集計といった読み取り要求は、ディレクトリ構造だけの R2 では満たせない（V3-FND-03）。ここで「書いたら消せないイベント列」と「速く読むための構造」を同一ストレージ・同一責務に混ぜると、スキーマ変更が既存 Truth の同一性（Genesis Hash + ハッシュチェーン, V3-FND-05）を壊す。

## 決定（Decision）

システムを 2 層に分離する。

| 層 | 定義 | 変更可否 | 具体物 | 対応要件 |
|---|---|---|---|---|
| **Truth 層** | 起きた事実の append-only イベント列。文明の同一性の源泉 | **不変**（INSERT ONLY / no-overwrite / UPDATE・DELETE 禁止 / R2 トークンに削除権限なし） | R2 の event/snapshot、同意記録、カルマ・プラチナ台帳、タグイベント、collector 署名付き環境 POST | V3-FND-01 / 05 / 06、V3-KRM-19、V3-OBS-63 |
| **投影層** | Truth から純粋関数で再生成する読み取り用構造。速度・検索のためのキャッシュ | **再生成可**（いつ捨てても Truth から復元できる。正本ではない） | Parquet manifest、materialized view、embedding generation、latest.json pointer、DuckDB/Polars 上の集計 | V3-FND-03 / 06、V3-FND-04（Reducer）、V3-BBS-05 |

**不変条件（invariant）**: 投影層は Truth 層の関数 `projection = f(truth_events)` であり、`f` は決定論的（同一入力→同一出力・副作用ゼロ, V3-FND-04）。投影を全消去しても Truth から `f` を再実行すれば完全復元できることを常に保証する。逆に、投影層にしか存在しない事実を作ってはならない（投影は事実を生まない）。

## 帰結（Consequences）

- **良い帰結**: (1) スキーマ進化は投影層の `f` 差し替えで吸収でき、Truth のバイト列に触れない。(2) 障害復旧は「投影を捨てて Truth から再生成」の一手に単純化。(3) 監査は Truth 層のハッシュチェーン検証で閉じる。
- **コスト**: (1) 読み取り最適化のたびに `f` の再生成コストがかかる（低レイテンシは非要求として受容, V3-FND-03）。(2) 投影の鮮度は pointer 更新のタイミングに従属する。
- **凍結範囲**: §5.4 の CL-01/CL-02/CL-05/CL-12/CL-13（append-only 中核 5 レイヤー）は、本 ADR が確定するまで**イベントスキーマを形式凍結**する。変更は投影層側でのみ行う。
