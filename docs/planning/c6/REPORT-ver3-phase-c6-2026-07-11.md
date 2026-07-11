---
id: REPORT-ver3-phase-c6-2026-07-11
title: Phase C6 実行レポート(cutover 直前まで)
date: "2026-07-11"
status: active
---

# REPORT: Phase C6(strangler 切替準備 — cutover 直前で停止)

> 自律ラン(ultracode・2026-07-11・C5 と同一セッション)。到達上限 = HANDOFF-c5-c6 §3(cutover 実施・本番 DNS/route 変更・VPS 解約・本番書込は行わない)。

## 1. 成果物

| 成果物 | 内容 |
|--------|------|
| `scripts/reconcile-harness.mjs` + `tests/reconcile-harness.test.ts` | 新旧 API 突合ハーネス。**GET 限定を構造上強制**(非 GET は抽出段階で除外+二重ガード)・path param 置換・許容差 whitelist・直列実行・JSON レポート。fixture TC 10 本 green |
| `docs/planning/c6/cutover-readiness.md` | 66 route の readiness 表・残差分全件説明・**人間が押すボタン 5 手順** |
| `docs/planning/c6/reconcile-noauth.json` / `reconcile-authnew.json` | 突合の生実測(2 走・証跡) |
| staging 実機 | `https://ihl-api-ver3-staging.it-hercules-laboratory.workers.dev`(wrangler --env staging・dev R2・cron 無効・dev 生成 secret のみ) |
| E2E 通貫の green 化 | 観測通貫 E2E を K1/K4 導線(obs-entry 直行+OBS-25 確認画面)へ追随 → **結合実バグ検出→根治**(下記) → `npm run e2e` **3 passed / 0 failed** |

## 2. 実測ハイライト

- **P0 所見**: 旧 API(ver3-live)は保護 route **12 本を未認証で開放**(me/preferences・home/summary 等が実データ JSON を 200 返却 — `reconcile-noauth.json` 実測)。新 API は全て 401(deny-by-default を staging 実機で確認)。cutover の実利的根拠。旧側是正は本番変更=人間裁定。
- **結合実バグの検出と根治**(E2E 実走の成果・ユニット TC では不可視だった):
  1. ScreenDef renderer の form→navigate がフォーム値を捨てていた(obs-confirm に params 未達)→ 汎用 draft 機構(sessionStorage・V3-BBS-35 と同型)+ query params 運搬を renderer に実装。
  2. obs-confirm の登録 POST が body なし 400 → `body_from:"draft"` で draft 再生+写真 2 段 POST 維持。
  3. projectIndividual が master 無し個体を 404 → capture/life-event の参照からも投影(append-only 参照投影・不変条項①整合)。
- 突合結果(GET 30 本): 一致 3・ver3 新規 3・param 供給待ち 9・旧未認証開放 12・仕様差 2(/auth/session は新の public 設計が正)・旧側既存障害 1(gmo/va-deposit/unsent 503)。**新側欠落(old-only)ゼロ**。

## 3. 停止報告(対外操作の記録と事故是正)

- staging デプロイ 2 回(承認済み・workers.dev のみ)。**初回でトップレベル [triggers] cron が staging に継承される事故を検出** → 即時 `[env.staging.triggers] crons=[]` で無効化・再デプロイ(**継承中の cron 実行 0 回**・次回予定 15:00 UTC 前に撤去)。cron 実稼働開始は引き続き人間ゲート。
- secret 投入は新規生成 dev 値(SESSION_SECRET/DEV_TOKEN)のみ。実鍵は不使用・不投入。
- ver3-live へは GET のみ計 2 走(承認済み範囲)。書込系 API・本番 DNS・Pages・VPS には一切触れていない。

## 4. 人間ゲート待ち(cutover 本体)

`cutover-readiness.md` §4 の 5 手順(本番 R2 バインド→突合リハーサル→書込系片系切替→ver3-live 停止→VPS 解約)。全て人間の実施。param 9 route の値レベル突合はリハーサル時に `--params` で実 ID を与えて再走する。

## 5. 最終 GATE(コーディネータ再実測)

lint 20 GATE / npm test / pytest / npm run e2e(3 passed)— 実測値は commit メッセージと status.md に記録。
