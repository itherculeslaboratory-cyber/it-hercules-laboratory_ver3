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

**コア green・受け入れ (a)(b)(d) 成立 / (c) は API 層 + 画面層とも実装・単体緑（§7 実ブラウザ通貫クリックスルーのローカル再走のみ残・下記「第2パス」）。**

最終 GATE 統合ラン（2026-07-11 第2パス実測・ログ捏造なし）:
- `npm run lint` = 9 GATE 全 OK（filename / generated / agents-sync / schema / frontmatter / codegen --check / codegen-validators --check / ui-tokens / contrast）。
- `npm test` = apps/api 1 + tests 140 + apps/web 14 = **155 passed / 0 failed**（第2パスで renderer +4・auth dev-login +2、合計 +6）。

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

## 批評家 major 再指摘の解消（第2パス・2026-07-11）

第1パスで「設計裁定待ち」に据え置いた批評家 major 2 件（V3-OBS-22 画面層 form↔schema 不整合 / §7 UI 通貫の dev ボタン・transitions）を**本パスで実装解消**した。据え置き根拠だった「クロスオリジン認証モデルは設計 §4.3 未規定 = 人間裁定」は再検討の結果**過剰保守**と判断: 同一オリジン dev プロキシ（next rewrites）は可逆な dev-infra 選択で人間ゲート 5 種のいずれでもなく、不変条項④「上記以外の可逆な作業は承認を待たず進めよ」の対象。修正の大半は vitest（renderer=jsdom / API=node）で機械検証可能で、⑤ に反しない。

- **推奨修正 (a) 同一オリジン dev プロキシ**: `apps/web/next.config.mjs` に rewrites `/api/:path*`→worker、`apps/web/src/lib/api.ts` を同一オリジン相対に変更。HttpOnly `ihl_session` cookie がクロスサイト cookie / CORS 無しで流れる。
- **推奨修正 (b) obs-entry form↔schema 整合**: `screen-defs/obs-entry.json` に `domain` select（5 ドメイン）追加 + 計測フィールドをドット名 `measurements.0.item|value` へ + form `props.static` で `measurements.0.kind="number"` / `species_confirmed_by="user"` を注入。Renderer の FormNode が static+ドット名を `{domain, measurements:[{item,kind,value}], ...}` に整形して POST（renderer.test「shapes the form body」で実測）。CORS 解決後 400 にならない。
- **推奨修正 (c) Renderer ランタイム**: `renderer.tsx` に `{{params.id}}` 補間・node `source_path` の mount 時 GET・`list` の `bind_items`/`item_text` データ束縛・action レスポンス束縛（`result`）・**api アクション成功時の transitions[] 消費**（レスポンス id をクエリで次画面へ）を追加。`individual-detail.json` の観測履歴カード/QR 値/QR 発行 path のハードコードを撤去し実データ束縛へ（履歴 = `GET /individuals/{{params.id}}/observations`、QR path = `{{params.id}}` 補間、QR 値 = `{{result.token}}`）。renderer.test 4 本で実測。
- **推奨修正 (d) dev ボタン**: `POST /api/v1/auth/dev-login`（公開・DEV_TOKEN 設定時のみ・本番 404）を新設し、固定 dev actor（`deriveActorId("dev@ihl.local")`・§1.4）のセッション cookie を 1-click 発行。`login.json` の dev ボタンをこの route へ。auth.test 2 本（発行成功 + 本番 404）で実測。
- **残る局所ゲート（人間/後続 — 縮小済み）**: 実ブラウザでの §7 通貫クリックスルー再走行（wrangler dev + next dev + Chromium）は**本サンドボックス非搭載のため未再走**。観測 spec（`e2e/observation.spec.ts`）は第1パスの正直な二層分割のまま（UI 土台描画/遷移 + API 直叩きデータパイプライン）で green。本パスの変更で通貫は**成立可能**になり renderer/API 単体で検証済みだが、実ブラウザ緑判定はローカル Playwright 実行での確認事項（⑤ に従い盲目で緑主張しない）。

## （第1パス時点の据え置き記録・履歴保存）

> 以下は第1パス時点の判断記録。上記「第2パス」で解消済み。誠実性のため削除せず残す。

批評家 major 4 件（画面層 API 未接続 / dev ボタン非機能 / §7 UI 通貫 / obs-entry form↔schema 不整合）は**単一の根本原因**に収束する。第1パスでは実装せず設計裁定へ回した。

- **根本原因**: (1) ブラウザ(:3000)→API(:8787) クロスオリジン認証モデルが設計 §4.3 未規定。(2) Renderer 土台にランタイムのデータ束縛/アクション連鎖/レスポンス駆動遷移が無い。
- **現状の担保**: 観測 5 機能は API 層 + 実 worker E2E（`e2e-evidence.md` §4）で green・R2 書込実在確認済み。UI 土台は 7 画面描画 + 遷移配線を vitest/E2E で green。

## 成果物一覧

- 第1パス修正: `apps/api/src/index.ts`（/events actor 強制）・`apps/web/src/app/globals.css`（primary AA）・`package.json`（lint に contrast GATE）・`tests/auth.test.ts`（AUT-17 強化 +1 TC）。
- 第1パス新規: `scripts/check-contrast.mjs`・`docs/planning/c2/tc-coverage.md`・本レポート。
- **第2パス修正（批評家 major 2 件解消）**: `apps/web/src/renderer/renderer.tsx`（ランタイム: 補間/mount-fetch/list 束縛/result 束縛/transitions 消費/dev proxy 相対 URL）・`apps/web/next.config.mjs`（rewrites proxy）・`apps/web/src/lib/api.ts`（同一オリジン）・`apps/web/src/app/s/[screen]/page.tsx`（searchParams→params）・`apps/api/src/auth-routes.ts`（dev-login）・`apps/api/src/index.ts`（PUBLIC_ROUTES に dev-login）・`screen-defs/obs-entry.json`（domain+measurements 整形）・`screen-defs/individual-detail.json`（実データ束縛・ハードコード撤去）・`screen-defs/login.json`（dev ボタン→dev-login）。
- **第2パス新規 TC**: `apps/web/src/renderer/renderer.test.tsx`（+4: body 整形/transitions/list 束縛/param+result 補間）・`tests/auth.test.ts`（+2: dev-login 発行/本番 404）。

## 残課題（人間裁定/後続）

1. **§7 実ブラウザ通貫の再走**: wrangler dev + next dev + Chromium での 1 セッション通貫クリックスルー。本サンドボックス非搭載につきローカル実行で確認（renderer/API 単体は緑・通貫は成立可能）。
2. **人間ゲート**: Resend 実鍵投入（実鍵 D:\env 未存在）。
