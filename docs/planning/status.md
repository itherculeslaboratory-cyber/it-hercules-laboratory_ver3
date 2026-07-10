---
id: V3-STATUS
title: 本番状態・直近タスク・人間ゲート
date: "2026-07-10"
status: draft
---

# ステータス（spine #5）

> 更新のたびに「今どこ / 次 / 人間ゲート」の 3 節を最新化する。設計正本の永久配置はしない（Working）。

## 今どこ

**Phase C0 完了直後** — 新 repo（`it-hercules-laboratory_ver3` / ローカル `D:\claude\systems\ihl-ver3`）の初期化中。

- ルート衛生 3 点（`.gitignore` / `.oss-export-ignore` / `.env.example`）作成済み。
- 人間 spine（README・onboarding・architecture・constitution・本 status）と AI 入口（AGENTS・CLAUDE・llms.txt）を並行執筆中。
- 継承 copy（`01-requirements/`・`02-design/adr/`・`schemas/frozen/`・`docs/knowledge/`・`assets/`）はコピー元 commit `4a56cf6` を frontmatter `source` に記録して持ち込む。

## 次（最優先）

**C1: CL-01〜13 negative TC の緑化**（フォルダ設計 §8 手順11・要件定義書 §6.4）。

- `schemas/frozen/` に CL-01〜13 の JSON Schema を持ち込み、`tests/` に negative TC を常駐させ緑化する。
- 以降、この CL negative TC を回帰条件とし、`schemas/frozen/` の変更は TC 緑化とセットでのみ許可。
- 機械 GATE（filename lint・生成物手編集検知）を `scripts/` に実装し CI 接続。

## 人間ゲート一覧（AI では確定しない）

| ゲート | 内容 | 状態 |
|--------|------|------|
| LICENSE 確定 | AI が候補比較を提示 → ユーザー確定。確定まで private | 未 |
| Resend 実鍵投入 | `RESEND_API_KEY` の実値をサーバ側に投入 | 未 |
| GMO 本番契約・live 昇格 | 本番口座 API の live 接続・実入金照合（`GMO_CONNECTOR_MODE=live`） | 未 |
| 公開の実施 | repo / OSS スナップショットの実際の公開 | 未 |
