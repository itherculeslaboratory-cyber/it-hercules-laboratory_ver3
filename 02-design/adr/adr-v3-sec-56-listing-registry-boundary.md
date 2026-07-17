---
id: adr-v3-sec-56-listing-registry-boundary
title: 出品状態書込の認可境界と POST /listing-registry 既知ギャップ
date: "2026-07-17"
status: active
---

# ADR: 出品状態書込の認可境界と POST /listing-registry 既知ギャップ(V3-SEC-56)

## 状況(Context)

要件 V3-SEC-56: 「出品状態書込・テンプレ公開・GMO等は認可(requireMarketListingStateWrite等)
で保護するが、POST /listing-registry の無認証は既知セキュリティギャップとして明示し
要改善候補とする。」

`01-requirements/registry.json` の evidence は ver2 由来の `POST /listing-registry`
エンドポイントと `requireMarketListingStateWrite` という個別ミドルウェア名を参照しているが、
ver3(本リポジトリ)にはどちらも存在しない。ver3 の出品状態書込は
`apps/api/src/market-routes.ts`(`POST /market/listings`・遷移 route 群)・
`apps/api/src/market-template-routes.ts`(テンプレ公開)・`apps/api/src/gmo-routes.ts`
(retired・接続層のみ残置)が担い、個別ミドルウェアではなく `apps/api/src/index.ts` の
CL-04 deny-by-default 認証ゲート(`PUBLIC_ROUTES` に無いパスは全て 401)が全書込 route を
一律で保護する(不変条項④）。

## 決定(Decision)

1. ver3 では `requireMarketListingStateWrite` のような個別関数を新設しない。単一の
   deny-by-default ゲート(index.ts)が全ての出品状態書込・テンプレ公開・GMO route を
   等しく保護しており、これは V3-SEC-56 が要求する「認可で保護」を満たす(実装は
   `cl-04-deny-by-default.test.ts` が固定)。
2. `POST /listing-registry` という ver2 由来のパスは ver3 に存在しない
   (`tests/sec-56-listing-registry-boundary.test.ts` が固定・回帰ガード)。将来このパス名で
   route を追加する場合は、deny-by-default ゲートの対象(=`PUBLIC_ROUTES` に追加しない)と
   することを本 ADR で既定とする。
3. ver2 の実際のセキュリティギャップ(無認証な listing-registry 相当エンドポイント)を
   ver3 で本格的に再設計・実装するタスクは別要件 **V3-MKT-41**(市場レーン・第2波・
   「市場出品の未認証閲覧境界を明示的に定義」)が引き継ぐ。V3-SEC-56 自体は「既知ギャップ
   として明示する」ことが要件文の主目的であり、本 ADR + 既存の
   `docs/knowledge/open-questions.md`(実装ギャップ節)がその「明示」を満たす。

## 結果(Consequence)

- V3-SEC-56 は ver3 において追加コードなしで実質的に充足している(deny-by-default が
  唯一かつ十分な認可境界のため)。回帰ガード用の負のテストのみ追加する。
- 実際の「未認証閲覧境界の明示的定義」(公開 GET の範囲・書込の認可)を深掘りする作業は
  V3-MKT-41(市場レーン)の担当とする — 本 ADR はそのポインタを兼ねる。
