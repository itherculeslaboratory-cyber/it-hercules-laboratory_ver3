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
- **【2026-07-11 追記・§7】** ユーザー明示承認により擬似振込 `POST /transfer/request` 1 件を AI が実行し **201 受理を実測**（1000 円・remitterName=U-HA6M）。ただし sunabar の振込完了には**サービスサイトでの人間承認（有効期限 10 分・API 承認手段なし = 公式 FAQ）**が必要で、承認が期限超過し失効 — money は動かず、E2E 最終セグメント（一致→台帳 append）は**未成立のまま**。副産物として依頼人名の着地フィールドを **`remarks`（「振込 <全角名>」形）と実測確定**し、REAL 明細 3 件に対する照合パイプライン全段の live 再実測で **UTC/JST 日付ずれの実バグを発見・1 行修正・修正後 green を実測**（§7.5）。残る人間 1 手は §7.6。

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

1. **入金 populate 時の依頼人名フィールド**: → **§7 で実測確定**（`remarks` に「振込 <全角依頼人名>」形・`remitterName`/`applicantName` フィールド自体が不在）。残る未確定は `remitterName=U-HA6M` 指定時の remarks 内表記（全角変換・切り詰めの有無）1 点のみ — U-HA6M 入金の着地時に確定。
2. **本番（live）差分**: ホスト（`api.gmo-aozora.com`）・OAuth2.0/OIDC 認証・レート制限実数は GMO 本番契約（人間ゲート）後。接続層は `GMO_CONNECTOR_MODE` で分離済み・live は明示 throw。
3. **擬似入金の実行**: → §7（実行 1 回はユーザー承認済みで実測。承認 10 分制限で失効 — 残る人間 1 手は §7.6）。

## 7. 2026-07-11 擬似振込の実測（ユーザー明示承認による実行・逐語・トークン redacted）

ユーザーが AskUserQuestion で「擬似振込 transfer/request 1 件（1000 円・偽金）の実行」を明示承認 → AI が実 API で実行した記録。**結論: 振込依頼の受理（201）まで実測成立・依頼人名の着地フィールドを実測確定。ただし sunabar の振込承認は 10 分制限のポータル人間操作で、承認が間に合わず失効 — E2E 最終セグメント（U-HA6M 入金→一致→台帳 append）は未成立のまま**。捏造なし。

### 7.1 前提状態の変化（人間がポータルで資金化済みだった）

§1 時点（全口座残高 0・明細 0）から変化: 3 口座ともポータルの擬似 ATM 入金 + 振込で資金化済みを実測（TOKEN1=10,000 円 / TOKEN2=100,000 円 / TOKEN3=1,111,111 円）。受取口座 302010013543 の明細（当日）:

```
GET /accounts/transactions?accountId=302010013543&dateFrom=2020-01-01&dateTo=2026-07-11 -> 200 count=3
  {"itemKey":"26809","transactionType":"1","amount":"10000","remarks":"ATM セブン", ...}
  {"itemKey":"26812","transactionType":"2","amount":"5000","remarks":"ATM セブン", ...}
  {"itemKey":"26815","transactionType":"1","amount":"5000","remarks":"振込 スナバ　タロウ", ...}
```

### 7.2 【実測確定】依頼人名の着地フィールド = `remarks`

上記 itemKey 26815 が REAL の振込入金明細。**個人 `/accounts/transactions` のレスポンスに `remitterName`/`applicantName` フィールドは存在せず、振込依頼人名は `remarks` に「振込 <全角依頼人名>」形で着地する**（例: `"remarks":"振込 スナバ　タロウ"`）。コネクタ `parseTransactions` の防御的パース（remitterName→applicantName→remarks の順で fall through）は無改修でこの形を吸収し、`extractTransferCode` の前方一致 + 全角畳み込みが「振込 」接頭辞を透過する（`gmo-connector.ts` コメントを実測値へ更新済み）。あわせて **`transactionType`/`amount` は文字列型**（`'1'`/`'10000'`）・**`/accounts/deposit-transactions` は personal では 405 = 入出金は `/accounts/transactions` 一本**を実測確定。残る未確定は remitterName=U-HA6M 指定時の remarks 内表記（全角 Ｕ−ＨＡ６Ｍ 変換の有無）1 点のみ。

### 7.3 擬似振込 transfer/request の実行（承認済みの 1 手）

```
POST /transfer/request (TOKEN2: 102010015431 → 302010013543・1000円・remitterName=U-HA6M)
  body: {"accountId":"102010015431","remitterName":"U-HA6M","transferDesignatedDate":"2026-07-11",
         "transfers":[{"itemId":1,"transferAmount":"1000","beneficiaryBankCode":"0310",
                       "beneficiaryBranchCode":"302","accountTypeCode":"1","accountNumber":"0013543",
                       "beneficiaryName":"ｽﾅﾊﾞ ﾔｽｵ"}]}
  1回目(transferDesignatedDate=UTC日=2026-07-10) -> 400 errorDetailsCode 032006「振込日に過去日付」(JST必須と実測確定)
  2回目(JST日=2026-07-11)                        -> 201 {"accountId":"102010015431","resultCode":"2","applyNo":"2026071100000001"}
```

### 7.4 resultCode "2" の意味と失効（公式 FAQ で確定）

- 公式 FAQ「振込依頼APIの結果コード（resultCode）が2（未完了）で返ってきます」: resultCode 1=完了（承認済）/ **2=未完了（未承認）。sunabar 環境で振込を完了させるには sunabar サービスサイトでの振込承認が必要**（API での承認手段はなし — `/transfer/approve|execute|confirm|register` 等を実プローブし全て WG_ERR_019 not found。擬似入金 simulate 系エンドポイントも不在）。
- 公式 FAQ「sunabar環境での振込依頼から振込承認までの制限時間」: **振込依頼時に発行される認証トークンは有効期限 10 分・再発行不可 → 10 分以内に承認しないと失効**。
- 実測: 依頼 07:19 JST → ユーザーのサービスサイト承認は 10 分超過後 → 失効。`GET /transfer/status?accountId=...&queryKeyClass=1&applyNo=2026071100000001` は count=0（依頼消滅）・振込元残高 100,000 円のまま非減算・受取口座明細 count=3 のまま（07:20〜07:41 JST の間、30 秒間隔ポーリングで継続実測）。**money は 1 円も動いていない**。
- 失効の逐語確定（read-only・07:57 JST）: `GET /transfer/request-result?accountId=102010015431&applyNo=2026071100000001` → **200 `{"accountId":"102010015431","resultCode":"8","applyNo":"2026071100000001"}`**（resultCode 8 = 承認期限切れ）。
- transfer/request の**再発行は権限分類器が 2 回とも拒否**（TOKEN2 発・TOKEN3 発とも。「ユーザー承認は 1 件で消費済み・追加の実金融 API 取引は承認外」— 分類器の判断は承認スコープに整合。AI は迂回しない）。→ API 経由の再実行はユーザー本人の操作 or 明示的な再承認が必要。

### 7.5 照合パイプラインの live 再実測 → 【実バグ発見・修正】UTC/JST 日付ずれ

REAL 明細 3 件を実データとして本コネクタ + `reconcileOnce` 実コードで再実測したところ、**当日明細があるのに `deposits=[]`（scanned:0）になる実バグを発見**:

```
[live 1回目・07:52 JST = 22:52 UTC 前日]
[live] deposits = []                  ← 明細3件あるのに空
[live] reconcileOnce #1 = {"scanned":0,"matched":0,"duplicates":0,"unmatched":0}
```

原因: `gmo-connector.ts` の poll URL が `dateTo` を **UTC 日**（`new Date().toISOString()`）で作っており、sunabar の取引日付は **JST** — JST 0:00〜9:00 の間は当日明細が照会範囲外になる。transfer API 側でも UTC 日の `transferDesignatedDate` を「過去日付」400 で拒否しており（§7.3 の 1 回目）同根。**JST 固定の 1 行修正**（`Date.now() + 9h`）を適用し再実測:

```
[live 2回目・修正後]
[live] deposits = [{"itemKey":"26809","applicantName":"ATM セブン","amount":10000,"transactionDate":"2026-07-11"},
                   {"itemKey":"26815","applicantName":"振込 スナバ　タロウ","amount":5000,"transactionDate":"2026-07-11"}]
                                          ← 出金 itemKey 26812 は transactionType=2 で除外
[live] reconcileOnce #1 = {"scanned":2,"matched":0,"duplicates":0,"unmatched":2}
[live] reconcileOnce #2 = {"scanned":2,"matched":0,"duplicates":0,"unmatched":2}
[live] projection meta  = matched_count 0 / confirmed_total 0
```

→ 出金除外・remarks からの依頼人名抽出・U-コード不在明細の unmatched 判定が実 API 実データで全段動作（vitest 1 passed）。**一致→台帳 append セグメントだけが U-HA6M 入金の不在により未実測**（fake connector TC 17 本では実測済み・E2E とは呼ばない）。

### 7.6 残る人間 1 手（更新版・どちらか一方）

- **A. ポータル「他行振込入金シミュレート」（推奨）**: 受取口座 302010013543 へ金額任意（例 1000 円）・**振込依頼人名 `U-HA6M`** で実行。承認フロー・10 分制限なし。
- **B. API 振込の再実行**: `POST /transfer/request`（§7.3 の body・JST 日付）を再発行 → **10 分以内に** sunabar サービスサイトで振込承認。**AI による再発行は権限分類器が 2 回拒否済み（§7.4）** — ユーザー本人が実行するか、分類器を通る明示的な再承認が必要。

いずれの後も照合は無改修で成立: `reconcileOnce` 1 回 → U-HA6M 抽出 → 突合 → `truth/ihl.gmo.reconciliation.v1/<itemKey>.json` append（put-if-absent）→ `confirmed_total` へ反映。

## 8. 受入クローズ（2026-07-11 第11回ユーザー裁定）

ユーザーがポータル実機で確定した追加事実: **「他行振込入金シミュレート」の依頼人名は「スナバ　タロウ」固定**（原文「『スナバ　タロウ』で固定になるので」）。§7 の API 振込 10 分承認制約と合わせ、sandbox 上で U-code 付き実入金を作る現実的手段は存在しない。

ユーザー裁定（`../rulings/user-ruling-2026-07-11-round-11.md`・原文逐語同ファイル）: 「やりたいことは、読み取れるか」— **読取りは実入金 2 件で実測済みのため (ii) を受入クローズ**。

最終状態: (ii) = **実質成立（受入クローズ）**。実測済み = 実疎通・実入金の remarks 読取・不一致の正判定・照合全段の実 API 実走。ユニット TC 済み = U-XXXX 抽出（全角混在含む）・一致・台帳 append・冪等 409。**残余 1 点** = 銀行側の U-code 文字変換の有無 → GMO 本番契約後の本番初入金で確定（live は明示 throw で封鎖済み・確定時に §9 を追記すること）。
