# docs/knowledge — 更新ログ

`## YYYY-MM-DD` 見出し + `**Initialization**` / `**Ingest**` / `**Lint**` / `**Creation**` エントリ。月次 Lint もここに残す。

## 2026-07-17

* **Creation**: [unified-search-rag](./topics/unified-search-rag.md)(V3-AIP-90)を新設 — 観測パイプラインの決定論梯子(metadata→cosine→rerank)と wiki 統合基盤の技術選定(ruri-v3-70m・384次元)を、掲示板/UI/テンプレートへ「新規ベクトルDBなし」で横展開する設計。index.md に1行追加(同一変更)。

## 2026-07-09

* **Ingest**: `python tools/knowledge_ingest.py scan` を本番環境で実行 — 新規 board/research イベント 0 件（ローカルに Truth ストリームなし）。スタブ生成なし。蒸留サイクルの実演は tmp バンドルの合成イベントで別途検証（本バンドルには非混入）。
* **Initialization**: `PLAN-knowledge-bundle-bootstrap.md`（K1）に従い `docs/knowledge/` バンドルを新設。[CLAUDE.md](./CLAUDE.md)・[index.md](./index.md)・本 log.md・[open-questions.md](./open-questions.md)・[sources/index.md](./sources/index.md) を作成。前提設計は [`DESIGN-subbrain-knowledge-layer.md`](../planning/claude-plans/DESIGN-subbrain-knowledge-layer.md)。
* **Creation**: 既存資産から最初の topics 5 ページを蒸留 — [breeding-environment](./topics/breeding-environment.md)（`observation_target_domain.yaml` · `biological_rank.yaml` · `value_origin.yaml` · `01-要件/05-観測.md` 環境 IoT）、[observation-pipeline](./topics/observation-pipeline.md)（`libs/ihl/observation/embedding.py` · `scoring.py` · `05-観測.md §4.8`）、[knowledge-plaza](./topics/knowledge-plaza.md)（知の広場 MASTER-v1 · 04-汎用引用-v1、PROVISIONAL 明記）、[research-notes-model](./topics/research-notes-model.md)（知の広場 02-論文-v1、PROVISIONAL 明記）、[shooting-chamber](./topics/shooting-chamber.md)（`D:\notes\projects\2026-07-shooting-chamber.md` を出典に、D:\notes 側と相互リンク）。
* **Creation**: ルート `CLAUDE.md` の「読む順」末尾に本バンドルへの導線 1 行を追記。
* **Harvest**: 本日の実行（I1/R）から IHL ドメイン知見を既存ページへ追記（新ページ非作成）。① [research-notes-model](./topics/research-notes-model.md) に「科学OS統合の docs 成果物」節を追加（観点辞書 v0 / 論文テンプレート JSON Schema v0 / AI査読チェックリスト v0 の 3 点、出典 `docs/planning/claude-plans/DESIGN-science-os-integration.md` + `docs/planning/science-os/*.md`）。② [open-questions](./open-questions.md) 実装ギャップ節に RTM v1 実装率 34%（57/167）と主要未実装ギャップを追記（出典 `docs/planning/claude-plans/RTM-requirements-implementation-v1.md`）。③ open-questions に「運用の教訓」節を新設 — middleware 認証ゲート無効化バグ・e2e/ローカル Truth 分離（append-only 汚染は不可逆）・magic-link URL エンコード漏れの 3 教訓を記録。index.md はページ増減なしのため据え置き（突合維持を確認）。
