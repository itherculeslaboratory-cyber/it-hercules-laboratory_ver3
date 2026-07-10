---
source: "docs/planning/ver3/b2/research-gmo-aozora-api-v1.md@4a56cf6"
id: research-gmo-aozora-api-v1
title: GMOあおぞらネット銀行 API 調査（銀行連携・入金照合基盤）
date: 2026-07-10
status: draft
decision: "GMOあおぞらネット銀行APIを正式採用。設計〜結合検証は sunabar(無料sandbox)で完結させ、本番は振込入金明細照会ポーリング照合(CL-11互換)を最小構成、振込入金口座(VA)+Webhookを拡張経路とする。"
sources_count: 12
revalidate_before_impl: true
related: [V3-MKT-14, CL-11]
---

# GMOあおぞらネット銀行 API 調査レポート（Phase B2 deep-research）

調査日: 2026-07-10。読者: 将来の AI と開発者。
本調査は **API キーの値・所在を一切扱わない**（sunabar キーはユーザー格納済み・本書の対象外）。

## 1. 結論（選定）

GMOあおぞらネット銀行 API を ver3 の銀行連携として採用する（V3-MKT-14 の裁定を追認）。設計・結合検証は無料 sandbox「sunabar」で完結可能であり、入金照合の技術経路は二段構えとする。**最小構成（Phase 1）**: 円普通預金口座に対する「振込入金明細照会 API」（`GET /accounts/deposit-transactions`）を数分周期でポーリングし、レスポンスの `applicantName`（振込依頼人名・半角カナ48桁）に対して CL-11 の振込コード `deriveTransferCode(userId)=SHA-256→Base36→U-XXXX` を照合する。**拡張構成（Phase 2）**: 振込入金口座（バーチャル口座）をユーザーごとに発行（`POST /va/issue`、基本上限2,000口座）し、Webhook「振込入金口座_入金明細通知」（イベント種別 `va-deposit-transaction`、HMAC-SHA256 署名対応）で即時照合に移行する。この場合は口座自体がユーザーを識別するため名前照合が不要になる。本番利用は API 接続契約（審査あり）が前提で、実鍵投入・実入金確認のみ人間ゲートとする。

## 2. 根拠（出典付き・全て 2026-07-10 アクセス）

1. **sunabar は口座保有者なら審査なし・無料で銀行 API を試せる。** 公式「sunabar はじめてガイド」に、当社口座保有者が対象、サービスサイトの「開発者向け」タブから sunabar 用 ID/PASS を取得、「審査なしでご利用が可能」、トークンはポータルの画面からコピー（ポータル最終ログインから30日超で失効）と明記。参照系（残高・入出金明細）・更新系（振込・振替）・ATM入出金の擬似体験が可能。
   出典: https://gmo-aozora.com/sunabar/tutorial/01.html

2. **入出金明細照会/振込入金明細照会の公式仕様が公開されており、照合に使える項目が確定している。** オープンAPI仕様書 法人口座編 v1.20.1（2026/4/21、公式PDFを直接取得・本文確認）より:
   - `GET /accounts/transactions`（入出金明細照会）: 認証は `x-access-token` ヘッダ。レスポンスに `transactionDate` / `transactionType`(1=入金,2=出金) / `amount` / `remarks`(摘要、例「振込 アオゾラ タロウ」) / `balance` / `itemKey`（口座ID毎の明細キー、明細データ timestamp μs）。取得上限500件/回、`nextItemKey` でページング、取引昇順。期間未指定なら当日分、`dateFrom`/`dateTo` で期間指定可（取引初回まで遡及可の記載）。
   - `GET /accounts/deposit-transactions`（振込入金明細照会）: **入金のみ**を返し、`applicantName`（依頼人名・半角カナ）・`paymentBankName`・`ediInfo`・`itemKey` を含む。**CL-11 の U-XXXX 照合はこの API の `applicantName` が第一候補**（`remarks` パースより構造的）。
   - ベースURL: `https://api.gmo-aozora.com/ganb/api/corporation/v1`（本番）/ `stg-api.gmo-aozora.com`（開発）。
   出典: https://gmo-aozora.com/business/api-cooperation/pdf/api-spec-corporate.pdf

3. **振込入金口座（VA）は API で一括発行でき、命名・上限も仕様確定。** 同仕様書 v1.20.1 より: `POST /va/issue` は 1リクエストで1,000口座まで発行可、期限型/継続型を選択、`追加名義カナ`（口座名義=登録法人名カナ+任意40文字以内、前置き/後置き指定可）。`GET /va/deposit-transactions`（VA入金明細照会）は `remitterNameKana` を返し、対象期間は**照会日から6ヶ月以内**。`POST /va/status-change` で停止・再開・削除（100件/回）。総発行上限は「基本は2,000口座までですが、利用状況に応じて引き上げていただける」（スマートバンク社導入事例の本文引用）。
   出典: https://gmo-aozora.com/business/api-cooperation/pdf/api-spec-corporate.pdf / https://gmo-aozora.com/business/case/case41/

4. **Webhook（イベント通知）が公式提供されており、ポーリング必須ではない。** オープンAPI仕様書 イベント通知編 v1.20.0（2025/10/13、公式PDFを直接取得・本文確認）より: イベント種別 `va-deposit-transaction`（振込入金口座への入金明細通知）を配信先URLへ POST。セキュリティは x-access-token 検証 + HMAC-SHA256 シグネチャ（`x-webhook-signature`、オプション）+ Basic認証（オプション）。リトライは指数バックオフで最大1時間、超過で配信停止状態へ自動移行、**停止のまま14日経過したメッセージは削除**。未送信分は `GET /unsentlist/va-deposit-transaction` で一括回収可。「順序性は保証されません」「同一メッセージが重複して配信される場合があります」と明記（冪等処理は `itemKey`/`messageId` で行う）。**対象は法人口座および個人事業主口座のみ、個人口座は対象外**。スコープに `personal:virtual-account`（個人事業主口座）が明記されている。
   出典: https://gmo-aozora.com/business/api-cooperation/pdf/api-spec-webhooks.pdf

5. **コストは不変条項①（コスト最小）に適合。** 銀行APIは無償28種・有償7種で、入出金明細照会・振込入金明細照会・VA発行/一覧/入金明細照会・イベント通知(Webhook)系は**無償側**に含まれる。手数料ページ（法人・個人事業主）: 同行宛振込無料、他行宛130円/件、口座維持手数料の記載なし。「リアルタイム振込・入金サービス」ページに VA は「初期費用も月額利用料も無料」と明記。
   出典: https://gmo-aozora.com/business/api-cooperation/apilineup.html / https://gmo-aozora.com/business/contents/fee.html / https://gmo-aozora.com/business/service/apipayment.html

6. **レート制限は契約時提示方式で、429 の挙動が仕様化されている。** 仕様書共通仕様に「1つのクライアントID（client_id）につき、APIのリクエスト制限があり、高負荷・高頻度となるAPI接続は禁止」「リクエスト制限の詳細については、接続通知書に記載」、超過時は HTTP 429 + `{"errorCode": "WG_ERR_154", "errorMessage": "APIの利用上限を超過しています。"}` を返却と明記。**公開資料に具体的な回数は書かれていない**（実装時に接続通知書で確定させる再検証項目）。
   出典: https://gmo-aozora.com/business/api-cooperation/pdf/api-spec-corporate.pdf

7. **本番利用条件: 現時点では法人限定と公式記載（個人事業主の扱いに矛盾あり・要確認）。** 提供概要ページに「現時点では、本番環境において当社APIをご利用いただけるのは法人のお客さまに限定」「sunabar においては個人・法人のお客さまにご利用頂けます」、実利用には契約が必要（問い合わせ: open-api@gmo-aozora.com）。一方でイベント通知仕様書(根拠4)には個人事業主口座用スコープとレスポンス例が明記され、手数料ページも「法人・個人事業主」区分。**直接 API 契約が個人事業主口座で可能かは銀行への直接確認が必要**（§6 リスク参照）。接続は「ヒアリングシート記入→接続審査→API利用契約」のフロー（検索結果で申込ページ https://gmo-aozora.com/business/api-cooperation/api-application.html を確認）。
   出典: https://gmo-aozora.com/business/api-cooperation/provisionpolicy.html

8. **実装知見（第三者）: ポーリング照合の実装前例が複数ある。** Qiita 記事（sirolab）は sunabar で入出金明細照会を **10秒周期ポーリング + `itemKey` 比較**で新規入金を検知し LINE 通知する Python 実装を公開。公式テックブログ「sunabar 入門編」は sunabar の実ホストが `api.sunabar.gmo-aozora.com` であり、開発者ポータルのモック（`api.gmo-aozora.com/ganb/api/simulator`）と異なる点を注意喚起。Zenn の令和トラベル事例は GMOあおぞら VA を基盤とする GMO-PG 経由の入金 Webhook 自動照合の運用実績（隣接事例）。
   出典: https://qiita.com/sirolab/items/9613f312833134dad396 / https://gmo-aozora.hatenablog.com/entry/2023/01/20/101648 / https://zenn.dev/reiwatravel/articles/860aa90ae5df24

補助出典（アクセス済み）: VA の概念説明 FAQ https://help.gmo-aozora.com/faqs/6686541befe214ffd63426e4/ 、sunabar 公式トップ https://gmo-aozora.com/baas/sunabar/ （本文はJS描画で取得不可、検索スニペットで概要のみ確認）。

## 3. 比較した代替案と却下理由

| 代替案 | 却下理由 |
|---|---|
| **住信SBIネット銀行 API** | 法人向け直接 API は原則パートナー企業（更新系は電子決済等代行業者登録前提の色が濃い）。**無料の公開 sandbox に相当するものがなく**、個人開発規模で設計検証を先行できない。V3-MKT-14 で GMOあおぞら採用が既に裁定済み。 |
| **GMOペイメントゲートウェイ（銀行振込・バーチャル口座）** | 令和トラベル事例(根拠8)の通り Webhook 込みで実績はあるが、決済代行の加盟店契約・手数料が乗り、不変条項①（コスト最小）に反する。裏側は同じ GMOあおぞら VA であり、直接契約できるなら中間層は不要。 |
| **freee/マネーフォワード等の会計API経由の明細取得** | 明細取得はできるが、リアルタイム性・振込依頼人名の粒度・VA発行が制御できず、照合基盤としては間接層が増えるだけ。 |
| **手動照合（ネットバンキング画面 + 人力）** | ver3 の自動照合要件(CL-11)を満たさない。ただし**入金確認の人間ゲートとしては残す**（自動照合の突合先として月次で目視監査）。 |
| **Webhook 一本足（ポーリング廃止）** | 却下ではなく「単独では不採用」。公式仕様に順序非保証・重複配信・1時間リトライ超過で配信停止・14日でメッセージ削除と明記(根拠4)されており、**照合の正はあくまで明細照会 API、Webhook はトリガー**とする。 |

## 4. ver3 要件との接続

- **V3-MKT-14（銀行連携・正式採用裁定済み）**: 本調査はその技術裏付け。sunabar で設計検証→本番契約の二段導入が可能であることを確認した。
- **CL-11（deriveTransferCode 互換）**: `SHA-256→Base36→U-XXXX` の振込コードは、振込入金明細照会の `applicantName`（半角カナ・最大48桁）先頭付与で照合可能。半角カナ許容文字（英字・数字・記号の変換規則は仕様書「振込許容文字」参照）のため、**U-XXXX は英大文字+数字のみで構成する現行設計と整合**。VA 移行後は口座番号照合となりコード照合は冗長化（保険）に降格できる。
- **不変条項への適合**:
  - **① コスト最小**: sunabar 無料・審査なし。必要 API は全て無償28種の範囲。VA 初期・月額無料。振込を「受ける」だけなら銀行手数料は発生しない（振込手数料は送金者負担）。
  - **② fork文化**: REST/JSON + `x-access-token` ヘッダのみの薄い HTTP クライアントで実装可能。公式 SDK 依存なし。fork 先も口座と sunabar ID があれば同一コードで再現可。
  - **③ append-only**: 明細は `itemKey`（μs タイムスタンプ、口座ID毎に一意）付きで返るため、照合台帳を itemKey 主キーの append-only ログにでき、Truth ストアの UPDATE/DELETE 禁止と整合。重複配信(Webhook)も itemKey 冪等で吸収。
  - **④ 人間ゲート**: 本番 API 契約申込・実鍵投入・初回実入金確認・VA 実発行のみ人間ゲート。それ以前の全設計・結合テストは sunabar で AI が完結可能。
  - **⑤ 批評家ゲート**: 本レポートは `revalidate_before_impl: true`。§6 の再検証項目を実装 PR の批評家チェックリストに転記すること。

## 5. リスクと再検証条項

**本レポートの情報は 2026-07 時点。** 仕様書は 法人口座編 v1.20.1（2026/4/21）・イベント通知編 v1.20.0（2025/10/13）に基づく。実装着手時に以下を再検証すること。

1. **個人事業主口座での直接 API 契約可否**（最重要）: 提供概要は「本番は法人限定（現時点）」、イベント通知仕様書は個人事業主スコープを明記、と公式資料間に不整合。open-api@gmo-aozora.com へ直接確認するまで本番アーキテクチャを確定しない。法人限定のままなら「法人成り or 名前照合ポーリングのみ（VA・Webhookなし）で運用可能か」を再裁定。
2. **レート制限の実数**: 接続通知書（契約時交付）でしか確定しない。ポーリング設計は暫定で控えめ（例: 振込入金明細照会を 1〜5 分周期、429 時は指数バックオフ）とし、契約後に接続通知書の値で上書きする。sunabar 側の制限も公開値なし（sunabar の仮想口座は10個までという情報は検索スニペット由来・未一次確認）。
3. **接続審査の所要と要件**: ヒアリングシート→接続審査→契約。審査基準は非公開。利用目的（観測支援サービスの入金照合）で通るかは申込時に判明。
4. **sunabar と本番の差分**: ホスト名（`api.sunabar.gmo-aozora.com` vs `api.gmo-aozora.com`）、トークン取得方法（ポータル画面コピー vs OAuth2.0/OIDC フロー）、トークン失効条件（sunabar はポータル最終ログイン30日）が異なる。**認証層を差し替え可能に分離**しておくこと。sunabar に VA API・Webhook がどこまで実装されているかは実キーでの疎通確認が必要（本調査ではキー不使用のため未確認）。
5. **仕様書バージョン更新**: 1.18.0（2025/05）で入出金明細照会に振込依頼情報項目が追加されるなど活発に更新されている。実装直前に https://gmo-aozora.com/business/service/api-specification.html から最新版 PDF を再取得。
6. **Webhook 運用の落とし穴**: 配信停止→14日で明細メッセージ削除。停止検知（通知配信状況照会 `GET /subscribe-status`）と未送信明細取得 API を含めた自己修復ループ、および日次の明細照会 API との突合バッチを設計に含めること。
7. **手数料・料金改定**: 2025-2026 に振込手数料の改定あり（他行宛130円は 2026-07 時点）。口座維持手数料は「記載なし」であり無料の明文確認は取れていない。

## 6. 未解決の問い

1. 個人事業主口座で銀行 API の**直接**接続契約（VA・Webhook 含む）は締結できるか？（公式資料間の不整合、銀行へ直接確認要）
2. sunabar 環境で VA 発行 API とイベント通知（Webhook）はどこまで動作するか？（実キー疎通は人間ゲート後の次フェーズ）
3. 接続通知書に記載されるレート制限の実数（照会系の許容ポーリング周期）はいくつか？
4. 振込依頼人名の先頭に U-XXXX を付与する運用で、送金元銀行によって依頼人名が切り詰め・変換されるケース（48桁超・小文字・記号）はどの程度あるか？（実入金での実測が必要）
5. VA 上限 2,000 口座の引き上げ条件と、期限型 VA の有効期限デフォルト値は？（一覧照会レスポンスに `expireDateTime` はあるがデフォルト期間の公開記載を未確認）
6. 接続審査で求められるセキュリティ要件（鍵管理・通信元 IP 固定等）は Sakura VPS 構成で満たせるか？
