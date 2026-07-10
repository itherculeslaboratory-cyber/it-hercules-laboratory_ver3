---
id: V3-CONTRIBUTING
title: 貢献規約（最小）
date: "2026-07-10"
status: draft
---

# 貢献規約

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
