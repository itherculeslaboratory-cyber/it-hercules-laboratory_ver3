---
id: V3-STATUS
title: 本番状態・直近タスク・人間ゲート
date: "2026-07-10"
status: draft
---

# ステータス（spine #5）

> 更新のたびに「今どこ / 次 / 人間ゲート」の 3 節を最新化する。設計正本の永久配置はしない（Working）。

## 今どこ

**Phase C1 完了**（2026-07-10 — `docs/planning/c1/REPORT-ver3-phase-c1-2026-07-10.md`）。

- CL-01〜13 negative TC 全 green（`tests/cl-01`〜`cl-13`・13 ファイル / 101 テスト。RED→GREEN 逐語ログ = `docs/planning/c1/tc-red-green-log.md`）。以降これが回帰条件 — 1 本でも赤に転じた PR は fail（開発計画 R-03）。
- R2 put-if-absent は**実機検証済み・mode=storage**（実バケット `ihl-ver3-truth-dev` で 2 重 put → 先勝ち・後発 null。証跡 = `docs/planning/c1/r2-put-if-absent-evidence.md`）。append-only はストレージ層強制。
- append-only 基盤 = `packages/truth`（envelope 検証 / TruthStore put-if-absent / contracts 移植）+ `apps/api` deny-by-default + `POST /events`。
- schemas/ → TS 型 codegen（`scripts/codegen-schemas.mjs`）が root lint チェーン = CI で回る（完了条件③）。

## 次（最優先）

**C2: 認証 + 観測コア MVP**（開発計画 §3.1 C2）。

- V3-AUT-03（JWT vs opaque）の裁定を C2 冒頭で確定 → CL-03 実セッション実装（C1 は DEV_TOKEN スタンドイン）。
- マジックリンク認証（Resend SMTP 互換・dev_token フォールバック = V3-AUT-05）。実鍵投入は人間ゲート。
- V3-OBS-22 スコープ実装 + ScreenDef Renderer 土台。CL-04 は 57 route マトリクスの公開/保護列と照合。
- C1 実機照合で見つかった ver2 側の要裁定 3 点（CL-08 vector_length の意味 / CL-03 email 正規化不整合 / CL-07 png-vs-JPEG）を C2 冒頭で確定。

## 人間ゲート一覧（AI では確定しない）

| ゲート | 内容 | 状態 |
|--------|------|------|
| LICENSE 確定 | AI が候補比較を提示 → ユーザー確定。確定まで private | 未 |
| Resend 実鍵投入 | `RESEND_API_KEY` の実値をサーバ側に投入 | 未 |
| GMO 本番契約・live 昇格 | 本番口座 API の live 接続・実入金照合（`GMO_CONNECTOR_MODE=live`） | 未 |
| 公開の実施 | repo / OSS スナップショットの実際の公開 | 未 |
