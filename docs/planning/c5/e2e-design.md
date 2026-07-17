---
id: c5-e2e-design
title: C5 機能別 E2E 設計（条件分岐網羅・依存ゲート）
date: "2026-07-11"
status: active
---

# C5 機能別 E2E 設計（K8）

> 対象要件: V3-AIP-49（実 UI E2E）・V3-AIP-50（ScreenDef スナップショット）・V3-AIP-34（Spec-Driven スレッド契約）。
> 参照: `docs/planning/c5/design-c5.md §K8`・`apps/web/e2e/observation.spec.ts`（ハーネス正本）・`tests/cl-04-route-matrix.test.ts`（権限整合パターン）。
> 本書は「何を、どの条件分岐まで、どのハーネスで検証するか」を機能別に固定する設計書であり、実装は各 spec/test ファイルが正本。

## 0. 方針

- **実 UI を通す。** モックの DOM ではなく、ScreenDef Renderer が正本 `screen-defs/*.json` を描画した実画面を、実ブラウザ（Chromium）で駆動する。
- **実 Truth に着地する。** E2E は wrangler dev（local mode = R2 をメモリ上でシミュレート＝E2E の FakeR2）を相手に「入力→実行→保存」を通貫し、保存は投影の都度再計算で読み戻して確認する（常駐 DB を SSOT にしない・不変条項①）。
- **依存未達は skip + 停止報告。** 描画対象の screen-def や spec を別クラスタ（K3/K4/K6）が所有し未産出のとき、当該 E2E は `test.skip` で明示し `[STOP]` 行を出力する。assert を弱めて緑にはしない。依存が landed した瞬間に自動で有効化される（ファイル存在で分岐）。

## 1. ハーネス（observation.spec.ts 再利用）

| 要素 | 実体 | 備考 |
|------|------|------|
| 認証 | 画面内 dev-login ボタン（`開発トークンでログイン`） | HttpOnly セッション Cookie が Next rewrite 経由で same-origin に流れ、以降の protected 呼び出しを Cookie だけで認証 |
| 描画 | ScreenDef Renderer（`/s/[screen]`） | `screen-defs/*.json` を実 UI 化。ノード型は Renderer カタログのみ |
| 永続 | wrangler dev local R2 | append-only Truth。E2E の FakeR2（in-memory） |
| ハイドレーション | `waitForLoadState("networkidle")` | クライアント bundle 装着前の native submit を防ぐゲート |

## 2. 機能別 E2E と条件分岐網羅

### 2.1 観測ライフサイクル（`observation.spec.ts`・V3-AIP-49 参照実装・稼働中）

dev-login → 観測ドメイン選択 → capture（写真添付）→ obs-detail → individual-detail → QR 発行 → `/qr/<token>` 物理ラベル解決 → 同一個体で 2 回目 capture → 履歴 2 件。

| 分岐 | カバー |
|------|--------|
| 写真あり / なし | 1 回目=写真あり（blob round-trip・naturalWidth>0）、2 回目=写真なし |
| 新規個体 / 既存個体 | subject_ref 新規 → QR resume で既存文脈へ |
| 認証あり / なし | API スイートで未認証 401（AUTH_REQUIRED）を対で確認 |

### 2.2 UGC 翻訳のネットワーク不変（`ugc-translate.spec.ts`・V3-I18-06・稼働中）

翻訳アフォーダンスは on-device / on-demand のみ。実ブラウザで押下し**外向きリクエスト 0 件**を監視。

| 分岐 | カバー |
|------|--------|
| viewer 言語 ≠ 原文言語 | アフォーダンス表示 → 押下 → 原文保持・ネットワーク 0 |
| viewer 言語 = 原文言語 | アフォーダンス非表示（`shouldOfferTranslation`=false） |

### 2.3 market 実 UI E2E（`apps/web/e2e/market.spec.ts`・V3-AIP-49・**依存 skip**）

dev-login → market screen-def を Renderer で描画 → 宣言フォームを contract-driven に入力（text→run-unique 値・number→`1`・select→先頭実オプション）→ 実行 → 保存を screen-def 自身の read endpoint（list `source_path`）を same-origin Cookie で叩き HTTP 200 で確認。

| 分岐 | カバー |
|------|--------|
| 依存 screen-def あり | 描画→入力→実行→保存 read-back 200 |
| 依存 screen-def なし（現状） | `test.skip` + `[STOP]` 停止報告（K3 `screen-defs/market.json` 未産出） |
| フォーム field 型 | text / number / select を型別に投入（screen-def 契約駆動・フィールド名ハードコードなし） |

> **依存ゲート（design-k8 §5 / 批評家 F3）**: 描画対象は K3 の `screen-defs/market.json`。K8 はハーネス + FakeR2 mock まで所有し、screen-def は所有しない。現状 `market.json` は不在（`market-trade.json` は E2E 対象の正本ではない）→ skip。

### 2.4 ledger 実 UI E2E（`apps/web/e2e/ledger.spec.ts`・V3-AIP-49・**依存 skip**）

dev-login → ledger screen-def を Renderer で描画 → append-only 台帳の read endpoint を Cookie で読み戻し 200（投影都度再計算・CL-12）。台帳が計上フォームを宣言する場合のみ入力→実行し read-back を再確認。

| 分岐 | カバー |
|------|--------|
| 依存 screen-def あり | 描画→read-through 200（→フォームありなら計上→read-back 200） |
| 依存 screen-def なし（現状） | `test.skip` + `[STOP]` 停止報告（K4 `screen-defs/ledger.json` 未産出） |
| 台帳が read-only / 計上フォームあり | フォーム有無を分岐（read-only 台帳でも read-through で成立） |

### 2.5 Spec-Driven スレッド契約（`tests/spec-thread.test.ts`・V3-AIP-34・**依存 skip**・vitest）

知の広場スレッド screen-def（K6 正本）を (1) `screendef.schema.json`（draft 2020-12）で validate、(2) 触れる全 API endpoint が deny-by-default（未認証 401 AUTH_REQUIRED・実 app 駆動＝cl-04 パターン）、(3) `navigation.json` 到達性を確認。

| 分岐 | カバー |
|------|--------|
| スレッド spec あり | schema validate + 権限整合 + ナビ到達性 |
| スレッド spec なし（現状） | `describe.skipIf` + `[STOP]` 停止報告（V3-AIP-34 spec JSON 未明文化） |
| endpoint の GET(read) / POST(write) | list `source_path`（GET）と form api action（POST）を method 別に抽出し各々 401 判定 |

> スレッド spec は route に `/t/{thread_id}` 等のスレッド id か screen_id に `thread` を含む screen-def として構造的に発見する（K6 のファイル名に依存しない）。

### 2.6 ScreenDef スナップショット GATE（V3-AIP-50・K8 内 生成器）

`screen-defs/*.json` 全画面の Renderer スナップショットを `gen-screendef-snapshots.mjs` が生成し、`codegen:check`（`--check`）で正本乖離を fail。実行の詳細は当該生成器と `apps/web/src/renderer/screendef-snapshots.test.tsx`（GENERATED）が正本。

## 3. 人間ゲート・分母除外（未実装を「動く」と書かない）

| 項目 | 状態 | 分母 |
|------|------|------|
| V3-AIP-49 staging 昇格 | 実 UI E2E は用意。staging 実デプロイは対外操作＝人間ゲート | 昇格の実施は分母除外 |
| V3-AIP-80 OSS 公開の実施 | 公開文書は起草済（`docs/public/*`）。公開日の実施は人間ゲート | 実公開は分母除外 |
| V3-AIP-34 スレッド spec | 検証 TC は用意。spec 正本 = K6 成果物 | K6 未達の間 skip |
| market / ledger 実走 | **C8時点で依存解消・skipなし実走**（下記2.7参照。本節2.3/2.4は執筆時点=C5のskip状態の記録として残す） | — |

> **鮮度注記(2026-07-17・C8)**: 上記表の「market / ledger 実走」行は C5 執筆時点(K3/K4未着地でskip)の記録。C8 現在は `npm run e2e -w apps/web` で **60/60 全緑**(HANDOFF-c8-session2.md §0)。2.3/2.4 の本文はC5当時の設計意図として保持し、実行状態は本節末尾2.7を正とする。

### 2.7 C5 以降に追加された E2E spec の網羅索引（V3-AIP-49 残余仕上げ）

C5 執筆時点の本設計書は observation/ugc-translate/market/ledger/spec-thread/screendefの6件のみを個別記述していたが、C6〜C8で以下5件が追加された。**個別の条件分岐網羅節（2.1〜2.6 と同粒度の記述）はまだ未執筆** — 本表はその存在と一文要約のみを機械的に索引化したもの(ギャップを見える化する目的。プレースホルダの空節を新設して「網羅した」と偽装しない)。

| spec | 一文要約 |
|---|---|
| `individual-detail.spec.ts` | 個体詳細スライスA: 判断3指標→親カーブ欠損→血縁chip差替→タイムライン訂正 |
| `knowledge-thread.spec.ts` | 知の広場スレッド: 閲覧(avatar/body/cite)→返信→stance投票→スレ主resolve |
| `market-trade-lifecycle.spec.ts` | market-trade 2アクター通貫: draft→publish→apply(match)→pay_declare→pay_confirm→ship→receive |
| `obs-register-batch.spec.ts` | 観測登録スライス2: F3(割り出し)→F4(まとめて記録)→F5b(確認)→F6b(完了) |
| `obs-register.spec.ts` | 観測登録スライス1: F1(検索)→F2(Δ)→F5→F6(Δ+次の目安)→F1(候補チップ) |
| `obs-search.spec.ts` | 検索スライスA: 着地→絞り込み(体長レンジ)→0件緩和→保存検索→バスケット→計測グリッドへ |
| `screen-sweep.spec.ts` | 全screen-def横断スイープ(resource-load エラー検出) |

残余: 上記7件それぞれに 2.1〜2.6 と同粒度の「条件分岐網羅」節を書く作業（決済フロー・GOV-35・クラッチ二層等、C4以降に追加された機能の分は本表にすら未索引 — さらに広い残課題）。1セッションでの網羅完了は見積り超過のため、次点の担当がこの表に追記する形で継続する。

## 4. 実行

```bash
npm test -w apps/web            # vitest（Renderer/スナップショット単体）
npx playwright test -w apps/web # E2E（observation/ugc-translate 実走・market/ledger は依存未達で skip）
npx vitest run spec-thread      # tests/（依存未達で skip・landed で自動有効化）
```
