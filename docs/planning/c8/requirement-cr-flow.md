---
id: c8-requirement-cr-flow
title: 要件CRフロー(grilling確定事項→要件への環流) — V3-OBS-73残余
date: "2026-07-17"
status: active
---

# 要件CRフロー(grilling確定事項→要件への環流)

> V3-OBS-73(データエクスポート二層+要件CRフロー)の残余分。データエクスポート二層
> (`GET /export/facts.csv` / `GET /export/photos.csv`)は実装済み(`apps/api/src/
> individual-routes.ts`・`tests/individual.test.ts` describe("V3-OBS-73 …"))。
> 本ドキュメントは残る「grillingで確定した事項を要件へ環流させるCRフロー」を、
> **既にこのプロジェクトが繰り返し実行してきた手順を形式化するだけ**で満たす
> (新しいツール/自動化は増やさない — round-15/round-16裁定自体がこのCRフローの
> 実例そのもの)。

## フロー(5ステップ・既存実績のformalize)

1. **grilling(裁定質問シートでの議論)** で仕様の矛盾/未確定点が見つかる
   — 例: `docs/planning/rulings/round-16-question-sheet.md`。
2. **ユーザー裁定**として `docs/planning/rulings/user-ruling-<date>-round-<N>.md`
   に逐語記録する(質問・推奨・裁定・材料の4点セット)。
3. **要件正本(`01-requirements/registry.json` + `01-requirements/srs.md`)へ
   反映**する。新規事項は新規 `V3-<CLUSTER>-<NN>` を採番、既存事項の修正は
   `確定(修正)` へ状態遷移させ、srsの変更履歴に当該裁定回を明記する(round-16
   で実施した「新規採番14件+既存18件patch」がこのステップの実例)。
4. **`docs/planning/c8/progress.json`/`progress.md`へ反映**し、当該要件IDの
   `note`に裁定回番号を残す(裁定の出典を辿れるようにする — 出典なき変更をしない)。
5. **実装レーンへ配分**(このHANDOFFの「§3 残作業」がその配分表)。

## 適用範囲・非対象

- 本フローは**ドキュメント作業手順**であり、コード/スキーマの自動生成は伴わない
  (不変条項①: 常駐ツール・自動化を増やさない)。
- 撤回台帳R-1〜R-9の復活・公開実施・実鍵投入等の人間ゲート事項は、このCRフロー
  を経てもなお人間裁定が必要(このフローは要件記述の更新経路であって、人間ゲート
  を代替しない)。

## 検証

- 出典なき要件変更がないことは `01-requirements/srs.md` の変更履歴(各版が対応する
  裁定回を明記)で目視確認できる。機械テストは対象外(ドキュメント運用手順のため)。
