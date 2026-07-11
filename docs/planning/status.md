---
id: V3-STATUS
title: 本番状態・直近タスク・人間ゲート
date: "2026-07-11"
status: draft
---

# ステータス（spine #5）

> 更新のたびに「今どこ / 次 / 人間ゲート」の 3 節を最新化する。設計正本の永久配置はしない（Working）。

## 今どこ

**Phase C6 完了(cutover 直前で停止 — 実施は人間ゲート)**(2026-07-11 — `docs/planning/c6/REPORT-ver3-phase-c6-2026-07-11.md`)。突合ハーネス(`scripts/reconcile-harness.mjs`・GET 限定強制・TC10)+66 route readiness 表+**staging 実機稼働**(`ihl-api-ver3-staging.…workers.dev`・dev R2・cron 無効・deny-by-default/dev token を実測)。**P0 所見: 旧 API は保護 route 12 本を未認証開放**(新側が正・`cutover-readiness.md` §3)。E2E 実走で結合実バグ(form→confirm 値引き継ぎ欠落)を検出し汎用 draft 機構で根治 → `npm run e2e` 3/3 green。批評家 FAIL 指摘(§0 過大主張)を反映して納品。**残る cutover 5 手順は全て人間ボタン**(`cutover-readiness.md` §4)。

**Phase C5 完了・納品**（2026-07-11 — `docs/planning/c5/REPORT-ver3-phase-c5-2026-07-11.md`）。第1波 S+A 帯の実装対象 **139 件を 8 クラスタ(K1〜K8)で消化**(分析母集合 190 件・hold 2 件停止報告)。**wave 受入 PASS: 自動化可能 TC 145 本中 green 142 = 97.9% ≥ 80%**（`docs/planning/c5/tc-coverage.md`・deferred-e2e 3 本は C6 staging 実走・missing 0）。知の広場は **PROTECTED のまま実装完了**(Zulip型topic+Polis型投影・第8回裁定準拠)+ G1〜G6 判定材料完成（`plaza-gate-materials/`・HG-KN-01〜08 は帰宅後裁定）。第12回裁定で LICENSE=Apache 2.0 確定・トークン目標 4500k。**納品前 再走実測**: `npm run lint` **20 GATE 全 OK**(C4 の 9 → +11) / `npm test` = **851 passed・3 skipped**(C4 215 → +636) / `pytest -q` = **11 passed・1 skipped**。批評家実績: 分析11群+設計8+実装16+広場6+横断監査2 — 横断監査 major 1(GATE数誇張)・minor 1(生NULバイト)は納品前に修正済み。

**Phase C4 完了（完了条件 (ii) は第11回裁定で受入クローズ — 残余1点は本番初入金で確定）**（2026-07-11 — `docs/planning/c4/REPORT-ver3-phase-c4-2026-07-11.md`）。完了条件 (i)(iii) 成立・(ii) は設計どおり「実疎通実測 + 擬似入金実行のみ停止報告」で成立。台帳+カルマ二層（投影で残高/カルマ都度再計算・`GET /me/ledger` 本人スコープ・Fibonacci カルマ判定 V3-KRM-02）+ GMO sunabar 照合（接続層 `sunabar`/`live` 分離・名前照合ポーリング・実 sunabar 疎通 HTTP 200 実測・擬似入金の作成 API 機構を契約確定・振込実行は権限分類器が拒否し停止報告）+ マーケット骨格（`ihl.mkt.listing.v1`・出品/一覧/詳細 route）。批評家 2 観点/1 ラウンドで major（人間ゲート正本表への反映漏れ）解消。**納品前 再走実測**: `npm run lint` 9 GATE 全 OK（codegen 19 files in sync）/ `npm test` = apps/api 1 + tests 199 + apps/web 15 = **215 passed / 0 failed**（C3 183→+32）/ `pytest -q` = **4 passed, 1 skipped**（C3 から変化なし）。

**Phase C3 完了（CL-07 裁定待ちを除く）**（2026-07-11 — `docs/planning/c3/REPORT-ver3-phase-c3-2026-07-11.md`）。完了条件 (i)(ii) 成立・(iii) は設計どおり分母除外（CL-07 は C3 冒頭の人間裁定待ち — 材料 `docs/planning/c3/cl-07-thumbnail-options.md` 提出済み・実装未着手）。類似検索の決定論梯子（whitelist→subset→embedding・`ladder_stage`・768次元遮断）+ CL-06/10 実サンプル TC（ihl-ver2 UAT サインオフ実個体ID + 実QRコードパス）+ collector ingest（Ed25519 署名認証）+ SwitchBot 単発コレクタ + wiki-ingest ruri-v3-70m backend（PyTorch/ONNX cosine=1.0 一致検証済み）。批評家 2 観点/1 ラウンドで major（design-c3.md 未追跡）解消。**納品前 再走実測**: `npm run lint` 9 GATE 全 OK / `npm test` = apps/api 1 + tests 167 + apps/web 15 = **183 passed / 0 failed**（C2 156→+27）/ `pytest -q` = **4 passed, 1 skipped**（skip は torch 依存 parity TC・bare CI の意図的挙動）。SwitchBot 実 API smoke（`--fetch-only`）は成功（実機 13 台検出）。

**Phase C2 完了・納品**（2026-07-11 — `docs/planning/c2/REPORT-ver3-phase-c2-2026-07-10.md`）。受け入れ **(a)(b)(c)(d) 全成立**・批評家 4 観点/3 ラウンド通過（第3パス fix3 で §7 実ブラウザ通貫 E2E を Chromium 実機で実走・green 実測して (c) を解消）。認証（署名付きステートレスセッション）+ 観測コア API 8 route + ScreenDef Renderer（データ束縛ランタイム）+ CL-04 57route 照合 + CL-08 vector_length=384 訂正。**納品前 再走実測**: `npm run lint` 9 GATE 全 OK / `npm test` = apps/api 1 + tests 140 + apps/web 15 = **156 passed / 0 failed** / `npm run e2e -w apps/web` = 実ブラウザ **2 passed / 0 failed**（`docs/planning/c2/e2e-evidence.md`）。要件 ID↔TC = `docs/planning/c2/tc-coverage.md`（自動化可能 16/16 green = 100%・V3-FND-02 のみ否定的アーキ制約で分母除外）。

**Phase C1 完了**（2026-07-10 — `docs/planning/c1/REPORT-ver3-phase-c1-2026-07-10.md`）。

- CL-01〜13 negative TC 全 green（`tests/cl-01`〜`cl-13`・13 ファイル / 101 テスト。RED→GREEN 逐語ログ = `docs/planning/c1/tc-red-green-log.md`）。以降これが回帰条件 — 1 本でも赤に転じた PR は fail（開発計画 R-03）。
- R2 put-if-absent は**実機検証済み・mode=storage**（実バケット `ihl-ver3-truth-dev` で 2 重 put → 先勝ち・後発 null。証跡 = `docs/planning/c1/r2-put-if-absent-evidence.md`）。append-only はストレージ層強制。
- append-only 基盤 = `packages/truth`（envelope 検証 / TruthStore put-if-absent / contracts 移植）+ `apps/api` deny-by-default + `POST /events`。
- schemas/ → TS 型 codegen（`scripts/codegen-schemas.mjs`）が root lint チェーン = CI で回る（完了条件③）。

## 次（最優先）

**人間ゲートの裁定祭り(帰宅後)** — AI 側の第1波作業は cutover 直前まで完了。裁定待ちを重要順に:

1. **HG-KN-01〜08 + 知の広場本採用 Go**(材料 `docs/planning/c5/plaza-gate-materials/` — g1 に推奨・差し替えコスト付き)
2. **cutover 5 手順**(`docs/planning/c6/cutover-readiness.md` §4 — 本番 R2 バインド→リハーサル→片系切替→ver3-live 停止→VPS 解約)。**P0: 旧 API の未認証開放 12 route の即時是正 or cutover 前倒しの判断**(§3)
3. planned 残 route の扱い(onboarding 2・gmo webhook 系・market transfer/match の実装 or 廃止)
4. hold 2 件(V3-FND-13/V3-AIP-61)・統一ロール taxonomy・月次経済 cron 実デプロイ・GMO 本番契約・collector 実鍵・公開の実施

AI 側の残(裁定不要・次ラン): deferred-e2e の staging 実走 green 化・projectThread O(n) の channel スコープ化・projectHub 5 軸化(スキーマ連結キー導入波)。

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
| GOV-09 admin ゲート | **クローズ(2026-07-11)**: K2 実装済みの `requireRole("operator","admin")` を `POST /api/v1/gov/flags` に配線(fail-closed)。非 operator(DEV_TOKEN roles=[]/member セッション)→403+副作用ゼロの negative TC 3 本緑化(`tests/gov-flag.test.ts`)。統一ロール taxonomy の人間裁定は別途(この 2 role 名は運用者ゲートとして据置可能) | 済 |
| 知の広場 HG-KN-01〜08 + 本採用 Go | 8 論点の判定材料は `docs/planning/c5/plaza-gate-materials/g1-ia-decision.md` に推奨・根拠・差し替えコスト付きで完成(2026-07-11)。実装は PROTECTED で完了済み — 解除・公開のみ人間 | 未(帰宅後) |
| 月次経済 cron の実デプロイ | wrangler.toml `[triggers]` 配線+`config/consented-crons.json`(consented_by=pending-human-gate)まで済。デプロイ=常駐実行開始=人間ゲート | 未 |
| 公開の実施 | repo / OSS スナップショットの実際の公開 | 未 |
