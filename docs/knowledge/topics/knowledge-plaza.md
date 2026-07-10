---
type: Topic
title: 知の広場（3柱と汎用引用）
description: 知の広場の3柱IAと汎用引用スキーマの設計要約（PROVISIONAL・ゲート中）
tags: [knowledge-plaza, board, citation, provisional, w2]
timestamp: 2026-07-09T00:00:00+09:00
---

# 知の広場（Knowledge Plaza）

> **ステータス**: **仮採用（PROVISIONAL・ゲート中）**。W2 checkpoint の設計たたき台であり、設計ゲート 5 点未通過。人間が本採用 Go を出すまで拘束力なく、実装は禁止。「決定済み」ではない。

## メンタルモデル

> 知の広場 = 「話す（愚痴・改善）」「検証する（論文）」「改善履歴を見る（GitHub）」の 3 面が、ホーム左ナビ 1 クリックで開くコンテンツ Hub（`/knowledge`）。

掲示板の雑談・改善、論文の条件検証、GitHub の開発改善ログは**入口・主タスク・Truth 保存先が異なる**ため、W2 では**タブではなく柱（pillar）**として並列化している。

## 3 柱（仮採用）

| 柱 | 主タスク | Truth / 正本 | ルート案 |
|---|---|---|---|
| P1 公式掲示板 | 愚痴・改善を読み書き | R2 ThreadEvent / PostEvent（ADR-H-10） | `/board/complaint` · `/board/improvement` |
| P2 論文 | 進行中論文・Paper Match・テンプレ | Content append-only · Paper Match API | `/board/paper`（→ `/knowledge/papers/:id`） |
| P3 GitHub 掲示板 | 改善履歴を link-out で見る | GitHub Issues · `docs/components/*/BOARD.md` · giscus | `/knowledge/github`（新設案） |

柱 1 は ADR-H-07 の 4 入口のうち愚痴+改善のみ。論文板は柱 2、その他板は人間ゲート（HG-KN-01）。

## 汎用引用（Universal Cite）

3 柱をまたいで観測・投稿・論文・ユーザー・タグを 1 クリックで参照する横断契約。

| 要素 | 形式 | 役割 |
|---|---|---|
| インライン token | `[ihl:cite type=id]` | 本文中の機械可読マーカー（表示用） |
| 構造化配列 | `cite_refs: [{ type, id, label?, post_id? }]` | **正本**（token より優先）。PostEvent / Content メタに保持 |
| 発言鍵 | `post_id` | 掲示板発言の安定 ID（ADR-H-10 PostEvent） |

`CiteRef` は union 型で `observation` / `individual` / `cross` / `content` / `post` / `thread` / `user` / `tag` / `template` / `market_listing` / `tombstone` を持つ。引用先が非公開・削除済みなら本文を壊さず tombstone mini-card を表示し、Citation イベント自体は削除しない（INSERT ONLY）。

## 分離原則（混同禁止）

| 対 | 通知・検索チャネル | 根拠・出典チャネル |
|---|---|---|
| ユーザー | `@mention`（通知・返信期待） | user cite（プロフィール mini-card） |
| タグ | `#hashtag`（横断検索・フィルタ） | tag cite（`tag_event` 状態の根拠参照） |
| 投稿 | `>>N`（板内表示専用アンカー） | `post_id`（グローバル安定 · permalink 正本） |

permalink は INSERT ONLY の ID に紐づき、編集で URL が変わらない。preview は self-hosted（外部 oEmbed 非依存・観測 blob 認証と整合）。

## 正本と人間ゲート

- **正本は git**（GitHub 正本パターンの水平展開）。R2 ミラーは知の広場 UI 実装時に検討。
- 未決の人間ゲート（MASTER §5）: その他板の柱所属（HG-KN-01）、KN 既存 3 タブ（掲示板/記事/ブログ）と W2 3 柱の統合（HG-KN-02）、論文板の柱（HG-KN-04）、記事/ブログ #24 の扱い（HG-KN-05）、汎用引用の昇格タイミング（HG-KN-06）。

# Citations

- 3 柱 IA・RTM・人間ゲート: [`docs/planning/w2-checkpoint/知の広場-仮採用-MASTER-v1.md`](../../planning/w2-checkpoint/知の広場-仮採用-MASTER-v1.md)
- 汎用引用スキーマ・分離原則・permalink: [`docs/planning/w2-checkpoint/知の広場-仮採用-04-汎用引用-v1.md`](../../planning/w2-checkpoint/知の広場-仮採用-04-汎用引用-v1.md)
- サブブレインでの位置づけ: [`docs/planning/claude-plans/DESIGN-subbrain-knowledge-layer.md`](../../planning/claude-plans/DESIGN-subbrain-knowledge-layer.md)
