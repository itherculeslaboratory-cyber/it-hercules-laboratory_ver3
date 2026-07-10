---
id: REPORT-ver3-phase-c2-2026-07-10
title: Phase C2 実行レポート — 認証(署名付きステートレスセッション) + 観測コア MVP + ScreenDef Renderer 土台 + 批評家指摘修正
date: "2026-07-11"
status: active
---

# REPORT: ver3 Phase C2

> 自律実行（ultracode C2）。設計正本: `docs/planning/c2/design-c2.md`。計画正本: `ihl-ver2/docs/planning/ver3/b3/ver3-開発計画-v1.md` §3.1 C2。
> 本レポートは feat(c2) 全コミットが参照する `REPORT-ver3-phase-c2-2026-07-10`（従来欠落 = 批評家 major。本パスで起票）。

## 状態

**コア green・受け入れ (a)(b)(d) 成立 / (c) は API 層成立・§7 UI 通貫は設計裁定待ち（下記）。**

最終 GATE 統合ラン（2026-07-11 実測・ログ捏造なし）:
- `npm run lint` = 9 GATE 全 OK（filename / generated / agents-sync / schema / frontmatter / codegen --check / codegen-validators --check / ui-tokens / **contrast[新設]**）。
- `npm test` = apps/api 1 + tests 138 + apps/web 10 = **149 passed / 0 failed**。

## C2 で実装したもの（feat(c2) コミット群）

| commit | 内容 |
|--------|------|
| f9099b0 | obs/ind イベント data スキーマ 4 本 + screendef スキーマ + CL-08 vector_length=384 訂正（対応 TC セット） |
| 1409b6b | 認証（署名付きステートレスセッション v1.payload.sig / HMAC-SHA256 / WebCrypto のみ）+ CL-04 57route 照合 |
| 97345b6 | 観測コア API §3 — captures/upload/detail/image/templates/individuals-obs/QR 8 route + TruthStore putBlob/putEventAt/get/list |
| f565128 | ScreenDef Renderer 土台（apps/web）+ ThemePack + 7 screen-defs + ui-tokens GATE |
| a61de0e | E2E 観測ライフサイクル実測 + workerd 統合バグ 2 件（ajv 事前コンパイル化・navigate マッピング）修正 |

## 批評家指摘の修正（本パス）

| 指摘（severity） | 対応 |
|------------------|------|
| **tc-coverage.md 欠落 + FND-02/FND-15/OBS-43 の TC 不明（blocker）** | `docs/planning/c2/tc-coverage.md` 起票。17 ID↔TC を精査 — V3-FND-15 は `cl-02-provenance.test.ts`（frozen provenance 正本の requirement_ids に明記）、V3-OBS-43 は `obs-photo.schema.json`（x_ihl_req）を observation.test.ts + codegen-validators GATE が validate、で **green と判明**（批評家が見落とした経路）。V3-FND-02 のみ正の TC 無し → 否定的アーキ制約として分母除外を理由付き明記。判定 16/16=100%（FND-02 含めても 94%）。 |
| **/events actor_id 偽装余地（V3-AUT-17・major）** | `apps/api/src/index.ts` の `/events` で、格納前に `provenance.actor_id` をセッション主体で強制上書き（クライアント偽装 provenance を Truth へ通さない）。`tests/auth.test.ts` の V3-AUT-17 TC を「格納された envelope の provenance.actor_id」検証へ強化 + 偽装上書き negative TC 追加（+1 本）。 |
| **ライトテーマ コントラスト AA 未達（V3-UIX-81/§4.3・major）** | `--civ-primary` を `#0f9d6b`→`#0b7a55` に（white-on 3.47→5.34 / on-bg 3.35→5.16、いずれも >=4.5:1 AA）。`scripts/check-contrast.mjs` を新設し lint チェーンへ配線 — 両テーマの全 text/bg トークン対を AA 検査（批評家指摘「検査 GATE 不在」を解消・回帰ガード化）。ダークは元から AA 合格・不変。 |
| **参照レポート実在せず（トレーサビリティ・major）** | 本ファイル起票。 |

## 未達・設計裁定待ち（受け入れ (c) の UI 通貫・V3-OBS-22 画面層）

批評家 major 4 件（画面層 API 未接続 / dev ボタン非機能 / §7 UI 通貫 / obs-entry form↔schema 不整合）は**単一の根本原因**に収束する。本パスでは実装せず設計裁定へ回す（不変条項④「設計未確定を実装するな」+ ⑤「検証されないものは納品しない」— 本サンドボックスにブラウザ E2E スタック無く盲目実装は不可）。

- **根本原因**: (1) ブラウザ(:3000)→API(:8787) クロスオリジン認証モデルが設計 §4.3 未規定（= 設計判断事項。`e2e-evidence.md` §6-1 で既に開示）。(2) Renderer 土台にランタイムのデータ束縛/アクション連鎖/レスポンス駆動遷移が無い（§4 は「土台」と規定）。この 2 つが無いと dev ボタン認証・obs-domain→obs-entry の domain 文脈伝播・individual-detail の実データ表示・transitions 消費が成立しない。
- **推奨修正（後続 C2.1/C3・小さい順）**: (a) 同一オリジン dev プロキシ（next rewrites で `/api/*`→worker）で cookie を通す（`e2e-evidence.md` §6-1 推奨と一致）。(b) obs-entry の form を schema 整合へ（`{domain, measurements:[{item,kind,value}]}`）+ domain 文脈伝播。(c) Renderer にレスポンス駆動遷移（transitions 消費）+ mount 時データ取得。(d) dev ボタンを magic-link(dev フラグ)→verify 連鎖へ。
- **現状の担保**: 観測 5 機能は API 層 + 実 worker E2E（`e2e-evidence.md` §4）で green・R2 書込実在確認済み。UI 土台は 7 画面描画 + 遷移配線を vitest/E2E で green。

## 成果物一覧

- 修正: `apps/api/src/index.ts`（/events actor 強制）・`apps/web/src/app/globals.css`（primary AA）・`package.json`（lint に contrast GATE）・`tests/auth.test.ts`（AUT-17 強化 +1 TC）。
- 新規: `scripts/check-contrast.mjs`・`docs/planning/c2/tc-coverage.md`・本レポート。
- 開示強化: `docs/planning/c2/e2e-evidence.md`（form↔schema 不整合・placeholder path 追記）・`docs/planning/status.md`（C2 反映）。

## 残課題（人間裁定/後続）

1. **設計裁定**: クロスオリジン認証モデル（同一オリジン dev プロキシ採用可否）。UI 通貫の前提。
2. **後続実装（C2.1/C3）**: 上記「推奨修正」(b)(c)(d) — Renderer データ束縛 + 画面 API 接続。
3. **人間ゲート**: Resend 実鍵投入（実鍵 D:\env 未存在）。
