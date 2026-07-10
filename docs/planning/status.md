---
id: V3-STATUS
title: 本番状態・直近タスク・人間ゲート
date: "2026-07-10"
status: draft
---

# ステータス（spine #5）

> 更新のたびに「今どこ / 次 / 人間ゲート」の 3 節を最新化する。設計正本の永久配置はしない（Working）。

## 今どこ

**Phase C2 コア完了・受け入れ (a)(b)(d) 成立 + 批評家 major 2 件解消（第2パス）**（2026-07-11 — `docs/planning/c2/REPORT-ver3-phase-c2-2026-07-10.md`）。認証（署名付きステートレスセッション）+ 観測コア API 8 route + ScreenDef Renderer（データ束縛ランタイム）+ CL-04 57route 照合 + CL-08 訂正。`npm run lint` 9 GATE 全 OK / `npm test` = **155 passed / 0 failed**。要件 ID↔TC = `docs/planning/c2/tc-coverage.md`（16/16 自動化可能 green・V3-FND-02 のみ構造的担保で分母除外）。
**第2パスで解消（受け入れ (c) 画面層）**: (a) 同一オリジン dev プロキシ（next rewrites）で cookie 通す・(b) obs-entry form を obs-capture schema へ整形（domain+measurements）・(c) Renderer に補間/mount-fetch/list 束縛/transitions 消費・(d) `POST /auth/dev-login`（dev 限定・本番 404）で dev ボタン実機能化。individual-detail のハードコード撤去→実データ束縛。renderer +4 / auth +2 TC で単体緑。**残**: §7 実ブラウザ通貫クリックスルーのローカル再走のみ（本サンドボックス非搭載・通貫は成立可能）。

**Phase C1 完了**（2026-07-10 — `docs/planning/c1/REPORT-ver3-phase-c1-2026-07-10.md`）。

- CL-01〜13 negative TC 全 green（`tests/cl-01`〜`cl-13`・13 ファイル / 101 テスト。RED→GREEN 逐語ログ = `docs/planning/c1/tc-red-green-log.md`）。以降これが回帰条件 — 1 本でも赤に転じた PR は fail（開発計画 R-03）。
- R2 put-if-absent は**実機検証済み・mode=storage**（実バケット `ihl-ver3-truth-dev` で 2 重 put → 先勝ち・後発 null。証跡 = `docs/planning/c1/r2-put-if-absent-evidence.md`）。append-only はストレージ層強制。
- append-only 基盤 = `packages/truth`（envelope 検証 / TruthStore put-if-absent / contracts 移植）+ `apps/api` deny-by-default + `POST /events`。
- schemas/ → TS 型 codegen（`scripts/codegen-schemas.mjs`）が root lint チェーン = CI で回る（完了条件③）。

## 次（最優先）

**C2: 認証 + 観測コア MVP**（開発計画 §3.1 C2）。**着手前裁定は完了**（2026-07-10 第6回 — `docs/planning/rulings/user-ruling-2026-07-10-round-6.md`）。

- セッション = **署名付きステートレストークン**（V3-AUT-03 修正承認・サーバ側ストアなし・保持方法は C2 設計で確定）→ CL-03 実セッション実装（C1 は DEV_TOKEN スタンドイン）。
- email 正規化 = 入口で `strip().lower()` 統一（第6回裁定③）。CL-08 `vector_length` = 要素数 384 に確定 — frozen description 訂正は C2 で対応 TC とセットで実施。
- マジックリンク認証（Resend SMTP 互換・dev_token フォールバック = V3-AUT-05）。**実鍵投入の時期は AI 委任済み**（第6回裁定④・実行直前に一言報告）。
- V3-OBS-22 スコープ実装 + ScreenDef Renderer 土台。CL-04 は 57 route マトリクスの公開/保護列と照合。
- CL-07 png-vs-JPEG は C3 冒頭裁定（第6回裁定⑤）。

## 人間ゲート一覧（AI では確定しない）

| ゲート | 内容 | 状態 |
|--------|------|------|
| LICENSE 確定 | AI が候補比較を提示 → ユーザー確定。確定まで private | 未 |
| Resend 実鍵投入 | `RESEND_API_KEY` の実値をサーバ側に投入 | 未 |
| GMO 本番契約・live 昇格 | 本番口座 API の live 接続・実入金照合（`GMO_CONNECTOR_MODE=live`） | 未 |
| 公開の実施 | repo / OSS スナップショットの実際の公開 | 未 |
