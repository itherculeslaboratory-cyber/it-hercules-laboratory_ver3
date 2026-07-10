---
type: Question
title: オープンクエスチョン（ギャップ・矛盾・次に調べること）
description: knowledge バンドルで未解決・要調査・人間ゲート待ちの論点
tags: [open-questions, gap, gate]
timestamp: 2026-07-09T00:00:00+09:00
---

# オープンクエスチョン

蒸留の過程で見えたギャップ・矛盾・次に調べること。解決したら該当 topic へ反映し、ここから消す（または解決日を付す）。

## 人間ゲート待ち（PROVISIONAL）

- **知の広場 IA 確定**: KN 既存 3 タブ（掲示板/記事/ブログ）と W2 3 柱（掲示板/論文/GitHub）の統合方針が未決（HG-KN-02）。その他板の柱所属（HG-KN-01）、論文板の柱（HG-KN-04）、記事/ブログ #24 の扱い（HG-KN-05）も未決。→ [knowledge-plaza](./topics/knowledge-plaza.md)
- **汎用引用の昇格タイミング**（HG-KN-06）: 柱間導線が引用に依存するため、柱確定と同時に昇格すべきか。`cite_refs` API 未設計。

## 実装ギャップ（観測・研究）

- **要件×実装 実装率 34%（RTM v1）**: 6 班調査をマージした横断 RTM は 167 項目中 実装済み 57（34.1%・対象外 10 を除くと 36.3%）。残りは部分実装 29 / 未実装 41 / 人間ゲート 30。主要な未実装ギャップ: カルマ月次バッチ・-100 BAN（FR-KRM-04/05/06）、貢献度 上流 10% 分配・プラチナ mint（FR-CONTRIB-03〜08 / FR-20-04）、掲示板 posting rescue（FR-BBS-07）、handle 重複チェック API（FR-REG-08/16）、`POST /listing-registry` 無認証（NFR-MKT-03/06・既知セキュリティギャップ）。09 論文 / 10 マチアプ の多くは civilization-os 側資産で IHL では対象外。→ [observation-pipeline](./topics/observation-pipeline.md) / [research-notes-model](./topics/research-notes-model.md)
- **rerank の color/size/lineage 成分が未実効**: `scoring.py` は現状 embedding 成分のみ計算し、色・サイズ・血統は欠測既定（0.5 / 0.5 / 0.0）。ADR-H-12 の重み（0.20/0.20/0.10）を活かす join 拡張が未実装。→ [observation-pipeline](./topics/observation-pipeline.md)
- **PaperSectionsV1 / Citation API 未実装**: 6 節 CRUD・Citation INSERT・`content_id` ルーティングは仮採用設計のみ。W2 lab は screen id 段階。→ [research-notes-model](./topics/research-notes-model.md)
- **board 投稿一覧 GET が API 未配線**: `BoardStore.thread_posts` は実装済みだが GET が未配線。K2 ingest の前提として配線が必要（DESIGN §6-1）。

## サブブレイン運用の検証課題

- **自己検証未実施**（Second Brain 原則 5）: 同じ質問セットを「wiki 経由」vs「ベタ読み」で比較し、トークン・時間・正確性で wiki が勝つかを未計測。K2/K3 で計測する。
- **テキスト埋め込み検索の第 2 段**: 数百ページ規模になった時の `EmbeddingBackend.embed_text` 追加 / qmd 導入は未決。当面は index.md 梯子で足りる想定（DESIGN §6-3）。

## 運用の教訓（本日 I1 で発見・根治済み）

解決済みだが再発防止のため残す。同種の失敗を次回検出できるよう記録する。

- **middleware は `src/` 直下に置かないと認証ゲートが実質無効**: `apps/web/middleware.ts` が `src/` の外にあり Next.js が読み込んでおらず、認証ゲートが働いていなかった（重大バグ）。正しい位置へ移して修復。ルート保護のようなセキュリティ機構は「置いただけで効いている」と仮定せず、未ログインで実際に弾かれるか e2e で確認する。→ ログイン RTM の `FR-LOGIN-06/08` セッション解決と対。
- **e2e とローカル Truth ストアの分離**: e2e が本物のローカル Truth ストアに書き込み、テスト実行が append-only データを汚染していた（残渣 183 ファイル）。`conftest` で書き込み先を密閉して根治。**Truth は append-only（UPDATE/DELETE 禁止）ゆえ、汚染は消せない** — テストは常に隔離ストアへ書く前提を崩さない。knowledge バンドルの ingest 実演を tmp バンドルで行い本バンドルへ非混入としたのも同じ原則。
- **magic-link トークンの URL エンコード漏れ**: 生成リンクのトークンが URL エンコードされず、特定文字で検証が落ちる実バグを修正。トークン等の可変文字列を URL に載せる箇所は必ずエンコードする。→ `NFR-LOGIN-06` 本番 SMTP は別途人間ゲート。

## 情報源の相互運用

- **D:\notes と docs/knowledge の境界**: 個人の作業ログ・アイデアは D:\notes、IHL のドメイン知識は docs/knowledge、という切り分けの運用実績がまだない。撮影チャンバーのように両方に関わるページの正本をどちらに置くか、運用しながら確認する。→ [shooting-chamber](./topics/shooting-chamber.md)
