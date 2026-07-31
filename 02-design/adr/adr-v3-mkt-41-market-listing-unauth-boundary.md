---
id: adr-v3-mkt-41-market-listing-unauth-boundary
title: 市場出品の未認証閲覧境界(マーケットレジストリの公開範囲)
date: "2026-08-01"
status: active
---

# ADR: 市場出品の未認証閲覧境界(V3-MKT-41)

> 本文書は法的助言ではない。社内向けの設計記録(ADR)である。

## 状況(Context)

要件 V3-MKT-41(非機能要件): 「市場出品の未認証(unauthenticated)閲覧境界を明示的に定義し
(マーケットレジストリの公開範囲ADR)、POST /listing-registryの無認証(NFR-MKT-03/06)を
既知セキュリティギャップとして認証保護する。」

62代目HQ検収是正(`R0731-02b601`・w2-mkt批評重大2)により、本要件は当初の型C(根拠citationのみ)
から型F(非機能要件・コード+テストの実証が必要)へ差し戻された。w3-mkt が型Fの②(テスト)を
`tests/mkt-41-unauth-boundary.test.ts` として追加済み(w-legal艦の書いてよい場所の外のため、
本ADR文書のみがこの艦=`lane-implement/legal`の担当として持ち越されていた)。

## 決定(Decision)

1. **マーケットレジストリ(`/market/listings` 系)の公開範囲 = 非公開(認証必須)。**
   `apps/api/src/index.ts` の `PUBLIC_ROUTES`(:76-94)に `market` 系パスは含まれておらず、
   認証ミドルウェア(:165-215)が `PUBLIC_ROUTES` 外のパスを既定で `401 AUTH_REQUIRED` に
   倒す(deny-by-default、V3-CL-04 不変条項)。未認証の GET/POST いずれも閲覧・出品ともに
   拒否される。
2. **`POST /listing-registry`(ver2由来のパス)は ver3 に実装されていない。** 未定義ルートも
   認証ゲートが先に発火するため `401`(隠しルートとして 200 で成功してしまうことはない)。
   これにより NFR-MKT-03/06 が懸念する「無認証書込」の経路は ver3 では構造的に存在しない。
3. 上記2点の自動回帰テストは `tests/mkt-41-unauth-boundary.test.ts`(w3-mkt作成)にある。
   本ADRはそのテストが立証する境界を設計判断として明文化するものであり、新規のコード変更は
   伴わない。

## 結果(Consequence)

- V3-MKT-41 の「マーケットレジストリの公開範囲ADR」という要件文言は本文書で充足する。
  ①コード(deny-by-default・既存)②テスト(`tests/mkt-41-unauth-boundary.test.ts`・既存)
  ③本ADR(新規)の3点が揃うため、型Fとして `done` へ更新できる。
- 将来 `market` 配下に GET を公開(未認証で一覧のみ閲覧可)する要件が生じた場合は、
  `PUBLIC_ROUTES` へ明示追加し、本ADRを改訂すること(現状は「非公開」を既定境界とする)。
- V3-SEC-56 の ADR(`adr-v3-sec-56-listing-registry-boundary.md`)が同種のギャップの
  「既知ギャップとして明示する」側を担当し、本ADRが「実際の境界を定義・実証する」側を
  引き継ぐ関係にある(相互参照)。
