---
id: V3-STATUS
title: 本番状態・直近タスク・人間ゲート
date: "2026-07-10"
status: draft
---

# ステータス（spine #5）

> 更新のたびに「今どこ / 次 / 人間ゲート」の 3 節を最新化する。設計正本の永久配置はしない（Working）。

## 今どこ

**Phase C2 完了・納品**（2026-07-11 — `docs/planning/c2/REPORT-ver3-phase-c2-2026-07-10.md`）。受け入れ **(a)(b)(c)(d) 全成立**・批評家 4 観点/3 ラウンド通過（第3パス fix3 で §7 実ブラウザ通貫 E2E を Chromium 実機で実走・green 実測して (c) を解消）。認証（署名付きステートレスセッション）+ 観測コア API 8 route + ScreenDef Renderer（データ束縛ランタイム）+ CL-04 57route 照合 + CL-08 vector_length=384 訂正。**納品前 再走実測**: `npm run lint` 9 GATE 全 OK / `npm test` = apps/api 1 + tests 140 + apps/web 15 = **156 passed / 0 failed** / `npm run e2e -w apps/web` = 実ブラウザ **2 passed / 0 failed**（`docs/planning/c2/e2e-evidence.md`）。要件 ID↔TC = `docs/planning/c2/tc-coverage.md`（自動化可能 16/16 green = 100%・V3-FND-02 のみ否定的アーキ制約で分母除外）。

**Phase C1 完了**（2026-07-10 — `docs/planning/c1/REPORT-ver3-phase-c1-2026-07-10.md`）。

- CL-01〜13 negative TC 全 green（`tests/cl-01`〜`cl-13`・13 ファイル / 101 テスト。RED→GREEN 逐語ログ = `docs/planning/c1/tc-red-green-log.md`）。以降これが回帰条件 — 1 本でも赤に転じた PR は fail（開発計画 R-03）。
- R2 put-if-absent は**実機検証済み・mode=storage**（実バケット `ihl-ver3-truth-dev` で 2 重 put → 先勝ち・後発 null。証跡 = `docs/planning/c1/r2-put-if-absent-evidence.md`）。append-only はストレージ層強制。
- append-only 基盤 = `packages/truth`（envelope 検証 / TruthStore put-if-absent / contracts 移植）+ `apps/api` deny-by-default + `POST /events`。
- schemas/ → TS 型 codegen（`scripts/codegen-schemas.mjs`）が root lint チェーン = CI で回る（完了条件③）。

## 次（最優先）

**C3: 観測拡張 + 類似検索梯子**（開発計画 §3.1 C3・着手前の人間ゲート = なし）。

- **C3 冒頭裁定**: CL-07 png-vs-JPEG（第6回裁定⑤・thumbnail 経路の実装方式＝wasm / Cloudflare Images / クライアント生成 と不可分）。
- 類似検索の決定論梯子（whitelist→subset→embedding・V3-OBS-10）。既存 R2 埋め込み（384・C2 で CL-08 確定）に対する類似検索 TC green（CL-08 回帰）。
- thumbnail 経路（CL-07 の Workers 実装 or VPS 残置の裁定）。新経路出力 vs 既存契約（長辺 512px JPEG/EXIF）の比較 TC green。
- SwitchBot 連携（V3-OBS-28）・wiki ingest CLI 拡張（ruri-v3-70m backend 追加）。

### C2 からの持ち越し

- なし。§7 実ブラウザ通貫クリックスルーは C2 第3パス（fix3・976dbc0）で実走・green 実測済み（`docs/planning/c2/e2e-evidence.md`）。

## 人間ゲート一覧（AI では確定しない）

| ゲート | 内容 | 状態 |
|--------|------|------|
| LICENSE 確定 | AI が候補比較を提示 → ユーザー確定。確定まで private | 未 |
| Resend 実鍵投入 | `RESEND_API_KEY` の実値をサーバ側に投入 | 未 |
| GMO 本番契約・live 昇格 | 本番口座 API の live 接続・実入金照合（`GMO_CONNECTOR_MODE=live`） | 未 |
| 公開の実施 | repo / OSS スナップショットの実際の公開 | 未 |
