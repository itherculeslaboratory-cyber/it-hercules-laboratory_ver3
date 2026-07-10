---
id: V3-REQ-INDEX
title: 01-requirements 由来表（凍結 REQ 正本の索引）
date: "2026-07-10"
status: frozen
---

# 01-requirements — 凍結 REQ 正本の索引

> **分類**: Canonical・**凍結**（設計書憲法 C4）。V3-* 要件の正本。移した時点で本 repo 側が正本（フォルダ設計 §6 copy 分類）。
> **継承コミット**: すべて現 repo `it-hercules-laboratory`（ver2）の `4a56cf6` から複製。

## 由来表

| ファイル | 役割 | コピー元パス（現 repo・@4a56cf6） | 変更 |
|----------|------|-----------------------------------|------|
| [`registry.json`](registry.json) | 機械可読正本（要件レジストリ・716 件） | `docs/planning/ver3/ver3-最終要件レジストリ-v1.json` | 内容無変更（JSON のため frontmatter なし。由来は本表で記録） |
| [`srs.md`](srs.md) | 人間可読正本（最終要件定義書 v1.3・日本語正本） | `docs/planning/ver3/ver3-最終要件定義書-v1.md` | 本文無変更。先頭に frontmatter（`source:` 含む）を付加のみ |
| [`retracted.md`](retracted.md) | 撤回台帳 R-1〜R-9（復活禁止・人間ゲート） | `docs/planning/ver3/ver3-要望理解書-v1.md` §4 | R-1〜R-9 を「ID/内容/撤回理由/復活可否」表に転記 |

## 置いてよい／いけない（フォルダ設計 §2.2）

- **置いてよい**: registry.json・srs.md・撤回台帳。
- **置いてはいけない**: API path・スキーマ本文・設計（憲法 C3 の層分離。スキーマは `schemas/`、設計は `02-design/`）。

## 関連

- ADR: [`../02-design/adr/`](../02-design/adr/)（ADR-V3-LAYER-01 層分離・ADR-V3-EMB-01 埋め込み次元）
- 撤回の復活は人間ゲート（自律ラン既定契約の残存ゲート 5 種の 1 つ）。
