<!--
このPRテンプレートは CONTRIBUTING.md の PR 規約(批評家ゲート必須・実装単位=要件ID)を
チェックリスト化したものです。該当しない項目は理由を添えて削除して構いません。
-->

## 対応する要件ID

- `V3-XXX-NN`: <!-- 必須。1要件ID = 1実装 + 1テスト + 1コミット(CONTRIBUTING.md) -->

## 変更内容

<!-- 何を・なぜ変更したか -->

## チェックリスト

- [ ] 対応する要件ID(`V3-XXX-NN`)を上に記載した
- [ ] 1要件ID = 1実装 + 1テスト + 1コミットになっている
- [ ] **批評家ゲート必須**: 独立批評家(仕様適合・出典実在・網羅・矛盾)を通した(rubber-stamp禁止)
- [ ] `npm test` / `python -m pytest -q` が緑
- [ ] `npm run lint` が緑
- [ ] CL negative TC(`tests/` の CL-01〜13)を割っていない
- [ ] `docs/generated/`・`packages/**/src/generated/`・`rtm.csv`/`rtm.md` 等の生成物を手編集していない
- [ ] シークレット実値・PII を含んでいない

## 関連Issue

Closes #
