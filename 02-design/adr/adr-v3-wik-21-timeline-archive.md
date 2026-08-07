---
id: adr-v3-wik-21-timeline-archive
title: 文明史タイムライン(Global/User/Object 3階層)+ VideoArchive 設計
date: "2026-08-01"
status: proposed
---

> **ステータス確認(2026-08-07 機械grep実測)**: `VideoArchive`/`era_id`+`tags`+`category` の実装は `apps/` 全体で0件(grep実測)。ADR本文も「設計方針のみ・実装は別発注」と自己申告している一方、3階層の定義自体は選択肢を残さず確定済みの決定文になっている。`active`(決定確定)にすべきか`proposed`(未実装のまま)を維持すべきかは本タスクの範囲では判断できず、HQへ差し戻す(report frontmatterの`差し戻し`参照)。

# ADR: 文明史タイムライン(Global/User/Object 3階層)+ VideoArchive 設計(V3-WIK-21)

> 本文書は法的助言ではない。設計ドラフト(未実装)である。誇張ゼロ規約により、
> 「設計した」を「実装した」と混同しない。

## 状況(Context)

要件 V3-WIK-21(機能要件): 「すべての進化・変更・判断を時系列で保存し、いつでも読み返せる
記録庫(アーカイブ)を持たせる。Before/Afterの差分ビュー(Diff View)と文明の系譜(Lineage)で
世界観・構造の変化を可視化し、文明史をGlobal/User/Objectの3階層Timelineとして時系列可視化する。
動画はVideoArchive(era_id/タグ/カテゴリ)として保存する。」

第1波時点(`w1`)で `knowledge-timeline-routes.ts`(decision timeline)が土台として実装済みだが、
Global/User/Object の3階層分割とVideoArchive拡張は時間配分の都合で未着手のまま持ち越されていた
(`docs/planning/c8/progress.json` V3-WIK-21 note)。本ADRは**この艦(docs/knowledge・02-design/adr
専用・コード編集不可)の書いてよい場所内で行える範囲=設計の明文化のみ**を行う。**実装(route追加・
スキーマ追加)はこのADRの範囲外であり、別途コードレーンへの発注が必要。**

## 決定(Decision・設計案)

1. **3階層の定義**:
   - **Global**: サービス全体規模の判断・変更(規約改定・機能リリース等)。既存
     `knowledge-timeline-routes.ts` の decision timeline イベントをそのまま Global 階層の
     ソースとする(新規イベント型を増やさない・既存の再利用)。
   - **User**: 個々のユーザー単位の履歴(個体登録・投稿・設定変更等)。既存の各ドメイン
     イベント(`board_event`・`research/v1`等)を `actor_user_id` でフィルタした投影と
     位置づける(新規の常時集計テーブルを持たない=append-onlyのTruthを都度投影する既存
     パターンの踏襲)。
   - **Object**: 個体・掲示板投稿・論文等、個別オブジェクト単位の履歴(Before/After差分)。
     既存の `forked_from` 系譜パターン(`V3-WIK-32`のfork系譜再構成と同型)を踏襲し、
     専用の新規イベント型を作らずオブジェクトIDでのフィルタ投影とする。
2. **Diff View(Before/After)**: 各階層イベントの `payload` 差分を表示側で計算する
   (サーバー側で差分を事前計算・保存しない = 生イベントのappend-only性を維持し、表示専用の
   ロジックとする)。
3. **VideoArchive**: `era_id` / `tags` / `category` を持つメタデータのみを新設し、動画実体は
   既存のR2バケット規約(10年コスト最小の思想)に従い外部参照(URLキー)として保存する。
   動画のTruthイベント化は既存の `content`/`plaza-post` の投影パターンを踏襲する想定
   (詳細スキーマは実装フェーズで確定)。

## 結果(Consequence)

- 本ADRは**設計方針のみ**を確定する。実装(route・投影ロジック・VideoArchiveスキーマ)は
  別ラウンドのコードレーン(w-knowledge系)への発注が必要であり、本ADRの完了は
  V3-WIK-21 を `done` にする根拠にはならない。
- `docs/planning/c8/progress.json` の V3-WIK-21 は本ADR追加後も **`in_progress`** のまま
  維持する(型C設計文書は追加されたが、要件が明示する3階層Timeline route・VideoArchive
  スキーマの実コードが依然として存在しないため)。
- 次のコードレーンへの申し送り: 既存 `knowledge-timeline-routes.ts` を Global 階層のソースと
  みなし、User/Object 階層は新規テーブルを作らず既存Truthイベントの投影で実現する
  (reuse-first。専用ストレージの新設は不要という設計判断)。
