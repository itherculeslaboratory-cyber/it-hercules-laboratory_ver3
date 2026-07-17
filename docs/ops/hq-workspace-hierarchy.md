---
id: V3-DOC-OPS-HQ-HIERARCHY
title: HQワークスペース階層(D:\claude) — 参照 + 検証手順
date: "2026-07-17"
status: active
requirement_ids: [V3-AIP-97]
---

# HQ ワークスペース階層（V3-AIP-97）

> V3-AIP-96 と同様、この階層設計そのものは `ihl-ver3` repo の外（`D:\claude`）にある。repo 側の
> 完了条件は「文書化 + 検証手順」。HQ 側正本を書き換えない（読み取り専用の参照）。

## 実体（読み取り専用の参照）

`D:\claude` 直下は 4 フォルダに限定される（`D:\claude\README.md` が正本）:

| フォルダ | 役割 |
|----------|------|
| `00-hq\` | 横断正本 — 規約・裁定ログ（`TASK-LEDGER.md` 等）・ダッシュボード定義・夜間タスク定義（`night-tasks\`） |
| `systems\` | 開発システム — 1 システム = 1 フォルダ = 1 git repo（`ihl-ver3` を含む） |
| `knowledge\` | 蒸留済み知識 — トランスクリプト・要約 md・inbox（PII 原本は置かない） |
| `ops\` | 運転の実体 — スケジュール定義・実行ログ・skills 開発（V3-AIP-96/98 が使う `ops\autorun\`） |

- 各開発システムの正本はそのシステムの repo 内（`ihl-ver3` の正本は `AGENTS.md` が入口）。HQ はそれらを横断する規約層。
- 他プロジェクトへの入口は `00-hq\WORKSPACE-INDEX.md` に一元集約（D:\ 直下の他プロジェクトへの 1 ホップポインタ）。

## repo 側の位置づけ

`ihl-ver3` は `systems\` 配下の 1 システムとして HQ 階層に参加する。repo 内の規約（`AGENTS.md`）と
HQ 規約（`00-hq\` 配下）は役割が分離している: 個々のプロダクト設計・実装ルールは repo 側正本
（`AGENTS.md`/`02-design/constitution.md`）、横断運転規約（夜間バッチ・モデル分業・裁定台帳）は
HQ 側正本。どちらかを複製しない（正本 1 つ・不変条項②のフォーク文化と同じ「正本 1 箇所」原則）。

## 検証手順（読み取り専用）

1. `D:\claude` 直下が 4 フォルダ構成であること（`00-hq`/`systems`/`knowledge`/`ops`）を目視確認。
2. `D:\claude\systems\ihl-ver3` が本 repo の worktree/clone であること。
3. `D:\claude\00-hq\WORKSPACE-INDEX.md` が存在し、他プロジェクトへのポインタが張られていること。
4. `D:\claude\00-hq\TASK-LEDGER.md` に本ラン（T-38 等）のエントリがあること。

repo 側のコード変更は不要（階層設計は repo の外で完結するワークスペース規約のため）。
