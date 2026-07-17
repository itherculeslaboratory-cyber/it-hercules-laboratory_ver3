---
id: V3-DOC-OPS-NIGHTLY-AUTORUN
title: 夜間自動運転 — HQ側実体の参照 + 検証手順
date: "2026-07-17"
status: active
requirement_ids: [V3-AIP-96]
---

# 夜間自動運転（V3-AIP-96）

> **この運転機構そのものは `ihl-ver3` repo の外（HQ = `D:\claude`）にある。** V3-AIP-96/97/98
> は「プロダクトコードを repo 内に持つ」要件ではなく、「就寝中に AI 余剰セッションで夜間バッチを
> 回し朝レビュースタックへ積む」という**運転規約**の要件。本書は repo 側の完了条件（文書化 +
> 検証手順）を満たすための参照ドキュメント。実体・実装・スキーマは HQ 側正本のまま変更しない。

## 実体（読み取り専用の参照）

| 対象 | 正本パス | 役割 |
|------|----------|------|
| 決定論ランナー | `D:\claude\ops\autorun\runner.ps1` | slot 判定（dev/recovery/auto）→ 夜間タスク 1 本選定 → `claude --model sonnet` ヘッドレス起動 → 成果ログ append |
| 週間グリッド編集 GUI | `D:\claude\ops\autorun\schedule-gui.py` | localhost:8787・標準ライブラリのみ・曜日×時間帯の予約編集 |
| 運転規約設計書 | `D:\claude\systems\ihl-ver2\docs\planning\ver3\b7\ver3-夜間運転-改善ループ設計-v1.md`（V3-B7-NIGHT-OPS-v1） | コスト統治・安全停止・append-only の規約正本 |
| 夜間タスク定義 | `D:\claude\00-hq\night-tasks\*.md` | frontmatter 付きタスク定義（B4 スキーマ準拠） |
| 実行ログ | `D:\claude\ops\runs\<yyyy-MM-dd>\`（`runs.jsonl` + `morning-review.md`） | append-only。朝レビューは OK/NG するだけの Stage 0 |
| 詳細 README | `D:\claude\ops\autorun\README.md` | 全体図・slot 種別・コスト統治表・有効化/停止手順 |

## 安全設計（不変条項④ = 人間ゲート必須の反映）

- ランナーは判定に LLM を使わない（決定論。金と安全の経路に LLM を挟まない）。
- 有効化は既定 `false`。有効化は人間の記名同意（HQ 側 R-6）。
- 連続成果ゼロ 2 回で自動停止（`STOP.md` 生成 + `enabled=false`）。
- `runs.jsonl` / `morning-review.md` / `STOP.md` は append-only（UPDATE・DELETE 禁止 — 不変条項③と同じ規約）。
- 夜間は最上位モデル・多エージェント並列・外部取得を使わない（`--allowedTools Read,Glob,Grep,Write` のみ）。
- 完全無人ワンクリック全自動ではない — 朝の OK/NG は人間が行う（V3-AIP-31 と同じ人間ゲート文化）。

## 検証手順（repo からできる読み取り専用チェック — 実行はしない）

1. **スケジューラ登録の確認**（実行しない・照会のみ）: `schtasks /Query /TN "ihl-claude-autorun"`
2. **直近の稼働ログ確認**: `D:\claude\ops\runs\<最新日付>\runs.jsonl` が append され続けているか（1 行 = 1 run）。
3. **朝レビュースタックの確認**: 同ディレクトリの `morning-review.md` に前夜の成果が積まれているか。
4. **停止マーカーの有無**: `D:\claude\00-hq\night-tasks\STOP.md` が存在しないこと（存在すれば自動停止中）。
5. **設定の生存確認**: `D:\claude\ops\schedules\autorun-schedule.json` の `enabled` フラグと日次予算（`daily_budget`）。

repo 側の完了条件は上記 1〜5 を人間または監査エージェントが定期的に読み取り確認できる状態にすること。
ihl-ver3 側のコード変更は不要（機構は repo の外で完結する運転規約のため）。
