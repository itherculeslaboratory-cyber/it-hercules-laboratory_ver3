---
id: RULING-2026-07-18-R17
title: ver3 ユーザー裁定記録 — 2026-07-18 第17回(個体ファインダー正式採番=R45裁定+C9構造正本承認の要件化)
date: "2026-07-18"
status: active
---

# ver3 ユーザー裁定記録 — 2026-07-18 第17回

> 入力(逐語原本): `D:\claude\00-hq\feedback\persona-model.md` R45行(2026-07-17)・R50行(2026-07-18) / 適用先設計: `docs/planning/c8/design-individual-finder.md`(波0(b))・承認済み構造正本 `docs/planning/c9/structure-canon.md`(commit b746039)。
> 総数 **749 → 750**(新規採番1件・V3-UIX-83)。既存 patch なし。req_status: 確定 659→660。wave: 第1波 354→355。srs v1.10 → **v1.11**。
> 自律実行理由: `design-individual-finder.md` 波0(b)「T-42をihl-ver3のregistry.jsonへ正式要件として採番」の実施。R45裁定(「絶対にIHLver3に実装する」)+2026-07-18承認(構造正本骨子=個体ファインダーの位置確認)により実装前提ゲート(a)(ui-redesign-round2整合)は別途、ゲート(b)(本要件採番)を本裁定で充足する。参照: round-17 / T-63。

## 1. ユーザー回答原文(逐語・要約禁止)

> 出典1 = `D:\claude\00-hq\feedback\persona-model.md` R45行(2026-07-17・PR-3理想個体ファインダー試作への評価)。

「これ最高ですよ!参考にしてください。**絶対にIHLver3に実装する**。これができたプロセスを調べ上げて、学習して、どうやって私の理想の個体ファインダーが作れたかを。**これほんとに学習してほしい**」

> 出典2 = `D:\claude\00-hq\feedback\persona-model.md` R50行(2026-07-18・ihl-ver3 C9第1判断=構造正本骨子への回答)。

「承認します。とてもレビューしやすかったです。ありがとうございます。　今後も期待しています。進めてください。」

## 2. 記録のみ(採番不要)

1. **C9構造正本骨子の active 昇格(採番不要・記録のみ)**: `docs/planning/c9/structure-canon.md` は §1「新設2」で個体ファインダーの位置(IND内探索モード・トップナビ項目にしない)を既に確定記録済み。上記 §1 出典2 の承認により本文書は `status: draft → active` へ昇格済み(commit `b746039694a68615563241d7e1148acb7a0ce049`、2026-07-18)。語彙エントリ1〜10も同時に正式化済み。本裁定はこの既定事実を固定記録するのみで、構造正本自体への新規変更は行わない。

## 3. 処置表

| 項目 | 結論 | 出典 | 処置 |
|---|---|---|---|
| C9構造正本骨子(9ゾーン+語彙10語) | 記録のみ(承認は commit b746039 で既に反映済み) | §1出典2 | §2-1。registry.json 変更なし |
| 個体ファインダー要件化(design-individual-finder.md 波0(b)) | 新規採番 | §1出典1・出典2 | §4。V3-UIX-83 |

## 4. 新規採番表

| id | statement要旨 | wave | 理由 |
|---|---|---|---|
| V3-UIX-83 | 個体ファインダー(IND内探索モード): 一覧・絞り込み(決定論sort=体長/体重/観測回数/直近記録)+個体詳細パネル+血統ツリー(選択時のみ先祖/子孫色分け・親→子フロー)を第1波MVPとする。宇宙表示(ego-graph/全体)・胸角/色sort・embeddingは後続波 | 第1波 | R45「絶対にIHLver3に実装する」(最高評価)の直接要求。MVP範囲は既存API(`listIndividualsFor`/`projectIndividualProfile`/`buildPedigree`)のみで成立し新規バックエンド不要(design-individual-finder.md §2.1・§2.3)なため第1波残務に収まる規模。V3-UIX-82(検索グラフビュー=ego-graph)・全体宇宙投影・胸角/色sort拡充・embedding ON波は同設計書§5の波2-5として意図的に対象外(スケールの異なる別要件・混同禁止) |

採番規則: 当該接頭辞(V3-UIX)の registry 実測最大値(82)+1。req_status=確定・human_confirm=false(R1金銭/対外契約に非該当のため人間ゲート化不要)。

## 5. 検算

再現コマンド: `"C:\Users\sawad\AppData\Local\Programs\Python\Python312\python.exe" -c "import json; d=json.load(open('01-requirements/registry.json',encoding='utf-8')); print(len(d))"` 等(以下は実測値)。

適用前(round-16実測): 総数 **749** / req_status 確定659・確定(修正)87・棄却3 / wave 第1波354・第2波238・実験枠21・対象外136 / group g07-UIUX 80。

適用後(実測): 総数 **750** / req_status 確定**660**・確定(修正)87・棄却3 / wave 第1波**355**・第2波238・実験枠21・対象外136 / group g07-UIUX **81**。

- 結論合計 == 総数: 660(確定) + 87(確定(修正)) + 3(棄却) = **750** ✓
- 波構成合計 == 総数: 355(第1波) + 238(第2波) + 21(実験枠) + 136(対象外) = **750** ✓
- 総数: 749 → **750**(+1新規・V3-UIX-83のみ。既存18件のような patch なし)。確定 659→**660**(+1)。確定(修正)・棄却は不変。
- srs: v1.10 → **v1.11**。
