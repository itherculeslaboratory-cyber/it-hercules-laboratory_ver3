---
id: V3-README
title: it-hercules-laboratory_ver3 — 人間 spine 入口
date: "2026-07-10"
status: draft
---

# it-hercules-laboratory_ver3

**ver3 = コードはゼロベース、データ・思想・要件は ver2（it-hercules-laboratory）から継承。**
本 repo が唯一の正本。civilization-os や ver2 repo との双方向ミラー同期は前提にしない。

## 読む順

1. [`AGENTS.md`](AGENTS.md) — AI 入口の正本（命令形規約・禁止事項）
2. [`docs/onboarding.md`](docs/onboarding.md) — 30 分オンボーディングパス
3. [`docs/architecture.md`](docs/architecture.md) — レイヤー・feature→code の地図
4. [`01-requirements/`](01-requirements/) — 凍結 REQ（V3-* 要件の正本）
5. [`docs/planning/status.md`](docs/planning/status.md) — 今どこ・次・人間ゲート

## 単一 repo 宣言

正本はこの repo のみ（`https://github.com/itherculeslaboratory-cyber/it-hercules-laboratory_ver3`）。
Truth（永続データ）は repo の外（Cloudflare R2 append-only）。repo が持つのは契約（`schemas/`）と投影を再生成する純粋関数のみ。

## テスト

```bash
# repo ルート（Python: libs / components）
python -m pytest -q

# Web（apps/web）
cd apps/web && npm test && npm run build
```

## セットアップ

`.env.example` を `.env` にコピーして値を埋める（`.env` はコミットしない）。実鍵の投入は人間ゲート。
