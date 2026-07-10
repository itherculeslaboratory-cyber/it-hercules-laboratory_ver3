---
id: V3-STATUS
title: 本番状態・直近タスク・人間ゲート
date: "2026-07-11"
status: draft
---

# ステータス（spine #5）

> 更新のたびに「今どこ / 次 / 人間ゲート」の 3 節を最新化する。設計正本の永久配置はしない（Working）。

## 今どこ

**Phase C3 完了（CL-07 裁定待ちを除く）**（2026-07-11 — `docs/planning/c3/REPORT-ver3-phase-c3-2026-07-11.md`）。完了条件 (i)(ii) 成立・(iii) は設計どおり分母除外（CL-07 は C3 冒頭の人間裁定待ち — 材料 `docs/planning/c3/cl-07-thumbnail-options.md` 提出済み・実装未着手）。類似検索の決定論梯子（whitelist→subset→embedding・`ladder_stage`・768次元遮断）+ CL-06/10 実サンプル TC（ihl-ver2 UAT サインオフ実個体ID + 実QRコードパス）+ collector ingest（Ed25519 署名認証）+ SwitchBot 単発コレクタ + wiki-ingest ruri-v3-70m backend（PyTorch/ONNX cosine=1.0 一致検証済み）。批評家 2 観点/1 ラウンドで major（design-c3.md 未追跡）解消。**納品前 再走実測**: `npm run lint` 9 GATE 全 OK / `npm test` = apps/api 1 + tests 167 + apps/web 15 = **183 passed / 0 failed**（C2 156→+27）/ `pytest -q` = **4 passed, 1 skipped**（skip は torch 依存 parity TC・bare CI の意図的挙動）。SwitchBot 実 API smoke（`--fetch-only`）は成功（実機 13 台検出）。

**Phase C2 完了・納品**（2026-07-11 — `docs/planning/c2/REPORT-ver3-phase-c2-2026-07-10.md`）。受け入れ **(a)(b)(c)(d) 全成立**・批評家 4 観点/3 ラウンド通過（第3パス fix3 で §7 実ブラウザ通貫 E2E を Chromium 実機で実走・green 実測して (c) を解消）。認証（署名付きステートレスセッション）+ 観測コア API 8 route + ScreenDef Renderer（データ束縛ランタイム）+ CL-04 57route 照合 + CL-08 vector_length=384 訂正。**納品前 再走実測**: `npm run lint` 9 GATE 全 OK / `npm test` = apps/api 1 + tests 140 + apps/web 15 = **156 passed / 0 failed** / `npm run e2e -w apps/web` = 実ブラウザ **2 passed / 0 failed**（`docs/planning/c2/e2e-evidence.md`）。要件 ID↔TC = `docs/planning/c2/tc-coverage.md`（自動化可能 16/16 green = 100%・V3-FND-02 のみ否定的アーキ制約で分母除外）。

**Phase C1 完了**（2026-07-10 — `docs/planning/c1/REPORT-ver3-phase-c1-2026-07-10.md`）。

- CL-01〜13 negative TC 全 green（`tests/cl-01`〜`cl-13`・13 ファイル / 101 テスト。RED→GREEN 逐語ログ = `docs/planning/c1/tc-red-green-log.md`）。以降これが回帰条件 — 1 本でも赤に転じた PR は fail（開発計画 R-03）。
- R2 put-if-absent は**実機検証済み・mode=storage**（実バケット `ihl-ver3-truth-dev` で 2 重 put → 先勝ち・後発 null。証跡 = `docs/planning/c1/r2-put-if-absent-evidence.md`）。append-only はストレージ層強制。
- append-only 基盤 = `packages/truth`（envelope 検証 / TruthStore put-if-absent / contracts 移植）+ `apps/api` deny-by-default + `POST /events`。
- schemas/ → TS 型 codegen（`scripts/codegen-schemas.mjs`）が root lint チェーン = CI で回る（完了条件③）。

## 次（最優先）

**C4: GMO sunabar 本結線**（開発計画 §3.1 C4）+ **CL-07 裁定**（人間ゲート・下記参照）。

- CL-07 裁定が下り次第、thumbnail 経路（jSquash on Workers 等）の実装 + frozen `format` const 付与・description 訂正（対応 TC 緑化ゲート必須）。C4 と並行可（依存なし）。
- C4 本体は GMO sunabar 連携の本結線（詳細は開発計画 §3.1 C4 を参照して設計契約 `docs/planning/c4/design-c4.md` を起票してから着手）。

### C3 からの持ち越し

- CL-07 裁定 4 点（下記人間ゲート表）。裁定後の実装・スキーマ変更は別作業。
- collector ingest 実鍵・本番投入（Ed25519 鍵ペア生成・登録・本番 Workers ingest 実 POST）は未実施 — 人間ゲート「実鍵・本番鍵の投入」に該当（`docs/planning/c3/REPORT-ver3-phase-c3-2026-07-11.md` 参照）。

## 人間ゲート一覧（AI では確定しない）

| ゲート | 内容 | 状態 |
|--------|------|------|
| LICENSE 確定 | AI が候補比較を提示 → ユーザー確定。確定まで private | 未 |
| CL-07 裁定 4 点 | ①形式=JPEG確定 ②実装経路第1手=jSquash on Workers（$0硬制約なら CF Images） ③受け入れ条件をバイト級→契約級互換に読み替え ④EXIF transpose を ver3 の正しい挙動として採用（ver2 実装は未適用）。材料 `docs/planning/c3/cl-07-thumbnail-options.md` | 未 |
| Resend DNS（CF トークン権限） | Resend 送信ドメイン DNS 検証には Cloudflare API トークンに DNS 編集スコープが要る（現状 `CF_API_TOKEN` のスコープ未確認）。`RESEND_API_KEY` 自体も D:\env に未取得 | 未 |
| GMO 本番契約・live 昇格 | 本番口座 API の live 接続・実入金照合（`GMO_CONNECTOR_MODE=live`） | 未 |
| collector ingest 実鍵投入 | `COLLECTOR_PRIVATE_KEY_PEM`（Ed25519 秘密鍵）生成・`COLLECTOR_PUBLIC_KEYS` 登録・本番 `INGEST_URL` 配線 | 未 |
| 公開の実施 | repo / OSS スナップショットの実際の公開 | 未 |
