---
id: V3-CONTRIBUTING
title: 貢献規約（最小）
date: "2026-07-10"
status: draft
requirement_ids: [V3-AIP-23]
---

# 貢献規約

## セットアップ（30 分パス — repo ルート相対）

clone は常に repo ルート相対で辿る（絶対パス・ローカル配置依存の手順は書かない — design-impl parity 不整合の原因）。

```bash
git clone https://github.com/itherculeslaboratory-cyber/it-hercules-laboratory_ver3.git ihl-ver3
cd ihl-ver3
npm install
npm test                    # apps/api + tests + apps/web
python -m pytest -q         # components/*/tests・libs
```

詳細な読む順・30 分オンボーディングは `docs/onboarding.md` を正本とする（ここでは重複させない）。

## `#NN` の選び方（次に何をやるか）

- 要件 ID（`V3-XXX-NN`）が唯一の作業単位。GitHub Issue の `#NN` を切る場合も本文に対応する要件 ID を 1 件以上記載する（`.github/ISSUE_TEMPLATE/bug-report.md` の「関連 ID」欄を参照）。
- 優先順は `docs/planning/c8/progress.json`（`tier`: S > A > B > C、`scope: "required"` を先に）→ `docs/planning/status.md`（今どこ・人間ゲート）で確認する。
- 迷ったら tier が高く `status: "todo"` のものから 1 件ずつ着手する。実装単位は要件 ID ごとに 1 実装 + 1 テスト + 1 コミット。

## PR 規約

- **批評家ゲート必須**: 成果物は独立批評家（仕様適合・出典実在・網羅・矛盾）を通してから PR に載せる。rubber-stamp 禁止。
- **CL negative TC を割らない**: `tests/` の CL-01〜13 negative TC は常時緑。赤くする変更はマージ不可。`schemas/frozen/` の変更は対応 TC 緑化とセットでのみ。
- **生成物の手編集禁止**: `docs/generated/`・`packages/**/src/generated/`・`rtm.csv`/`rtm.md` は codegen 出力。`<!-- GENERATED -->` ヘッダ付きファイルを手で編集しない。正本（json/schema/frontmatter 付き md）を直して再生成する。

## 命名・衛生

- ディレクトリ・ファイル名は英語 kebab-case（非 ASCII・空白・版番号サフィックス禁止）。
- md には YAML frontmatter 必須（`id`, `title`, `date`, `status`）。
- シークレット実値・PII は読まない・出力しない・コミットしない。`.env.example` はキー名 + ダミー値のみ。

## テスト

`README.md` のテストコマンド参照。新規ロジックは V-model 5 点ゲート後に retrofit テスト追加可。
