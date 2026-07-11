---
id: RULING-2026-07-11-R12
title: ver3 ユーザー裁定記録 — 2026-07-11 第12回(LICENSE 確定 = Apache 2.0・トークン目標 3000k→4500k)
date: "2026-07-11"
status: active
---

# ver3 ユーザー裁定記録 — 2026-07-11 第12回

> 入力: チャット直答(/remote-control・外出先)。新規採番なし・件数変動なし(総数 725 のまま)。

## 1. ユーザー回答原文(全文・忠実転記)

> budget完成度が良くなるなら、3000kから4500kに引き上げてもいいよ？
>
> あと、LICENSE今質問したかったら、答えやすく推奨付きで聞いてくれたら答えるよ。

AskUserQuestion(候補比較 4 択: Apache 2.0 推奨 / AGPL-3.0 / MIT / 保留)への回答:

> "Apache 2.0 (Recommended)"

## 2. 裁定

| # | 項目 | 結論 | 処置 |
|---|---|---|---|
| 1 | 人間ゲート「LICENSE 確定」 | **承認: Apache License 2.0** に確定 | 候補本文 `docs/planning/c5/license-material-apache-2.0.txt` を repo 直下 `LICENSE` へ昇格。`scripts/check-public-docs.mjs` の REQUIRED_PUBLIC_DOCS に LICENSE を復帰。status.md 人間ゲート表を「済」へ。**公開の実施は別ゲートのまま(未)** — LICENSE 確定は公開判断を含まない |
| 2 | 自律ラン トークン目標 | **+3000k → +4500k へ引き上げ**(完成度優先の条件付き承認) | 増分は品質側に配分: クラスタ統合による批評家削減をやめ全クラスタ個別批評家 2 本を維持・C5 完了時にフェーズ横断監査批評家を追加 |

## 3. 反映・検算

- レジストリ・srs: 変更なし(要件文の変更を伴わない人間ゲート裁定のため)。総数 **725** 維持 ✓。
- HANDOFF-c5-c6 §0 の残人間ゲート一覧から「LICENSE」を消化(公開・GMO 本番・collector 実鍵・cutover・HG-KN-01〜08 は未のまま)。
