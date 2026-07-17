---
id: V3-DOC-EXTERNAL-ADAPTER-NFR
title: 外部依存の交換可能アダプタ NFR(現状監査+縮退動作)
date: "2026-07-17"
status: active
requirement_ids: [V3-FND-35]
---

# 外部依存の交換可能アダプタ NFR

> V3-FND-35(round-16 Q-REQ-06 承認): 決済(PAY.JP/PayPay/銀行)・配送(日本郵便URL)・
> メール(Resend)・IoT(SwitchBot)等の外部依存を交換可能な薄いアダプタで包み、依存
> ごとに縮退動作(フォールバック)を1行で定義する。PayPay 移行検討(round-16)自体が
> このリスクの実例 — 10年運用の間に必ず1度は外部サービスの仕様変更/廃止が起きる
> 前提で設計する。

## NFR(不変条項)

1. **薄いアダプタ経由でのみ外部 API を呼ぶ** — ルート/バッチから直接 fetch しない
   (呼び出しは 1 ファイルに閉じ込め、差し替え時の変更点をそのファイルに限定する)。
2. **モード切替(env 駆動)** — 各アダプタは `MODE`(test/sunabar 等の無料段階 → live
   本番)を env で切り替え、`live` への昇格は実鍵投入(人間ゲート)まで明示 throw する。
3. **縮退動作 1 行** — 実鍵/設定が無い場合はクラッシュせず no-op/フォールバックする
   (下表)。無音失敗ではなく、呼び出し元が判別できる形(false/null/501等)で返す。
4. **実鍵はコミットしない** — 実値は `D:\env\platform.env` / wrangler secret のみ
   (AGENTS.md 禁止事項)。`.env.platform.example` に型だけを置く。

## 現状アダプタ監査

| 依存 | アダプタファイル | モード切替 | 縮退動作(1行) |
|---|---|---|---|
| 銀行振込照合(GMO あおぞら) | `apps/api/src/gmo-connector.ts` | `GMO_CONNECTOR_MODE=sunabar`(無料sandbox・既定)/`live`(人間ゲート) | retired(round-16)後は route 非マウント — 呼ばれない。READ ONLY 設計のため呼ばれても資金移動は起きない。 |
| 決済(PAY.JP) | `apps/api/src/payjp-connector.ts` | `PAYJP_MODE=test`(既定)/`live`(人間ゲート threw) | `PAYJP_SECRET_KEY` 未設定 or `live` かつ人間ゲート未通過 → 例外を投げ呼び出し元(fee-routes.ts)が 501 相当で扱う(charge 作成 API は元々呼ばない設計 = ゆるい請求は請求記録の発行のみ)。 |
| 決済(PayPay OPA) | 未実装(調査のみ・`docs/planning/b2-research/research-paypay-unification.md`) | — | 未接続 = P2P 決済は既定「銀行振込」のみ提示され PayPay 選択肢は表示されない(機能が丸ごと出ない、エラーにはならない)。 |
| メール送信(Resend) | `apps/api/src/mail.ts` `sendMagicLink` | `RESEND_API_KEY` 有無 | 未設定 → 送信 `{sent:false}` を返し例外を投げない(dev fallback は `dev_magic_token` 経路でログイン継続可)。 |
| 運用アラート(Resend) | `apps/api/src/mail.ts` `sendOpsAlert`(V3-FND-34) | `RESEND_API_KEY`+`OPS_ALERT_EMAIL` 両方必須 | いずれか未設定 → `{sent:false}` を返し例外を投げない(バッチ本体の失敗記録は Truth ハートビートに残るため通知が飛ばなくても検知経路は失われない)。 |
| 配送(日本郵便 URL 中継) | `apps/api/src/market-routes.ts`(`ship_link` kind)/`apps/api/src/market-settlement.ts` | アダプタ不要(外部 API を呼ばない設計) | IHL は住所/配送 API を一切呼ばず売り手が入力した外部 URL 文字列を非公開ボードで中継するのみ — 外部サービス側の仕様変更は IHL 側の処理に影響しない(URL 文字列を保存/表示するだけ)。 |
| IoT 観測(SwitchBot) | `components/collector-switchbot/`(Ed25519 署名 ingest・`apps/api/src/collector-routes.ts`) | `COLLECTOR_PUBLIC_KEYS` 登録有無(collector_id 単位) | 未登録 collector_id や検証失敗の署名 → 401 で何も保存しない(データ欠落は起きるが誤ったデータが Truth に紛れ込むことはない)。 |
| AI/LLM(将来接続予定) | `apps/api/src/ai-kernel.ts` | `IHL_AI_PROVIDER` 未設定=既定 OFF | 未設定 → 全タスクが `501 AI_DISABLED` を返す(不変条項①: LLM は既定 OFF)。 |
| Cloudflare R2 使用量(V3-CST-02) | `apps/api/src/costs-routes.ts`(`fetchR2Usage`) | `CF_API_TOKEN`/`CF_ACCOUNT_ID` 有無 | 未設定、または(将来)実 GraphQL クエリ未検証な間は常に `undefined` → `GET /api/v1/costs` は `config/running-costs.json` の `r2.manual_override_yen` へ degrade(`source:"manual"`)。実クエリ配線は実アカウントでの疎通検証後(人間ゲート隣接)。 |

## 差替時の確認手順

新しいプロバイダへ切り替える、または上表にない新規外部依存を追加する場合:

1. 上記 NFR 4 点を満たす専用アダプタファイルを 1 つ作る(既存ファイルへ直接 fetch を混ぜない)。
2. `MODE` env 切替 + `live`/本番昇格は人間ゲートまで明示 throw する設計にする。
3. 縮退動作 1 行をこの表に追記する(この文書がその依存の「効かなくなったらどうなるか」の唯一の参照先になるようにする)。
4. C-USB コンポーネント(`components/<name>/`)として onboard する場合は
   `docs/architecture/component-swap-checklist.md`(V3-FND-14)の 6 項目レビューも通す。
