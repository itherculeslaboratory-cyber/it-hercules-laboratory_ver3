---
id: design-events-allowlist
title: T-71 POST /events 恒久硬化 — 自己サービス型 allowlist 裁定
date: "2026-07-18"
status: active
---

# T-71 POST /events 恒久硬化 — 自己サービス型 allowlist 裁定

> ユーザー承認 R91「やってください」・HQ 最優先指示。参照: HQ review-queue
> `sec-events-rawingest-authz-to-c9`、`docs/planning/c9/HANDOFF-c9-close-2026-07-18.md` §wave1統合オーナー注意。
> 実装: `apps/api/src/index.ts`(`SELF_SERVICE_EVENT_TYPES`)。回帰: `tests/events-allowlist-exploit.test.ts`。

## ① 穴の要約(出典 = 調査レポート要約、review-queue sec-events-rawingest-authz-to-c9)

`POST /events` は薄い汎用 Truth-append エンドポイント(`apps/api/src/index.ts:534` 付近)。
有効セッションでログインしてさえいれば、誰でも任意の `ihl.*.v1` 型名を騙り、`dataschema`
を省略/偽装するだけでドメインスキーマ検証を全回避して任意の `data` を Truth に append で
きた。唯一サーバ側で強制されるのは `provenance.actor_id` の上書きのみ — **`data` 内部の
`actor_id` 等のフィールドはクライアントの言い値のまま通る**。

typed route(例: `POST /api/v1/occupancy`)は書込み時に `actor_id` をセッション principal
に強制するが、`/events` はこのガードを経由しないため、typed route が存在する型ほど
`/events` 直POSTで業務ルール(所有者スコープ・在庫/重複防止・ロール制限)を丸ごと迂回できる
――全 77 ドメイン型のうち、`/events` を正当に使う書き手 route・呼び出し元は現行コードに
存在しなかった(調査②「自己サービス直POSTの必要性判定」)。

## ② 裁定 = allowlist 方式(1 チョークポイント・fail-closed)

**統合オーナー裁定(固定・実装で覆さない)**: 修正層 = `/events` ハンドラでの自己サービス型
allowlist(ポジティブリスト・fail-closed)。allowlist に無い型は `putEvent` 呼び出し前に
403 `USE_TYPED_ROUTE`(OBS 暫定 denylist と同じエラー契約 = クライアント互換)。

### 採用理由

1. **1 チョークポイント** — 77 ドメイン型それぞれに個別ガードを足すより、書込みの唯一の
   入口(`/events` ハンドラ)一箇所でポジティブに絞る方が漏れが構造的に出ない(新しい型が
   追加されても既定 deny)。denylist(OBS 暫定版)は「知っている悪い型を列挙」するため新型
   追加のたび追記漏れリスクがあるが、allowlist は「知っている良い型だけ通す」ため追記漏れ
   は安全側(deny)に倒れる。
2. **append-only(不変条項③)の尊重** — Truth への書込みルート自体は変えない。`putEvent`
   コア層は無改造。既存イベントの改変・削除は一切行わない。ゲートは「そもそも呼ばせるか」
   だけを判定する事前チェックで、Truth の追記モデルには触れない。
3. **typed route 不変** — allowlist に無い型の正当な書込みは 100% typed route 経由のまま
   (在庫/重複/ロール/所有者スコープ等の業務ルールは typed route 側で従来通り担保)。
   `putEventAt`/`putEvent` の呼び出しパターンそのものには一切手を入れていない。

### 判定方式の詳細

- 完全一致・正規化なし(大文字小文字も前後空白も同一視しない)。理由: `envelope.schema.json`
  の `type` パターン(`^ihl\.[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$`)が anchored ASCII 前提である
  ことを allowlist 側で崩さないため。正規化(trim/lower 等)を入れると「正規化後に一致する
  が生の値は不一致」な入力を許してしまい、下流の `validateEnvelope` の判定と allowlist の
  判定がズレる余地が生まれる。
- `body.type` が string でない(配列・数値・欠落等)場合も 403(putEvent 呼び出し前に遮断)。
- projection 側の所有者再検証は本ラウンドでは行わない(④参照・将来課題として記録のみ)。

## ③ allowlist 確定表

| 型 | 判定 | 根拠 |
|---|---|---|
| `ihl.ui.vote.v1` | **許可** | design-k4(route-matrix 57 行凍結)で「投票は新 route を作らず既存 `POST /events` へ投げる」と明記された設計契約。typed route は存在しない(意図的)。`data.actor_id` は詐称可能だが、投票は非破壊・非スコープ資源(誰の所有物にもならない)であり、`projectTemplateVotes` が `(actor,target,kind)` 去重で冪等 — 偽装 actor_id で書けても実害は「その actor が投票した」という無害なレコードのみ。`dataschema` 必須指定によりデータ形状自体は検証される。正規クライアント = `tests/ui-template.test.ts`(バックエンド契約は実装・テスト済。フロントエンドの fetch コードは未着手 — 塞ぐと将来のvote機能実装を阻害するため許可を維持)。 |
| `ihl.process.intent.v1` | **許可** | design-k8 §1.4: `appendIntent`(`apps/api/src/intent.ts`)は「route ではない純書込みヘルパ」という設計意図で、ネットワーク経路は既存 `POST /events` を再利用する契約(K8 は新 route 0 本、コード内コメントに明記)。typed route は存在しない(意図的)。`envelope.id === data.intent_id` 規約により put-if-absent が効き、二重 append は 409。意図ログは所有者スコープ資源ではなく、`actor_id` はサーバ側で上書きされる。正規クライアント = `tests/intent.test.ts`(design-c5.md §記載の凍結契約)。 |
| `ihl.test.sample.v1` | **許可(テストハーネス専用)** | `tests/helpers.ts` の `makeEnvelope()` 既定値。対応する `schemas/events/*.schema.json` も typed route も存在せず、本番では発生し得ない(実ドメインは `test` 名前空間を使わない)。除外すると、汎用メカニズム(認可境界 CL-04・insert-only CL-01・`provenance.actor_id` stamping V3-AUT-17)を `POST /events` 越しに検証する既存 TC(`cl-01-insert-only.test.ts`・`cl-02-provenance.test.ts`・`auth.test.ts`)が HTTP 層で検証できなくなる。正規クライアント = vitest テストハーネスそのもの(本番トラフィックには現れない)。 |
| 上記 3 型以外の全 77 ドメイン型(`ihl.src.occupancy.v1` ほか) | **拒否** | 調査②の通り、typed route(在庫/重複/ロール/所有者スコープの業務ルール込み)が別途存在し、`/events` を正当に使う書き手が現行コードに存在しない。全て typed route 経由に統一する。 |

## ④ OBS 暫定 denylist との関係(検算表)

`wave1-obs` worktree の `e7dc7af`(main 未 push・本ラウンドの対象外)は `ROUTE_ONLY_EVENT_TYPES`
という **denylist**(10 型)を先行実装していた。本ラウンドの **allowlist** はこの 10 型を
すべて包含して拒否する(= 上位互換)。検算:

| OBS denylist 10 型 | 本 allowlist での扱い |
|---|---|
| `ihl.src.occupancy.v1` | allowlist に無し → 拒否 ✅ |
| `ihl.mkt.transaction_event.v1` | allowlist に無し → 拒否 ✅ |
| `ihl.src.device_binding.v1` | allowlist に無し → 拒否 ✅ |
| `ihl.economy.karma_event.v1` | allowlist に無し → 拒否 ✅ |
| `ihl.economy.coin_event.v1` | allowlist に無し → 拒否 ✅ |
| `ihl.mkt.listing.v1` | allowlist に無し → 拒否 ✅ |
| `ihl.mkt.listing_flag.v1` | allowlist に無し → 拒否 ✅ |
| `ihl.gov.flag.v1` | allowlist に無し → 拒否 ✅ |
| `ihl.ind.master.v1` | allowlist に無し → 拒否 ✅ |
| `ihl.fee.settlement.v1` | allowlist に無し → 拒否 ✅ |

全 10 型が allowlist 外であることを `tests/events-allowlist-exploit.test.ts`
(`T-71 (b)` describe ブロック、`OBS_INTERIM_DENYLIST_10` 定数)で機械的に検算している。
本ラウンドは denylist 実装そのものを main へ統合しない(wave1-obs には触れない指示)が、
allowlist が denylist の防御範囲を包含するため、wave1-obs 側が将来統合されても衝突しない
(denylist 側が緩めていた入口を allowlist がさらに絞る形になるのみ)。

## ⑤ 将来の多層防御(申し送り・本ラウンドでは実装しない)

1. **projection 側の所有者再検証** — 現状、typed route の書込み時点で `actor_id` を強制
   する一層防御のみ。将来、projection(読み出し集計)側でも `data.actor_id` と実際の所有
   関係(個体マスタの現所有者等)を突き合わせる二層目のチェックを足すことで、万一 typed
   route 側にロジックバグがあっても被害を限定できる。本ラウンドではスコープ外(統合オー
   ナー裁定により明示的に見送り)。
2. **role 体系の拡張** — 現行は「ログイン済みなら書ける」フラットな認可モデル
   (`requireRole` は一部 route のみ)。将来 role/scope ベースの認可を導入する際は、
   `/events` allowlist とは独立した層として設計する(allowlist は「型の入口を絞る」層、
   role 体系は「誰が書けるか」層 — 責務を混ぜない)。
3. **`ihl.ui.vote.v1` のフロントエンド実装時の注意** — 現状バックエンド契約のみ凍結済み。
   フロントエンドの投票 UI を実装する際、`/events` への直接 fetch は本 allowlist によって
   引き続き許可されているため実装を阻害しない。ただし actor_id 詐称耐性は「実害が無い」
   という前提に立っているため、投票に経済的価値(プラチナコイン等)が紐づく設計に発展する
   場合は、この判定を再検討すること。
