---
id: design-gov-35-observation-freeze
title: GOV-35 観測モジュール側 freeze(クロスモジュール) — 設計ノート(未実装)
date: "2026-07-17"
status: active
---

# GOV-35 観測モジュール側 freeze(クロスモジュール) — 設計ノート

> HANDOFF-c8-session2.md §3 の申し送り「GOV-35 の観測モジュール側 freeze(クロスモジュール)」
> に対する設計整理。**実装は行っていない**(誇張ゼロ)。g05(市場モデレーション側)は既に
> `apps/api/src/market-flag-routes.ts`(V3-GOV-35・commit b070403)で完結しており、本ノートは
> 「市場の停止が観測モジュール(individual/observation)側にどう波及すべきか」という別の
> 論点を扱う。

## 現状(市場側は完結・観測側は未着手)

`market-flag-routes.ts` の `projectListingModeration`/`projectSellerModeration` は市場の
出品(`ihl.mkt.listing.v1` / `ihl.mkt.transaction_event.v1`)だけを対象に非表示・出品停止を
判定する。個体(`ihl.ind.master.v1`)・観測(`ihl.obs.capture.v1`)・写真等の観測モジュール
データは一切参照・変更していない。

## 論点: 「関連観測」とは何を指すか(要件文の直接の根拠)

V3-GOV-35 原文: 「対象商品や観測内容の近似範囲(同一出品者の類似出品・関連観測)を巻き込みも
許容してまるごと停止する」。ここでいう「観測内容」の接続点は `mkt-listing.schema.json` の
`reservation_sire_id`/`reservation_dam_id`(V3-IND-35 割り出し予約が参照する父母 individual_id）
のみが構造的に存在する。それ以外の一般的な出品(生体そのものの販売等)には個体/観測への
直接参照フィールドが無い(`listing_id` に紐づく `title`/`description` は自由記述で、
個体参照は必須ではない)。

## 設計案(3案・優先順位付き)

1. **(推奨・最小)予約リンクのみ凍結**: `projectSellerModeration(sellerId).suspended` が
   true の間、`reservation_sire_id`/`reservation_dam_id` がその出品者の停止済み listing を
   参照する予約は `market-reservation-routes.ts` の GET 一覧から除外する(市場内で完結・
   観測モジュールのコードは触らない)。理由: 現状の唯一の構造的接続点であり、個体そのものの
   観測データ(写真・計測)を凍結する必要はない(「個体記録」と「出品」は別ライフサイクル)。
2. **(中)個体の公開プロフィールにモデレーション状態を波及**: `individual-routes.ts` の
   公開系 GET(bio-card 等)に `seller_moderation` フラグを合成して返す。個体自体を隠さず、
   閲覧者に「出品停止中の出品者に紐づく個体」であることを示すのみ(観測データは不変・
   append-only の原則を壊さない)。
3. **(重い・非推奨)観測イベント自体の可視性を投影で切替**: `obs-capture`/`obs-photo` の
   GET 系に `actor_id` 経由でモデレーション判定を組み込む。個体・観測は本来「事実の記録」
   であり出品行為とは独立した価値を持つため、出品停止(市場上の懲罰)を理由に観測記録
   まで非表示にするのは「安全に切り離す」という原意図を超える巻き込みになり得る
   (個体の観測履歴は他の飼育者・研究目的にも参照される可能性がある)。過剰実装リスクが
   高く、次回セッションでのユーザー裁定を推奨する論点。

## 推奨と次アクション

- 案1(予約リンクのみ凍結)は市場レーン(V3-IND-35 予約)の管轄であり、影響範囲も
  `market-reservation-routes.ts` に閉じるため実装コストが低い。次波で市場レーンが着手
  することを推奨する(本レーン g05 の範囲外のコード変更のため実装せず引き継ぐ)。
- 案2/3は「出品停止の効果範囲をどこまで観測モジュールに波及させるか」というプロダクト
  判断であり、ユーザー裁定が必要(推奨: 案2止まり・案3は不採用)。
- 本ノートは design-only。progress.json 上は V3-GOV-35 自体は引き続き `done`(市場側は
  完結済み)のまま、本クロスモジュール論点は別途 backlog として引き継ぐ。
