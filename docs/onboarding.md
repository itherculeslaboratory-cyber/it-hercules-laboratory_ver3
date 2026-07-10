---
id: V3-DOC-ONBOARDING
title: オンボーディング — 30 分で最初の PR まで
date: "2026-07-10"
status: approved
requirement_ids: [V3-AIP-61]
---

# オンボーディング — 30 分パス

> 新規 contributor（AI / 人間）が clone から最初の PR までを 30 分で通す最短経路。詳細は各リンク先へ。

## 1. clone（3 分）

```bash
git clone https://github.com/itherculeslaboratory-cyber/it-hercules-laboratory_ver3.git ihl-ver3
cd ihl-ver3
cp .env.example .env   # 実値は各自ローカルのみ。コミット禁止
```

## 2. 読む順（10 分）

1. `README.md` — 単一 repo 宣言・全体マップ
2. `AGENTS.md` — AI 入口の正本（命令形規約・禁止事項）
3. `docs/architecture.md` — 6 点骨格・レイヤー・依存 DAG
4. `02-design/constitution.md` — 設計書憲法 v2（C1〜C6・命名・批評家ゲート・MVP-規約 10 要件）
5. `docs/planning/status.md` — 今どこ・人間ゲート

## 3. install & test（10 分）

```bash
npm install                 # workspace（apps/ packages/）
npm test                    # TS ユニット + 契約テスト
npm run build               # apps/web の型チェック + ビルド
python -m pytest -q libs/   # Python パイプライン（components/ の run.py が使う libs）
```

CL-01〜13 の negative TC は `tests/` に常駐。green が出ることを確認する。

## 4. 最初の PR（残り）

- ブランチを切る（`main` へ直接 push しない）。
- 変更は 1 トピック。md には frontmatter 必須（`id`/`title`/`date`/`status`）。
- **批評家ゲート**（`02-design/constitution.md` §6）を自己チェック: 仕様適合・出典実在・intent 網羅・矛盾検査・実測エビデンス。
- スキーマを変えたら upcaster テストを同梱。生成物（`docs/generated/` 等）は手編集しない。
- CI（filename lint / frontmatter / GENERATED 照合 / schema validate / CLAUDE↔AGENTS 同期）が緑になったら PR。

> 公開実施・実鍵投入・金銭・物理鍵は人間ゲート。触れる場合は停止報告（V3-AIP-31）。
