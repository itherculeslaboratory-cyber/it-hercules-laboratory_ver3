---
id: plan-c8-full-run
title: C8 全機能実装完了ラン 計画(T-38)
date: "2026-07-16"
status: draft
---

# PLAN — C8 全機能実装完了ラン

> 由来: ユーザー指示3件(2026-07-16)= ①GMOあおぞら→PayPay統一の調査+要件/設計修正 ②要件定義書の全機能を実装完了まで(Fable ultracode・18h枠・最大並列・Fable不要作業はOpus/Sonnet) ③UIはusecase-driven(なぜその画面が必要か)+最高品質。
> 台帳: `D:\claude\00-hq\TASK-LEDGER.md` T-38。事前リサーチ: 並列9エージェント(PayPay web一次情報×2+Opus統合裁定・GMO依存マップ・735件実装インベントリ+Opus敵対検証・裁定待ち37問回収・UI資産棚卸し・要件批評トップ10)。

## 0. 裁定入力と自走条件

- 裁定入力 = `docs/planning/rulings/round-16-question-sheet.html`(**51問・全問に推奨案つき**)。回答受領後、ruling-record として round-16 を registry/srs へ反映してから実装に入る。
- 未回答の質問は推奨案を採用して自走(Q-META-01 承認が前提)。
- 停止するのは人間ゲート5種(公開・実鍵/本番鍵・金銭・物理治具・撤回台帳復活)のみ。不可逆・対外操作は実行直前に一言報告。

## 1. スコープ(既定=質問シートの推奨案)

| 区分 | 内容 | 件数 |
|---|---|---|
| 必達 | 第1波 実装対象の残(partial 68+design_only 46+not_started 56) | 170件 |
| ベストエフォート | 第2波 実装対象(design_only 46+not_started 126+partial 1) | 約173件 |
| 除外 | g08動画系(video-prepブランチ管轄)/ V3-OBS-32+machines-environment-io(別セッション実装中)/ constraint・思想(lint/文書で担保)/ hold(round-16裁定に従う)/ 人間ゲート本体 | — |

- 重要5画面の残り2画面 = market-trade / knowledge-thread の再構築(`docs/planning/c7/wireframes-core5.md` §3/§5 が正本)を UI レーンの先頭に置く。
- round-15 新要件(V3-IND-35 割り出し予約・V3-MKT-61 ブロック取引不可・V3-MKT-20 匿名配送差替・V3-GOV-35 拡張)は市場レーンに統合。

## 2. 現状インベントリ(2026-07-16・Opus敵対検証済み・信頼度高)

全735件: implemented 57 / partial 71 / design_only 96 / not_started 277 / constraint(制約・思想)216 / hold 14 / human_gate 2 / rejected 2。

- 全量: セッション scratchpad `inventory.jsonl`(コミットしない。必要になれば `docs/planning/c8/` に生成スクリプトごと正式化)。
- 注意: 要件IDタグの grep による下限値。IDタグ無しで書かれた実装は not_started 側に落ちる。

## 3. PayPay 移行(既定=方式D)

一次情報調査の要点:

1. **「PayPay」は別会社2つ** — PayPay銀行(旧ジャパンネット銀行)と PayPay株式会社(QR決済/OPA)。契約・API・サンドボックスすべて別。
2. **PayPay銀行**: 個人事業主が単独契約できるリアルタイム入金Webhookが確認できず(振込専用口座はAPI通知なし+新規契約停止中)、sunabar相当サンドボックス無し、API料金非公開・最短6〜7週審査 → **現行のGMO入金照合を再現できない**。
3. **PayPay決済(OPA)**: 個人事業主可・開発サンドボックスあり・手数料1.98%(取引額比例)・昆虫生体の直接禁止規定なし(昆虫店の導入実例あり)。未確認P0=①生体審査承認 ②C2C分配可否 ③資金決済法該当性。

方式比較(A=PayPay銀行へ全面移行 / B=OPA一本化 / C=併用 / D=決済のみPayPay追加・銀行GMO維持)の結論: **D推奨**(非破壊・10年コスト最小・生体リスクを決済レイヤーに局所化)。最終裁定は Q-PAY-01。

実装内容(D承認時):
- 即時(裁定不要): `apps/api/src/economy-constants.ts` の 0.08→0.05 追従(round-15伝播漏れ)+対応TC、srs §2.05 ヘッダの旧8%誤記修正。
- 設計+モック+sandbox: PayPay OPA アダプタ(`paypay-connector`)を GMO connector と同じ接続層分離パターンで新設。本番接続はP0クリア+人間ゲートまで着手しない。
- 文書: `docs/planning/b2-research/research-paypay-api.md` 新設(調査正本)、cutover-readiness/status.md の決済節更新、registry/srs は round-16 で反映。
- GMO webhook系 planned route 6本は「GMO本番契約後に着手」を維持(OQ-ROUTE-02 推奨)。

## 4. 要件改善バッチ(Opus批評トップ10)

裁定要=Q-REQ-01〜06(Truthバックアップ先/クラッチ二層採番/失効方式/5%母数/2FA/外部依存アダプタNFR)。裁定不要4点=Q-REQ-07で一括承認を取り自走反映(書込レート制限+クォータ/バッチ監視・ハートビート/「憲法」用語分離+5%宣言正本パス/エクスポート二層採番+grilling→要件環流CRフロー)。

## 5. レーン構成(並列・モデル割当)

| レーン | 内容 | モデル | 依存 |
|---|---|---|---|
| L0 即時修正 | economy-constants 5%+TC・srs誤記・status.md鮮度回復 | sonnet | なし(裁定前に着手可) |
| L1 市場バックエンド | V3-IND-35 予約マッチング(market transfer/match route 再設計)・V3-MKT-61・V3-MKT-20・no-pay/猶予キャンセル・成立2方式の状態機械・V3-GOV-35拡張 | sonnet×2 → opus批評 | round-16(D節・OQ-MKT/ROUTE) |
| L2 市場UI+知の広場UI | wireframes §3/§5 → screen-def+renderer拡張。ihl-ver2 `ihl-ui-catalog` の視覚移植(Q-UI-01) | sonnet×2 → スクショ目視+参照比較 | round-16(Q-UI-01) |
| L3 認証・失効 | 数字コードverify route(OQ-ONB-03)・onboarding残route廃止処置・KVデニーリスト失効(Q-REQ-03) | sonnet | round-16 |
| L4 第1波残要件消化 | g02個体(クラッチ二層含む)/g03知識/g04経済/g05ガバナンス/g06認証多言語/g07UIUX をクラスタ単位で | sonnet×クラスタ → opus批評 | round-16 |
| L5 要件・文書整合 | round-16 の ruling-record 反映(検算必須)・改善バッチNFR・grilling環流CR・tc-coverage-c8 | sonnet | 回答受領 |
| L6 全画面磨き | mockup対応の残20画面+dispute/signup screen-def 新設・impeccable監査・WCAG | sonnet | L2の型確立後 |

- 批評家ゲート(納品条件): 各レーン成果物 = 独立批評家(opus reviewer)+機械GATE(`npm run lint`/`npm test`/`pytest -q`/`npm run e2e`)+UIは実ブラウザスクショの目視(本番パリティ基準・D:\mockups / ihl-ui-catalog と並べて比較)。
- Fable はレーン統合・設計判断・最終レビューのみ。実装・調査に使わない。

## 6. 検証

1. `npm run lint` 20 GATE 全緑 / `npm test` / `pytest -q` / `npm run e2e -w apps/web` 全緑
2. 要件↔TC 対照を `docs/planning/c8/tc-coverage-c8.md` に出す(自動化可能分の green 率)
3. registry 件数検算(ruling-record の必須手順)
4. UI: 全対象画面のスクショを `docs/planning/c8/screens/` に保存し、参照(mockup/catalog)との並置比較で目視ゲート

## 7. 人間ゲート(残・本ランでは止まらず一覧提出のみ)

- 既存: 公開の実施 / GMO本番契約・live昇格 / collector実鍵 / 月次cron実デプロイ / cutover実行(VPS解約含む) / 最終画面打鍵チェック
- 新規: PayPay P0問い合わせ3点の送信 / PayPay OPA developer アカウント登録 / Truthバックアップ先(B2等)の契約作成(Q-REQ-01承認時)

## 8. 別セッションとの棲み分け

- 触らない: `tests/fixtures/csv-import-golden/`・`screen-defs/device.json`・usecase-driven-design.md の machines-environment-io 節・V3-OBS-32。
- OQ-LB-02(put-if-absent vs source-count)の裁定結果は当該クラスタに影響するため、コミットメッセージで明示共有する。
- main へのコミットは小さく高頻度・push 前に rebase。

## 9. 進行・報告

- コミット: 自律実行理由+参照 `plan-c8-full-run` を全コミットに付す。シークレット混入 grep を commit 前に実施。
- 完了報告: ①☑/◐+成果物の具体パス ②確認アクション(開くファイル・押すボタン) ③残(人間ゲート分離)。TASK-LEDGER T-38 とメモリを更新。
- 進捗追跡(C8ラン進捗追跡機構): 実装コミットは対応する `docs/planning/c8/progress.json` の該当エントリの `status`/`commits` を**同コミットで**更新し、`node scripts/render-c8-progress.mjs` を再実行して `progress.md` を再生成すること。乖離は `--check` で検出される。
