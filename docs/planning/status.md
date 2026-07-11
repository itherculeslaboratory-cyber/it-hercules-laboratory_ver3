---
id: V3-STATUS
title: 本番状態・直近タスク・人間ゲート
date: "2026-07-11"
status: draft
---

# ステータス（spine #5）

> 更新のたびに「今どこ / 次 / 人間ゲート」の 3 節を最新化する。設計正本の永久配置はしない（Working）。

## 今どこ

**Phase C4 完了（完了条件 (ii) は第11回裁定で受入クローズ — 残余1点は本番初入金で確定）**（2026-07-11 — `docs/planning/c4/REPORT-ver3-phase-c4-2026-07-11.md`）。完了条件 (i)(iii) 成立・(ii) は設計どおり「実疎通実測 + 擬似入金実行のみ停止報告」で成立。台帳+カルマ二層（投影で残高/カルマ都度再計算・`GET /me/ledger` 本人スコープ・Fibonacci カルマ判定 V3-KRM-02）+ GMO sunabar 照合（接続層 `sunabar`/`live` 分離・名前照合ポーリング・実 sunabar 疎通 HTTP 200 実測・擬似入金の作成 API 機構を契約確定・振込実行は権限分類器が拒否し停止報告）+ マーケット骨格（`ihl.mkt.listing.v1`・出品/一覧/詳細 route）。批評家 2 観点/1 ラウンドで major（人間ゲート正本表への反映漏れ）解消。**納品前 再走実測**: `npm run lint` 9 GATE 全 OK（codegen 19 files in sync）/ `npm test` = apps/api 1 + tests 199 + apps/web 15 = **215 passed / 0 failed**（C3 183→+32）/ `pytest -q` = **4 passed, 1 skipped**（C3 から変化なし）。

**Phase C3 完了（CL-07 裁定待ちを除く）**（2026-07-11 — `docs/planning/c3/REPORT-ver3-phase-c3-2026-07-11.md`）。完了条件 (i)(ii) 成立・(iii) は設計どおり分母除外（CL-07 は C3 冒頭の人間裁定待ち — 材料 `docs/planning/c3/cl-07-thumbnail-options.md` 提出済み・実装未着手）。類似検索の決定論梯子（whitelist→subset→embedding・`ladder_stage`・768次元遮断）+ CL-06/10 実サンプル TC（ihl-ver2 UAT サインオフ実個体ID + 実QRコードパス）+ collector ingest（Ed25519 署名認証）+ SwitchBot 単発コレクタ + wiki-ingest ruri-v3-70m backend（PyTorch/ONNX cosine=1.0 一致検証済み）。批評家 2 観点/1 ラウンドで major（design-c3.md 未追跡）解消。**納品前 再走実測**: `npm run lint` 9 GATE 全 OK / `npm test` = apps/api 1 + tests 167 + apps/web 15 = **183 passed / 0 failed**（C2 156→+27）/ `pytest -q` = **4 passed, 1 skipped**（skip は torch 依存 parity TC・bare CI の意図的挙動）。SwitchBot 実 API smoke（`--fetch-only`）は成功（実機 13 台検出）。

**Phase C2 完了・納品**（2026-07-11 — `docs/planning/c2/REPORT-ver3-phase-c2-2026-07-10.md`）。受け入れ **(a)(b)(c)(d) 全成立**・批評家 4 観点/3 ラウンド通過（第3パス fix3 で §7 実ブラウザ通貫 E2E を Chromium 実機で実走・green 実測して (c) を解消）。認証（署名付きステートレスセッション）+ 観測コア API 8 route + ScreenDef Renderer（データ束縛ランタイム）+ CL-04 57route 照合 + CL-08 vector_length=384 訂正。**納品前 再走実測**: `npm run lint` 9 GATE 全 OK / `npm test` = apps/api 1 + tests 140 + apps/web 15 = **156 passed / 0 failed** / `npm run e2e -w apps/web` = 実ブラウザ **2 passed / 0 failed**（`docs/planning/c2/e2e-evidence.md`）。要件 ID↔TC = `docs/planning/c2/tc-coverage.md`（自動化可能 16/16 green = 100%・V3-FND-02 のみ否定的アーキ制約で分母除外）。

**Phase C1 完了**（2026-07-10 — `docs/planning/c1/REPORT-ver3-phase-c1-2026-07-10.md`）。

- CL-01〜13 negative TC 全 green（`tests/cl-01`〜`cl-13`・13 ファイル / 101 テスト。RED→GREEN 逐語ログ = `docs/planning/c1/tc-red-green-log.md`）。以降これが回帰条件 — 1 本でも赤に転じた PR は fail（開発計画 R-03）。
- R2 put-if-absent は**実機検証済み・mode=storage**（実バケット `ihl-ver3-truth-dev` で 2 重 put → 先勝ち・後発 null。証跡 = `docs/planning/c1/r2-put-if-absent-evidence.md`）。append-only はストレージ層強制。
- append-only 基盤 = `packages/truth`（envelope 検証 / TruthStore put-if-absent / contracts 移植）+ `apps/api` deny-by-default + `POST /events`。
- schemas/ → TS 型 codegen（`scripts/codegen-schemas.mjs`）が root lint チェーン = CI で回る（完了条件③）。

## 次（最優先）

**C5**（開発計画 §3.1 C5 参照。着手時に第1波 Tier A 149 件のクラスタ分割表を作成し 3 点見積を改訂 — 開発計画 §4.3 注記 — した上で設計契約 `docs/planning/c5/design-c5.md` を起票してから着手）。

- CL-07 は**完了**: 第10回裁定（4点確定）→ 実装済み（`cb5cd8f` — jSquash JPEG 512px + EXIF transpose + frozen const/TC セット）。
- C4 完了条件 (ii) は**受入クローズ**: 第11回裁定（`docs/planning/rulings/user-ruling-2026-07-11-round-11.md`）。残余 1 点（銀行側 U-code 文字変換の有無）は GMO 本番契約後の本番初入金で確定（evidence §8）。
- カルマ付与のイベントフック（観測 append 時の自動付与配線）は design-c4 §1 のとおり C5 スコープ（今回は付与関数 + TC まで）。
- マーケットの取引遷移（match/transition）・決済連動は C4 対象外（design-c4 §3・route-matrix 030-032 = ver3_note）。

### C3 からの持ち越し

- CL-07 裁定 4 点（下記人間ゲート表）。裁定後の実装・スキーマ変更は別作業。
- collector ingest 実鍵・本番投入（Ed25519 鍵ペア生成・登録・本番 Workers ingest 実 POST）は未実施 — 人間ゲート「実鍵・本番鍵の投入」に該当（`docs/planning/c3/REPORT-ver3-phase-c3-2026-07-11.md` 参照）。

## 人間ゲート一覧（AI では確定しない）

| ゲート | 内容 | 状態 |
|--------|------|------|
| LICENSE 確定 | **Apache 2.0 に確定**(第12回裁定 2026-07-11・`rulings/user-ruling-2026-07-11-round-12.md`)。公開の実施は別ゲートのまま未 | 済 |
| CL-07 裁定 4 点 | ①形式=JPEG確定 ②実装経路第1手=jSquash on Workers（$0硬制約なら CF Images） ③受け入れ条件をバイト級→契約級互換に読み替え ④EXIF transpose を ver3 の正しい挙動として採用（ver2 実装は未適用）。材料 `docs/planning/c3/cl-07-thumbnail-options.md` | 未 |
| Resend DNS（CF トークン権限） | DNS 検証完了・`auth@it-hercules.uk` 実送信確認済（2026-07-11）。`RESEND_API_KEY` は D:\env\platform.env に格納済み | 済 |
| GMO 本番契約・live 昇格 | 本番口座 API の live 接続・実入金照合（`GMO_CONNECTOR_MODE=live`）。**本番初入金時に C4 (ii) 残余 1 点（U-code の remarks 文字変換の有無）を確定し evidence §9 を追記**（第11回裁定・sandbox では検証手段なしと実機確定） | 未 |
| collector ingest 実鍵投入 | `COLLECTOR_PRIVATE_KEY_PEM`（Ed25519 秘密鍵）生成・`COLLECTOR_PUBLIC_KEYS` 登録・本番 `INGEST_URL` 配線 | 未 |
| 公開の実施 | repo / OSS スナップショットの実際の公開 | 未 |
