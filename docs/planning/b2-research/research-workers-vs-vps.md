---
source: "docs/planning/ver3/b2/research-workers-vs-vps-v1.md@4a56cf6"
id: V3-B2-RES-WORKERS-VPS
title: Workers vs VPS 分担の再検証（ADR-H-33/H-37 裏取り + 移植コスト深掘り）
date: 2026-07-10
status: draft
decision: "ver3 新 repo は最初から Workers+Hono(TS) で主 API を書く（FastAPI→移植の二度書きを棄却）。ADR-H-33 の役割分離は維持、ただし『VPS=SMTP 薄常駐』条項は修正し HTTP メール API を第一候補に格上げ。"
sources_count: 16
revalidate_before_impl: true
---

# Workers vs VPS 分担の再検証 — deep-research v1

> 調査日: 2026-07-10。本書の web 出典はすべて 2026-07 時点の取得内容。実装着手時に §6 の再検証条項を必ず実施すること。

## 1. 結論（選定）

**ver3 新 repo の主 API は最初から Cloudflare Workers + Hono (TypeScript) で書く。FastAPI で書いてから移植する案は棄却する。** ADR-H-33 の「Workers=主 API・R2 バインディング / VPS=薄常駐」という役割分離は deep-research の結果**方向として妥当**であり維持する。ただし 2 点修正する: (a) **「VPS=SMTP 薄常駐」は必須条項から任意条項へ降格**する — Workers からの直接 SMTP（587/465、`connect()` API）・Cloudflare Email Service・Resend 等 HTTP メール API が 2026 年時点で実用化しており、magic link 程度の低ボリュームなら VPS 常駐ゼロで賄える可能性が高い（最終裁定は Phase B2 のメール経路個別調査で行う）。(b) ADR-H-37 の W1〜W4「段階移行」は既存 repo の strangler 前提であり、**ver3 新 repo ではゼロベース Hono 実装 + 本番切替時のみ route 単位 strangler**（既存 VPS FastAPI を legacy 側として並走）に読み替える。TS/Hono 前提は Python Workers が 2026-07 時点でなお open beta のため覆らない。互換必須 13 レイヤーのうち Workers 移行で技術的に詰まるものはなく、CL-01（no-overwrite）はむしろ R2 バインディングの条件付き put でストレージ層強制に格上げできる。唯一の実装リスクは CL-07（サムネイル生成、Pillow 相当が Workers に無い）で、これは §6 の再検証項目とする。

## 2. 根拠（最低5件・出典付き）

### 根拠1 — Workers 無料枠・制限は本プロジェクトの負荷に対し十分（不変条項①）

Cloudflare 公式の料金・制限ページによると、Free プランは **10万 req/日・10ms CPU/req**、Paid（$5/月）は 1,000万 req + 3,000万 CPU-ms 込み。メモリは Free/Paid とも **128MB/isolate** で、課金は wall-clock でなく **CPU 時間ベース**（I/O 待ちは無課金）。本プロジェクトの実トラフィック（個人〜小規模コミュニティの観測記録）は 10万 req/日に遠く及ばず、10 年間 $0 運用が現実的。128MB 制約は「重い ML を Workers に載せない」既存合意（`docs/ver4-infra-agreement.md:15`）と整合し、通常の CRUD/検証 API には十分。

- 出典: https://developers.cloudflare.com/workers/platform/pricing/
- 出典: https://developers.cloudflare.com/workers/platform/limits/

### 根拠2 — Hono は 2026 年時点で成熟・エコシステム十分（TS/Hono 前提の裏取り）

Hono は 2026-04 時点で v4.12 系を出荷中（約 14KB minified）、Cloudflare 自身（D1・Workers KV）、Deno、Clerk、Unkey、cdnjs 等が本番採用。`@hono/zod-openapi` により **Zod スキーマから OpenAPI 生成 + リクエスト検証**が公式サポートされており、ADR-H-37 D2「OpenAPI/JSON Schema 契約から型生成」（`02-設計/_横断/adr/ADR-H-37-ver4-Workers-port-strategy-v1.md:27-29`）はそのまま Hono エコシステムで実現できる。R2 は Workers ネイティブバインディング（`env.BUCKET.put/get`）でフレームワーク非依存に使える。

- 出典: https://hono.dev/examples/zod-openapi
- 出典: https://www.npmjs.com/package/@hono/zod-openapi
- 出典: https://dev.to/ottoaria/honojs-in-2026-the-fastest-web-framework-for-cloudflare-workers-and-why-its-going-mainstream-2aap（採用状況の傍証・二次情報）

### 根拠3 — Python Workers はなお open beta。「TS/Hono 前提」は覆らない

Cloudflare 公式ドキュメントは 2026-07 時点でも Python Workers を **open beta** と明記（`python_workers` compatibility flag 必須・「a few limitations」あり）。FastAPI 自体は Pyodide 上の ASGI で動作するが、2026 年の公式ブログでも cold start がスナップショット有りで約 1 秒（無しで約 10 秒）と、TS Workers（ミリ秒台）と桁が違う。10 年運用の正本 API を beta ランタイムに載せるのは不変条項①（運用コスト最小=枯れた経路選択）に反する。**「FastAPI のまま Python Workers へ」という第三案は現時点で棄却が妥当**。

- 出典: https://developers.cloudflare.com/workers/languages/python/
- 出典: https://blog.cloudflare.com/python-workers-advancements/
- 出典: https://developers.cloudflare.com/workers/languages/python/packages/fastapi/

### 根拠4 — R2 バインディングは条件付き put（no-overwrite）をストレージ層で強制できる（CL-01 に有利）

R2 Workers API リファレンスは `put(key, value, { onlyIf })` の `R2Conditional`（`etagMatches` / `etagDoesNotMatch` / `uploadedBefore` / `uploadedAfter`）を公式サポートし、**precondition 失敗時は「put() returns null, and the object will not be stored」**と明記。さらに Headers 渡しで「All conditional headers aside from If-Range are supported」。つまり **put-if-absent（If-None-Match: * 相当）を R2 側で強制でき、現行の boto3 + アプリ層 no-overwrite チェック（TOCTOU 窓あり）より CL-01 の保証が強くなる**。S3 互換 API 側も `cf-copy-destination-if-*` の説明文中で「similarly named conditional headers supported on PutObject」と PutObject 条件付きヘッダの存在を示唆。ただし過去に条件反転バグ（workers-sdk #6411）や wildcard etag の解釈問題（workerd #2572）が報告されており、**put-if-absent の正確な書き方（`etagMatches: '*'` か Headers `If-None-Match: *` か）は実装着手時に実機検証必須**（§6）。

- 出典: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- 出典: https://github.com/cloudflare/workers-sdk/issues/6411
- 出典: https://community.cloudflare.com/t/conditional-put-not-supported-in-r2/397626（歴史的経緯: かつて未サポート→現在は解消）

### 根拠5 — Workers の SMTP 制約は「port 25 のみブロック」であり、VPS 必須論は 2026 年時点で弱まった

Cloudflare 公式 TCP Sockets ドキュメントは「Workers cannot create outbound TCP connections on **port 25**」と明記するが、**587/465 はブロック対象として記載されておらず**、`connect()` API による SMTP submission は可能（実例: worker-mailer ライブラリが Workers 上で SMTP 465/587 送信を実装）。さらに Cloudflare 自身が **Email Service（送信 API、SMTP エンドポイント含む）を公式ドキュメント化**しており（2026 年時点 beta、第三者報道で $0.35/1,000 通）、Resend 等の HTTP メール API も無料枠で magic link 規模を賄える。**ADR-H-33 の却下理由「Workers-only は magic link 実経路の欠落」（`02-設計/_横断/adr/ADR-H-33-ver4-Workers-VPS-役割分離-v1.md:69`）は 2026-07 時点では成立しない**。VPS 薄常駐は「自ドメイン直送 SMTP の到達性・独立性」を重視する場合の選択肢に降格する。

- 出典: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- 出典: https://github.com/zou-yu/worker-mailer
- 出典: https://developers.cloudflare.com/email-service/api/send-emails/smtp/

### 根拠6 — 10 年 TCO: Workers 移行で VPS 費（約 7.7 万円/10年）が原理的にゼロ化可能

さくらの VPS 512MB は月額 643 円（石狩・税込、年払いで月あたり 590 円〜）。10 年 TCO は **約 70,800〜77,160 円**。対して Workers Free + R2 Free（10GB・Class A 100万/月・Class B 1,000万/月）+ メール API 無料枠なら **ランニング約 0 円/10年**（ドメイン代除く）。ハイブリッド（Workers 主 API + VPS 薄常駐）は VPS 費がまるごと残るため、**「VPS を残す価値」はメール到達性・独立 kick 常駐に見合うかで判断**することになる。不変条項①の観点では Workers-only が最小。

- 出典: https://vps.sakura.ad.jp/specification/
- 出典: https://developers.cloudflare.com/workers/platform/pricing/（R2/Workers 無料枠）

### 根拠7 — 「FastAPI で書いてから移植」は strangler パターンの適用対象ではない

strangler fig パターンの標準文献（AWS Prescriptive Guidance 等）が前提とするのは「**既に稼働中の legacy を** 少しずつ置換する」状況であり、新規コードをあえて捨てる前提の言語で書く根拠にはならない。ver3 新 repo はゼロベースなので、strangler の legacy 側は**既存 ver3-live の FastAPI on VPS**（現に本番稼働中）が担う: 新 Hono API を route 単位で立ち上げ、`INFRA-ROUTE-MATRIX-v1.csv`（57 routes・W1〜W4 wave 済み、`docs/registry/INFRA-ROUTE-MATRIX-v1.csv:3-14`）を切替順序表として流用し、DNS/Pages ルーティングで段階切替する。**「FastAPI を新規に書く工程」はどの経路でも不要**。移植コストは「二度書き（Python→TS）の全ルート分」から「既存 FastAPI の OpenAPI 契約を仕様書として読む片道分」に圧縮される。

- 出典: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html
- 出典（repo）: `docs/registry/INFRA-ROUTE-MATRIX-v1.csv:3`（57 route × wave の切替順序表が既に存在）

### 根拠8 — CL-09（collector Ed25519）は Workers WebCrypto で検証可能

Workers の Web Crypto は Ed25519 を（標準の Secure Curves 版に加え legacy `NODE-ED25519` 指定でも）サポートし、公開鍵の raw import + `verify()` が可能。collector プロトコル（署名検証はサーバ側=公開鍵のみ）は Workers 移行で**鍵形式・プロトコルを一切変えずに**実装できる。秘密鍵はそもそもサーバに置かない設計（CL-09「秘密値非露出」）なので、Workers の「raw private key import 不可」制約にも抵触しない。

- 出典: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- 出典: https://community.cloudflare.com/t/eddsa-node-ed25519-verify-function-in-a-worker/439557
- 出典（repo）: `docs/planning/ver3/ver3-最終要件定義書-v1.md:1321`（CL-09 定義）

## 3. 比較した代替案と却下理由

| 案 | 内容 | 却下理由 |
|----|------|----------|
| A. FastAPI で書いてから ver4 で Workers へ移植（ADR-H-37 の素直な読み） | ver3 新 repo も Python FastAPI → 後日 TS 化 | **二度書き**。57 route 相当を Python と TS で 2 回書く。ADR-H-37 の W1〜W4 は「既存資産があるから段階移行」の論理であり、資産ゼロの新 repo には適用前提が無い。512MB VPS ボトルネック（ADR-H-33 コンテキスト）も温存される |
| B. Python Workers で FastAPI をそのまま載せる | 言語据え置きで Workers 化 | Python Workers は 2026-07 時点 **open beta**・cold start 約 1 秒（スナップショット有）・制限あり。10 年正本 API の土台として時期尚早（根拠3） |
| C. VPS FastAPI 恒久化（ADR-H-33 棄却） | 現行構成の継続 | 512MB 単一障害点・スケール上限（ADR-H-33 D1）。10 年 TCO 約 7.7 万円が確定で乗る（根拠6）。不変条項①に劣後 |
| D. Workers-only + VPS 即時廃止（メールも Workers 直送 SMTP） | 完全サーバレス | 方向は有力だが**即時確定はしない**。自前ドメインからの SMTP 直送は SPF/DKIM/レピュテーション運用が残り、Cloudflare Email Service は beta。メール経路は Phase B2 の個別調査（メール API vs VPS msmtp vs Workers 直 SMTP）で裁定してから。本書は「VPS 必須条項の降格」までに留める |
| E. コンテナ系 PaaS（Cloud Run 等）へ FastAPI ごと移す | 言語据え置き・serverless | ベンダー追加（CF + Google の 2 社依存）・無料枠の将来不確実性・R2 バインディング不可（S3 API 経由のまま）。CF 内完結より複雑化し不変条項①③に利点なし |

## 4. ver3 要件との接続

### 不変条項への適合

| 不変条項 | 適合 |
|----------|------|
| ① コスト最小（10年） | Workers Free + R2 Free で API ランニング原理 0 円。VPS 降格が確定すれば 10 年で約 7.7 万円削減（根拠1・6） |
| ② fork 文化 | Hono/TS は `wrangler dev` でローカル完結・単一 repo で fork 可能。VPS 常駐（SSH・certbot・Docker 運用）が減るほど fork 障壁は下がる |
| ③ append-only | R2 バインディング条件付き put で no-overwrite を**ストレージ層強制**に格上げ（根拠4）。CL-01 の保証強化 |
| ④ 人間ゲート | 本書は draft。ADR-H-33 修正（VPS 条項降格）と「最初から Hono」の裁定は人間ゲート必須 |
| ⑤ 批評家ゲート | §6 に反証可能な再検証項目を列挙。特に R2 put-if-absent は実機検証まで「未確証」扱い |

### 関連 V3-要件 ID・互換必須レイヤー

| レイヤー | Workers+Hono 移行での影響 |
|----------|---------------------------|
| CL-01（R2 INSERT ONLY, V3-FND-01） | **改善**。boto3 アプリ層チェック → R2 バインディング `onlyIf` でストレージ層強制（根拠4）。put-if-absent 実機検証は §6 |
| CL-03（actor_id/セッション, V3-AUT-17/19） | 影響なし。opaque token 検証は Hono middleware で同一ロジック移植。導出関数のテストベクタを契約シャードに固定して回帰確認 |
| CL-04（Scope A 公開 READ deny-by-default, V3-AUT-15/16, V3-OBS-39） | 影響なし。Hono の route 単位 middleware で deny-by-default を実装。57 route マトリクスに「公開/保護」列を足して照合 |
| CL-07（thumbnail 契約 長辺512px JPEG/EXIF, V3-OBS-23/08） | **要注意**。Pillow 相当の画像処理が Workers に無い。候補: Cloudflare Images / wasm（photon 等）/ クライアント側生成。§6 再検証・§7 未解決 |
| CL-08（embedding 契約, V3-OBS-09） | 影響なし。DINOv2 はどちらにも載せない合意済み（`docs/ver4-infra-agreement.md:15`）。Workers は保存済みベクタの読取/検索のみ |
| CL-09（collector Ed25519, V3-OBS-17, V3-SEC-02） | 影響なし。WebCrypto Ed25519 verify で鍵・プロトコル無変更（根拠8） |
| CL-11（deriveTransferCode, V3-MKT-12/14） | 影響なし。SHA-256→Base36 は WebCrypto + 純 TS で決定的に再実装可。既存ユーザー全員分のテストベクタで回帰必須 |
| CL-02/05/12/13（provenance・同意・台帳・タグ append-only） | CL-01 と同経路（R2 書込規約）。形式凍結（ADR-V3-LAYER-01 待ち）のままスキーマ無変更で移植 |

その他: ADR-H-33（維持・一部修正）、ADR-H-37（D2 契約正本・D1 wave 表は切替順序表として流用、「FastAPI から」の前提のみ読み替え）、`docs/ver4-infra-agreement.md` §0-2（VPS 薄常駐条項の再裁定対象）。

## 5. 推奨（ADR-H-33 の扱い）

**維持 + 修正（MODIFY）**:

1. **維持**: Workers=主 API・R2 バインディング・水平スケール、重い ML/SwitchBot poll はどちらにも載せない、負荷偏在禁止（D1）。
2. **修正**: D2 の「Sakura VPS（薄常駐）= SMTP・magic-link kick」を必須から**選択肢**へ。メール経路は「(a) HTTP メール API（Resend/Cloudflare Email Service）(b) Workers 直 SMTP 587（worker-mailer 系）(c) VPS msmtp 薄常駐」の 3 択として Phase B2 で個別裁定。裁定までは ver3-live の現行 VPS 経路を触らない。
3. **ver3 新 repo への適用**: 最初から Workers+Hono(TS)+zod-openapi で主 API を書く。既存 FastAPI は (i) OpenAPI 契約の仕様正本、(ii) 本番切替時の strangler legacy 側、の 2 役のみ。FastAPI の新規記述は行わない。

## 6. リスクと再検証条項

**本書の根拠はすべて 2026-07-10 時点の web 情報・repo 状態である。実装着手時に以下を再検証すること（frontmatter `revalidate_before_impl: true`）。**

| # | 再検証項目 | 方法 | 失敗時の影響 |
|---|-----------|------|--------------|
| R1 | R2 バインディングでの **put-if-absent** の正確な書き方と挙動（`onlyIf.etagMatches:'*'` vs Headers `If-None-Match: *`、null 返り確認） | wrangler で実バケット相当に対する 2 重 put テスト（先勝ち・後発 null） | CL-01 のストレージ層強制が使えず、アプリ層チェック（現行同等）に後退。移行自体は可 |
| R2 | Workers Free 枠（10万 req/日・10ms CPU）・R2 Free 枠の**改定有無** | 公式 pricing/limits ページ再取得 | 枠縮小なら Paid $5/月（10年 $600≒9万円）でも VPS 比で同水準。裁定影響は小 |
| R3 | メール経路 3 択の比較（到達性・無料枠・beta 卒業状況。Cloudflare Email Service の正式料金 $0.35/1,000 は**第三者報道値**） | Phase B2 メール個別調査（別レポート） | VPS 薄常駐が復活するだけ。ADR-H-33 原案に戻る |
| R4 | CL-07 サムネイル生成の Workers 実装経路（wasm 画像処理 or Cloudflare Images or クライアント生成）と既存契約（長辺512px JPEG・EXIF transpose）とのバイト級互換 | 既存 thumbnail と新経路出力の比較テスト | 最悪、画像 ingest ルートのみ VPS 残置（部分ハイブリッド）。W4「FastAPI 全停止」が遅延 |
| R5 | Python Workers の GA 化（beta 卒業）有無 | 公式 docs 再確認 | GA 化しても cold start・エコシステム差で TS/Hono 優位は揺らぎにくいが、案 B の再評価余地 |
| R6 | Hono v4→v5 等のメジャー更新・`@hono/zod-openapi` の保守状況 | npm/GitHub 確認 | 型生成レイヤーの選び直し（hono-openapi 等代替あり） |
| R7 | Workers `connect()` の port 587/465 ポリシー変更有無 | TCP sockets docs 再取得 | 直 SMTP 案 (b) の消滅のみ。(a)(c) は無傷 |

既知の残留リスク: Cloudflare 1 社依存の集中（Pages+Workers+R2+DNS）。R2 は S3 互換 API を持つため**データの exit 経路は確保済み**（boto3 での吸出しは現行実証済み）だが、コンピュート（Hono）は Node/Deno/Bun でも動くフレームワークであることが事実上の exit 戦略になる。ADR 化の際に 1 行明記推奨。

## 7. 未解決の問い

1. **メール経路の最終裁定** — HTTP メール API / Workers 直 SMTP / VPS msmtp のどれにするか（R3。独立ドメイン到達性 vs 常駐ゼロのトレードオフ。Phase B2 の別レポート対象）。
2. **CL-07 サムネイル生成の Workers 実装方式** — wasm / Cloudflare Images / クライアント側生成のどれで既存契約（512px JPEG・EXIF transpose）とバイト級互換を取るか（R4）。
3. **VPS 解約タイミング** — メール経路裁定が (a)/(b) になった場合、ver3-live の strangler 完了（全 route 切替 + 認証 E2E）をもって解約か、kick/ヘルス補助のため 1 年併走か。
4. **Workers 上のセッションストア** — 現行 opaque session_token の保存先を R2 直読みのままにするか、KV/D1 を投影キャッシュとして併用するか（append-only 原則③との整合は投影層扱いなら可、ADR-V3-LAYER-01 と連動）。
5. **wrangler 環境の fork 文化②への最適化** — `wrangler.toml` にどこまで環境値を直書きし、fork した第三者が自分の CF アカウントで即デプロイできる形にするか。

---

### 出典一覧

**Web（2026-07-10 取得）**

1. https://developers.cloudflare.com/workers/platform/pricing/
2. https://developers.cloudflare.com/workers/platform/limits/
3. https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
4. https://developers.cloudflare.com/r2/api/s3/extensions/
5. https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
6. https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
7. https://developers.cloudflare.com/workers/languages/python/
8. https://developers.cloudflare.com/workers/languages/python/packages/fastapi/
9. https://blog.cloudflare.com/python-workers-advancements/
10. https://developers.cloudflare.com/email-service/api/send-emails/smtp/
11. https://hono.dev/examples/zod-openapi
12. https://www.npmjs.com/package/@hono/zod-openapi
13. https://github.com/zou-yu/worker-mailer
14. https://github.com/cloudflare/workers-sdk/issues/6411
15. https://community.cloudflare.com/t/conditional-put-not-supported-in-r2/397626
16. https://vps.sakura.ad.jp/specification/
17. https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html
18. https://community.cloudflare.com/t/eddsa-node-ed25519-verify-function-in-a-worker/439557

**Repo**

- `02-設計/_横断/adr/ADR-H-33-ver4-Workers-VPS-役割分離-v1.md:25-48`（D1〜D4）・`:64-70`（却下案）
- `02-設計/_横断/adr/ADR-H-37-ver4-Workers-port-strategy-v1.md:17-34`（D1〜D3）
- `docs/ver4-infra-agreement.md:12-16`（合意 5 項目）・`:130-141`（ver4 チェックリスト）
- `docs/registry/INFRA-ROUTE-MATRIX-v1.csv:3-14`（57 route × wave）
- `docs/planning/ver3/ver3-最終要件定義書-v1.md:1311-1327`（互換必須 13 レイヤー表）
