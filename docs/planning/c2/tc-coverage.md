---
id: tc-coverage-c2
title: C2 MVP 要件ID ↔ TC 対応表（受け入れ(b) の分母）
date: "2026-07-11"
status: active
---

# C2 要件ID ↔ TC 対応表

> 設計契約: `docs/planning/c2/design-c2.md` §8（受け入れ (b)「MVP-実装要件 ID の自動化可能 TC 80% 以上 green」の分母）。
> 判定は実測（`npm run lint` 9 GATE 全 PASS / `npm test` = apps/api 1 + tests 140 + apps/web 14 = **155 passed / 0 failed**・2026-07-11 再走）。ログ捏造禁止（受け入れ (d)）。
> 「TC」= 当該要件を担保するテスト、またはスキーマ正本を lint/vitest が validate している経路（本 repo 確立パターン: 要件 → それを規定する `schemas/` 正本 → CL/observation テスト or codegen-validators GATE）。

## 対応表（17 ID）

| # | 要件ID | 要件（要旨） | 対応 TC / GATE | 状態 |
|---|--------|------------|----------------|------|
| 1 | V3-FND-01 | R2 Truth は INSERT ONLY・同一キー再 put 409 | `tests/cl-01-insert-only.test.ts`・`tests/cl-12-ledger.test.ts`・`tests/observation.test.ts`「same capture_id posted twice → 409」 | green |
| 2 | V3-FND-02 | 永続正本は R2 のみ・常駐 DB を SSOT にしない（投影は都度再計算） | **自動化可能 TC なし（下記「分母除外」参照）** | 除外（構造的担保） |
| 3 | V3-FND-15 | 系譜/再現性メタ（run_id/schema_version/input_hash/created_at 等）を必須付与 | `tests/cl-02-provenance.test.ts`（正本 `schemas/frozen/provenance.schema.json`・requirement_ids に V3-FND-15 明記。必須欠落→invalid / value_origin enum 外→invalid） | green |
| 4 | V3-AUT-01 | マジックリンク認証（要求→送信→verify→セッション） | `tests/auth.test.ts`「magic-link + verify」群 | green |
| 5 | V3-AUT-03 | 署名付きステートレスセッション（v1.payload.sig / HMAC-SHA256 / JWT ライブラリ無 / localStorage 不使用） | `tests/auth.test.ts` negative 群（改竄/別鍵/期限切れ/purpose 混同）・Cookie 属性検証 | green |
| 6 | V3-AUT-05 | dev トークン認証 + メールアダプタ（Resend HTTP / dev フォールバック） | `tests/auth.test.ts`「DEV_TOKEN bearer → actorId」「dev_magic_token はフラグ時のみ」 | green（**部分** — §「部分カバー」①） |
| 7 | V3-AUT-17 | 書き込み系はイベント actor_id をセッション主体で強制（本人スコープ） | `tests/auth.test.ts`「STORED envelope provenance.actor_id === session principal」「client-forged provenance.actor_id は上書き」・`tests/observation.test.ts`「stamps session actor_id」 | green |
| 8 | V3-OBS-22 | 観測 5 機能（収集/写真/詳細/親個体/QR）が動き R2 書込 | `tests/observation.test.ts`（captures/upload/detail/image/history/qr 全 15 本）・`apps/web/e2e/observation.spec.ts`（実 worker + R2 シム パイプライン） | green（**部分** — §「部分カバー」②：画面層は未接続） |
| 9 | V3-OBS-43 | 観測を中心 Input・観測セッションを R2 へ INSERT（ITO） | 正本 `schemas/events/obs-photo.schema.json`（x_ihl_req=V3-OBS-43）を `tests/observation.test.ts` upload/detail と `codegen-validators --check` GATE が validate | green |
| 10 | V3-OBS-01 | 5 ドメイン分岐（biology/mineral/digital/place/custom） | `tests/observation.test.ts`「invalid domain → 400（5-domain enum）」 | green |
| 11 | V3-OBS-18 | 観測テンプレ fork（forked_from） | `tests/observation.test.ts`「POST then GET returns the appended template」「out-of-enum item kind → 400」 | green |
| 12 | V3-OBS-03 | 種はユーザー確定のみ（species_confirmed_by=user） | `tests/observation.test.ts`「species_confirmed_by != 'user' → 400」 | green |
| 13 | V3-IND-01 | 個体観測履歴（subject_ref filter） | `tests/observation.test.ts`「returns only captures whose subject_ref matches」 | green |
| 14 | V3-UIX-16 | ThemePack light/dark（トークン + prefers-color-scheme/data-theme） | `apps/web/src/renderer/renderer.test.tsx` ThemePack describe（prefers-reduced-motion）・`scripts/check-contrast.mjs` GATE（両テーマのトークン AA） | green |
| 15 | V3-UIX-17 | ScreenDef を Renderer が描画（7 画面） | `apps/web/src/renderer/renderer.test.tsx`「renders every one of the 7 MVP screen-defs」 | green |
| 16 | V3-UIX-18 | ScreenDef スキーマ検証 + raw 色/任意色クラス GATE | lint `validate-schemas.mjs`（screendef schema validate）・`scripts/check-ui-tokens.mjs` GATE（negative TC = renderer.test.tsx「raw color GATE detects a violation」） | green |
| 17 | V3-UIX-81 | 共通層で 7 state + a11y + AA 一括担保（個別画面に書かせない） | `apps/web/src/renderer/renderer.test.tsx`（button state/keyboard/focus/disabled/loading/error 群）・`scripts/check-contrast.mjs` GATE（AA コントラスト） | green |

## 判定（受け入れ (b)）

- 自動化可能 ID = 16（V3-FND-02 を除く 17 件）。うち green = **16**。→ **16 / 16 = 100%**（≥ 80% 充足）。
- V3-FND-02 を分母に含めても **16 / 17 = 94%**（≥ 80% 充足）。
- 回帰条件（受け入れ (a)）: CL-01〜13 negative TC は全 13 ファイル残存・全 green（cl-08 は +2 追加のみ、削除ゼロ）。

## 分母除外（理由付き）

- **V3-FND-02（永続正本 R2 のみ・常駐 DB を SSOT にしない）**: これは「X を使わない」型の否定的アーキテクチャ制約であり、単一の正の TC では意味のある担保にならない（DB が無いことを 1 テストで証明できない）。構造的に担保される — 観測投影は全て R2 `list`/`get` からの都度再計算（`apps/api/src/observation-routes.ts`・常駐 DB 依存ゼロ）、依存に DB ドライバ無し、不変条項①/AGENTS.md が禁止事項として GATE 対象。自動化可能 TC の分母から除外する。

## 部分カバー（green だが sub-scope に既知ギャップ・別途裁定/後続）

1. **V3-AUT-05（dev ボタン + メールアダプタ）**: API 層（DEV_TOKEN Bearer・dev_magic_token フラグ・Resend アダプタ 1 ファイル）は実装・green。未検証: (a) ログイン画面内「開発トークンでログイン」ボタンの実ブラウザ動作、(b) Resend 実鍵送信（実鍵は D:\env に無し=人間ゲート）。→ `docs/planning/c2/e2e-evidence.md` §6-2 に開示。
2. **V3-OBS-22（画面で動き R2 書込）**: API 層 5 機能は observation.test.ts + 実 worker E2E で green。未達: 画面層（ScreenDef 7 枚は描画のみ・API 未接続）。根本原因はブラウザ→API クロスオリジン認証（§4.3 未規定 = 設計裁定事項）+ Renderer 土台のランタイム・データ束縛/アクション連鎖未実装。→ `docs/planning/c2/e2e-evidence.md` §1/§6-1・`docs/planning/c2/REPORT-ver3-phase-c2-2026-07-10.md` §「未達・設計裁定待ち」に開示。
