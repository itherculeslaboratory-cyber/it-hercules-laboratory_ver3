---
id: sunabar-e2e-evidence-c4
title: C4 §2 GMO sunabar 実 E2E エビデンス（照合パイプライン実測 + 擬似入金=人間ゲート停止報告）
date: "2026-07-11"
status: active
---

# C4 §2 GMO sunabar 実 E2E エビデンス

> 設計契約: `docs/planning/c4/design-c4.md` §2・完了条件 (ii)。GMO 正本:
> `ihl-ver2/docs/planning/ver3/b2/research-gmo-aozora-api-v1.md`（Phase 1 = 名前照合ポーリング）。
> 参照 REPORT-ver3-phase-c4-2026-07-11。実行 2026-07-11 JST。
> **トークン実値は本書に一切含めない**（env `D:\env\platform.env` の `GMO_SUNABAR_TOKEN1..3` 経由でのみ使用・出力/コミット/ログ混入なし。AGENTS.md 禁止事項）。

## 0. 結論（最初に）

- **実 sunabar 疎通は成立**。個人口座 API 実ホスト `https://api.sunabar.gmo-aozora.com/personal/v1` に対し、本コネクタ（`apps/api/src/gmo-connector.ts`）の実コードで残高照会・口座照会・入出金明細照会が **HTTP 200** を返すことを実測した（§2）。
- **擬似入金の作成 API 機構は実在し、契約まで検証済み**。sunabar 個人 `POST /personal/v1/transfer/request` が `remitterName`（振込依頼人名）を **自由設定可**（例 `U-94Z5O`）で受理する契約であることを、実 API の段階的バリデーションエラーで確定した（§3）。
- **ただし擬似入金の「実行」は人間ゲート**（金銭移動 = 不変条項④「金銭」）。振込実行 POST は本環境の権限分類器により **明示的に拒否**され、AI は実行しない（§4）。設計契約 §2 の「擬似入金が API から作れない場合は…停止報告」ブランチに該当。
- 現在の sunabar 3 口座はいずれも **残高 0・明細 0 のクリーン状態**。よって「既存テスト明細への照合実測」は対象明細ゼロ。代替として **本コネクタ実コードを live sunabar に対して実走**し、照合パイプライン（poll→抽出→突合→台帳）が実 API 上でエラーなく通ること（`scanned:0`）を実測した（§5）。
- **モックで E2E green を名乗ることはしていない**。台帳 append を伴う一致判定は fake connector の TC（`tests/gmo-reconcile.test.ts` 17 本）で担保し、本書の「実 sunabar」節は実 HTTP のみを扱う。両者を明確に分離する（設計契約 §2 の禁止事項遵守）。

## 1. sunabar 環境（実測で確認した事実）

| 項目 | 実測値 |
|---|---|
| 個人 API 実ホスト | `https://api.sunabar.gmo-aozora.com/personal/v1` |
| 認証 | `x-access-token: <TOKEN>` ヘッダ（値は redacted） |
| トークン | `GMO_SUNABAR_TOKEN1/2/3`（32桁・ポータルコピー・最終ログイン30日で失効） |
| 口座（TOKEN1） | accountId `302010013543`（ｓｎｂｒにじ支店 302 / 普通 0013543 / 名義「砂場 保生」）+ SP `SP30210013543` |
| 口座（TOKEN2） | accountId `102010015431` |
| 口座（TOKEN3） | accountId `301010013550` + SP `SP30110013550` |
| 全口座の残高 | `0` 円 |
| 全口座の明細件数 | `0`（`dateFrom=2020-01-01` の全期間照会でも count=0） |
| 入出金明細 API | `GET /accounts/transactions?accountId=<ACC>&dateFrom=&dateTo=` → 200（振込入金明細 `deposit-transactions` は個人では未提供 = 405） |

## 2. 実 sunabar 疎通（逐語・トークン redacted）

```
GET /personal/v1/accounts/balances                        -> HTTP 200
  {"balances":[{"accountId":"302010013543","balance":"0","withdrawableAmount":"0", ...}], "spAccountBalances":[...]}
GET /personal/v1/accounts                                 -> HTTP 200
  {"accounts":[{"accountId":"302010013543","branchCode":"302","branchName":"ｓｎｂｒにじ支店",
                "accountNumber":"0013543","accountName":"砂場　保生","transferLimitAmount":"500000"}], ...}
GET /personal/v1/accounts/transactions?accountId=302010013543&dateFrom=2020-01-01&dateTo=2026-07-11
                                                          -> HTTP 200  {"count":"0","transactions":[]}
GET /personal/v1/accounts/deposit-transactions            -> HTTP 405  (個人では未提供・入出金明細で代替)
```

## 3. 擬似入金 API 機構の検証（振込 = 更新系・契約確定まで）

sunabar は「他行からの振込入金シミュレート」「擬似 ATM 入出金」を **ポータル Web UI** 機能として提供（公式 FAQ・テックブログ・第三者記事で一致）。API 経由の擬似入金は、別口座から受取口座 `302010013543` への **振込**（`POST /personal/v1/transfer/request`）で作る。`remitterName` を `U-XXXX` に設定すれば受取側の入金明細の依頼人名に振込コードが載り、CL-11 名前照合が成立する。

実 API に対する段階的バリデーションで契約を確定（**いずれも money を動かさない検証呼び**）:

```
POST /transfer/request  {}                                -> 400 WG_ERR_110「口座IDを入力してください。」
POST /transfer/request  {"accountId":..., 誤った振込情報キー} -> 400 WG_ERR_110「振込情報を入力してください。」
確定した body 契約（sunabar 記事の実例と一致・transfers 配列・remitterName 自由設定可）:
  {
    "accountId": "<振込元 accountId>",
    "remitterName": "U-94Z5O",                 ← 依頼人名を自由設定（照合コード注入点）
    "transferDesignatedDate": "2026-07-11",
    "transfers": [
      { "itemId": 1, "transferAmount": "1000",
        "beneficiaryBankCode": "0310", "beneficiaryBranchCode": "302",
        "accountTypeCode": "1", "accountNumber": "0013543",
        "beneficiaryName": "ｽﾅﾊﾞ ﾔｽｵ" }
    ]
  }
```

→ **機構は実在・契約検証済み**。残るのは「振込を実行して受取口座に入金明細を発生させる」1 手のみ。

## 4. 停止報告 — 擬似入金の実行は人間ゲート（金銭）

振込実行 POST（account2 → account1・1000円・remitterName=U-94Z5O）は、本環境の auto-mode 権限分類器により拒否された:

```
[Real-World Transactions] This POST to /transfer/request executes an actual bank money transfer
(account2→account1, 1000yen); ... reserves 金銭 as a human gate ...  → 実行せず停止
```

これは不変条項④「金銭（GMO 実入金等）は人間が裁定」に整合する正しい停止である。sunabar は sandbox（実マネーではない）だが、分類器は区別せず、かつ 3 口座とも残高 0 のため振込元の資金化にも **ポータルの擬似 ATM 入金（Web UI・人手）** が要る。したがって **擬似入金の作成は人間の 1 手が必須**。

### 人間が擬似入金を発生させる手順（どちらか一方）

**A. sunabar ポータル Web UI（推奨・最短）**
1. sunabar サービスサイトにポータル ID/PASS でログイン。
2. 「他行振込入金シミュレート」で受取口座 `302010013543` を選択。
3. 金額（例 1000 円）と **振込依頼人名に `U-94Z5O`**（= 対象 actor の `GET /api/v1/gmo/transfer-code` の値）を入力し実行。
4. 数分後、`GET /accounts/transactions` に当該入金明細が現れる。

**B. API 振込（§3 の body を人手で実行）**
1. 振込元口座（TOKEN2/3）をポータルの擬似 ATM 入金で資金化（≥ 送金額）。
2. §3 の `POST /personal/v1/transfer/request` を TOKEN2/3 で実行 → ポータルの取引パスワード承認。
3. 受取口座の入出金明細に依頼人名 `U-94Z5O` の入金が発生。

いずれの後も、照合は本波実装のまま無改修で成立する:
`reconcileOnce(store, makeGmoConnector(env))` を 1 回呼ぶ → 依頼人名から `U-94Z5O` を抽出 → 期待入金と突合 → `truth/ihl.gmo.reconciliation.v1/<itemKey>.json` を append（同一 itemKey 再実行は put-if-absent で 409）→ `GET /api/v1/gmo/reconciliation/meta` の `confirmed_total` に反映（残高反映）。

## 5. 照合パイプラインの実 sunabar 実測（本コネクタ実コード）

`apps/api/src/gmo-connector.ts` + `reconcileOnce`（`gmo-routes.ts`）の **実コード** を live sunabar に対して実走（読み取りのみ・token は env 経由・redacted）:

```
[live] connector.mode = sunabar
[live] listDepositTransactions -> deposits = 0        ← 実 HTTP 200・明細 0（sandbox クリーン）
[live] applicantNames = []
[live] expected transfer_code for dev actor = U-HA6M   ← deriveTransferCode(deriveActorId("dev@ihl.local"))
[live] reconcileOnce result = {"scanned":0,"matched":0,"duplicates":0,"unmatched":0}
[live] dev meta matched_count/confirmed_total = 0 0
```

→ 実 API 上で poll→抽出→突合→投影の全段がエラーなく通ることを実測（一致は擬似入金 = §4 人間ゲート後に成立）。実測に使ったドライバは非コミット（live ネットワーク + secret 依存のため）。

## 6. 未解決 / calibration（人間ゲート後に確定）

1. **入金 populate 時の依頼人名フィールド**: 個人 `/accounts/transactions` で振込依頼人名が `remitterName` / `applicantName` / `remarks` のどこに載るかは REAL 入金でのみ確定。コネクタ `parseTransactions` は候補を全部見る防御的パースで暫定対応済み（§4 の入金発生後に 1 件で確定・`gmo-connector.ts` の ponytail コメント参照）。
2. **本番（live）差分**: ホスト（`api.gmo-aozora.com`）・OAuth2.0/OIDC 認証・レート制限実数は GMO 本番契約（人間ゲート）後。接続層は `GMO_CONNECTOR_MODE` で分離済み・live は明示 throw。
3. **擬似入金の実行**: §4 の人間 1 手（ポータル or 承認付き API 振込）。

## 7. 依頼人名の着地フィールド — 実測確定(2026-07-11・ユーザーのポータル操作による実入金)

ユーザーが sunabar ポータルで実施した ATM 入金/出金・他行振込の実験が受取口座 `302010013543` に着地し、`GET /personal/v1/accounts/transactions` の実レスポンスで以下を確定(読み取り専用・トークン redacted):

```
count: 3
{'transactionDate': '2026-07-11', 'transactionType': '1', 'amount': '10000', 'remarks': 'ATM セブン', 'itemKey': '26809'}
{'transactionDate': '2026-07-11', 'transactionType': '2', 'amount': '5000',  'remarks': 'ATM セブン', 'itemKey': '26812'}
{'transactionDate': '2026-07-11', 'transactionType': '1', 'amount': '5000',  'remarks': '振込 スナバ　タロウ', 'itemKey': '26815'}
```

確定事項:
1. **依頼人名は `remarks` に「振込 <全角名>」形で載る**。`remitterName` / `applicantName` フィールドは personal レスポンスに存在しない。
2. `transactionType` は**文字列** `'1'`(入金)/`'2'`(出金)。`amount` も文字列。
3. `/accounts/deposit-transactions` は personal では 405(§5)。入出金は `/accounts/transactions` 一本。

**未確定(1点のみ)**: `remitterName=U-HA6M` を設定した振込が `remarks="振込 U-HA6M"` になるか(全角変換・切り詰めの有無)は、U-HA6M 入金の着地時に確定する。振込リクエスト applyNo `2026071100000001` は承認待ちのまま存置(ユーザー判断で後日: ポータルの振込入金シミュレート(依頼人名=U-HA6M)か applyNo 承認のどちらか1手 → `reconcileOnce` 再実行で (ii) クローズ)。
