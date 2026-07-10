> 正本は AGENTS.md — 本ファイルは同内容複製(CI 同期チェック対象)。

---
id: agents-guide
title: AI 入口の正本（ver3）
date: "2026-07-10"
status: active
---

# AGENTS.md — ver3 AI 入口（正本）

> このファイルが AI 向け規約の唯一の正本。`CLAUDE.md` は本ファイルの同内容複製（CI 同期チェック対象）。
> 詳細は各リンク先へ。ここには規約と禁止事項だけを命令形で置く。

## 読む順（この順で読め）

1. `README.md` — 単一 repo 宣言・clone・読む順
2. `docs/onboarding.md` — 30 分で立ち上がるパス
3. `docs/architecture.md` — レイヤー・feature→code の地図
4. `02-design/constitution.md` — 設計書憲法 v2（C1〜C6）
5. `docs/planning/status.md` — 今どこ・人間ゲート待ち
6. AI は加えて `llms.txt` を先に読め（厳選索引）

## 5 不変条項（全要件・全設計に優先する）

1. **10 年ランニングコスト最小** — 常駐 DB を SSOT にするな。派生値は都度再計算。LLM/Vision/FAISS は既定 OFF。ID/Index は使う瞬間だけ発行。
2. **フォーク文化** — 正本は GitHub 一本・全ソース単一 clone 公開。改善は Component 単位 fork + lineage。少数固定骨格 + fork 拡張。
3. **Truth は append-only** — R2 は INSERT ONLY。UPDATE/DELETE 禁止。修正は新 record/snapshot。同一キー再 put は 409。PII は不使用フラグで論理無効化。
4. **人間ゲート文化** — 不可逆・公開・金銭は人間が裁定。設計 4 点確定まで実装するな。sandbox 改善は明示 Promote まで本番へ流すな。
5. **検証されないものは納品されない** — 独立批評家（正しさ/回帰/設計整合）通過が納品条件。V-model 5 点ゲート全通過。機械 GATE PASS を人間の完成宣言より優先。

> 出典: `01-requirements/srs.md` §1.2（`ver3-最終要件定義書-v1.md §1.2`）。

## 禁止事項（違反はコミット・PR を止める）

- **シークレット実値**を読む・出力する・コミットする（`.env` 実値・API キー・GMO 開発キー）。置いてよいのは `.env.example` の型だけ。
- **生成物の手編集**（`docs/generated/**`・`packages/**/generated/**`・`04-traceability/rtm.csv|md`）。`<!-- GENERATED -->` ヘッダを消すな。直すなら正本を直せ。
- **`schemas/frozen/` の変更を対応 TC 緑化前に行う**（CL-01〜13 形式凍結）。
- **ファイル名に版番号サフィックス**（`-v1.md` 等）を付ける。版は frontmatter `status` + git 履歴で持て。
- **非 ASCII・空白・日本語のパス名**。ディレクトリ・ファイル名は英語 kebab-case。日本語は frontmatter `title` と本文へ。
- **AI 中間生成物のコミット**（quantum shards・分解ログ・WorkOrder JSON）。作業ログは HQ `D:\claude\ops\` か scratchpad へ。
- **ユーザー向け UI への「未実装」「WIP」表記**（V3-UIX-01）。
- **R2 / Truth の UPDATE・DELETE**（不変条項③の再掲。最重要）。

## スキーマの正本

- `schemas/` が全スキーマの唯一正本（JSON Schema draft 2020-12）。
- 設計文書・コードはスキーマを複製せず `schemas/` へリンクせよ。TS 型・Python モデル・解説 md は codegen で生成物として出す。
- codegen の向きは `schemas/ → generated` の一方向のみ。逆流禁止。

## テスト・lint

```bash
npm run lint     # filename・生成物・agents 同期・schema・frontmatter を機械 GATE
npm test         # apps/api（vitest run）
pytest -q        # components/*/tests・libs（Python パイプライン）
```

- lint / GATE が赤なら緑になるまで納品するな（不変条項⑤）。
- CL-01〜13 negative TC の緑化は Phase C の最優先タスク（`docs/planning/status.md`）。

## 人間ゲート 5 種（AI は完成品まで作れ・ここだけ止まれ）

1. 公開の実施
2. 実鍵・本番鍵の投入
3. 金銭（GMO 実入金等）
4. 物理治具
5. 撤回台帳 R-1〜R-9 の復活

> 上記以外の可逆な作業は承認を待たず進めよ。不可逆・対外操作のみ実行直前に一言報告せよ。
