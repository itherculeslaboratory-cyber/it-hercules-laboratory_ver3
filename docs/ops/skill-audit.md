---
id: V3-DOC-OPS-SKILL-AUDIT
title: スキル監査(keep/merge/rewrite/delete) — V3-AIP-57
date: "2026-07-17"
status: active
requirement_ids: [V3-AIP-57]
---

# スキル監査（V3-AIP-57）

> スキル本体（`C:\Users\sawad\.claude\skills\*\SKILL.md`）は `ihl-ver3` repo の外（ユーザーの
> グローバル Claude 設定）にある。repo 側 AI ワーカーがユーザーのグローバル設定を直接書き換える
> のは越権（本書は**監査結果の記録**まで。適用（rewrite/merge/delete の実施）は監査対象そのものの
> 所有者＝ユーザー/オーケストレータが行う）。本監査は 2026-07-17 時点のスナップショット。

## 前提規約（既存の運用方針）

- 「繰り返し使うワークフロー・手順はまず1回手動で正しさを確認してからスキル化する」は**既に実践されている**運用規約（本書はその**監査**を追加するもの。規約自体の新設ではない）。
- 全スキルは `description` frontmatter が唯一のトリガー機構（Claude のモデル呼び出し判断はこの文だけを見る）。トリガー精度の悪い description は「無関係な場面での誤発火」または「必要な場面での不発火」のどちらかを起こす。

## 監査結果（4分類）

| スキル | 分類 | 根拠 |
|---|---|---|
| `git-wrapup` | **keep** | description が肯定/否定の具体例を併記（「はい」が commit 承認への返答か無関係な質問への返答かを明示区別）。トリガー精度が高い。 |
| `graphify` | **keep** | ユーザー裁定済み（`~/.claude/CLAUDE.md`: 「トリガー文言は広いまま維持」）。広いトリガーは意図的設計であり誤発火判定は上位モデルに委譲する運用が既に確立している。 |
| `grilling` | **keep** | 「stress-test a plan」という明確な用途 + 明示トリガー句。フレーズ列挙が「any 'grill' trigger phrases」と抽象的な点はやや弱いが、`grill-me` との役割分担（下記）で実害は小さい。 |
| `grill-me` | **keep** | `disable-model-invocation: true`（自動判定オフ・`/grill-me` 明示コマンドのみで発火）。`grilling` の**フレーズ検出フォールバック**に対する**明示コマンド版**という意図的な二層構成 — 重複ではなく補完関係。誤って merge すると「暗黙発火」と「明示コマンド」の使い分けが失われるため merge しない。 |
| `night-run` | **keep** | `/night-run` 明示トリガーのみ。運用対象パスも固定パスで明記済み。誤発火リスク最小。 |
| `reuse-scout` | **keep** | `~/.claude/CLAUDE.md` の最上位方針(reuse-first)に直結する高価値スキル。トリガー句を多数列挙し精度も高い。 |
| `ruling-record` | **keep** | ファイル名パターン・明示トリガー句を具体的に列挙。精度高い。 |
| `spec-doc-formatter` | **keep** | 肯定/否定の具体例が揃い、他スキル(`impeccable`)との境界も明示。 |
| `task-ledger` | **keep** | `~/.claude/CLAUDE.md` の「全応答＝フィードバックとして常時学習」運用の実体（`D:\claude\00-hq\TASK-LEDGER.md`）。トリガー句・適用範囲とも明確。 |
| `ui-mockup-to-screendef` | **keep** | ファイル命名規則(`ihl-NN-*.png`)・出力形式(ScreenDef JSON)を具体化し、`impeccable` との非対象範囲まで明示。精度高い。 |
| `notebooklm` | **rewrite(推奨)** | 暗黙トリガー句「intent like "create a podcast about X"」が汎用的すぎる — NotebookLM と無関係な「ポッドキャストを作って」という依頼にも誤発火し得る。推奨修正: 暗黙トリガーを `/notebooklm` 明示 + 「NotebookLM の notebook/source に言及」等の具体条件へ絞る。**repo からは適用しない**（グローバル設定の書き換えは越権）。 |

**merge / delete 該当なし**（現状 11 スキル中、機能重複や死蔵スキルは検出されなかった）。

## 頻出パターン・スキル化候補の抽出（棚卸し手法）

要件は「過去セッションからの監査プロンプトやインタビュー形式の棚卸し」を求めるが、本 repo 内から
過去セッションの生ログを網羅的に読むことはできない（セッションログは repo 外・かつ大半が
他プロジェクト分）。既存の代替入力源で代用する:

- **`C:\Users\sawad\.claude\projects\D--claude-systems-ihl-ver3\memory\MEMORY.md` 系**（本 repo 専用の
  蒸留済みセッション要約）を頻出パターンの一次情報源とする。新しい繰り返しパターンが3回以上
  観測されたら、まず1回手動で正しさを確認してから `~/.claude/skills/` へ型化する既存フロー
  （本書冒頭の前提規約）にそのまま乗せる。
- この抽出自体は**継続運用**であり一度きりの成果物ではない（`docs/planning/c5/c5-cluster-table.md`
  の「process(条文化済み規約・成果物なし)」分類と同じ性質）。次回監査（次セッション）は本書の
  「監査結果」表を追記更新する。

## repo 側の完了条件

- [x] 現存スキル 11 件を keep/merge/rewrite/delete で機械的に分類し根拠を記録した。
- [x] トリガー精度が弱い1件（`notebooklm`）を rewrite 候補として特定した。
- [ ] 実際の rewrite/merge/delete 適用（グローバル設定の書き換え）— **repo 外・ユーザーゲート**。
- [ ] 抽出元セッションログの網羅読解 — repo からアクセス不能なため `memory/` 要約で代替（継続運用）。
