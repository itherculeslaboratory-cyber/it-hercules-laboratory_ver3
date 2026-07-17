---
id: c8-design-obs-53-mm-precision-scale
title: 写真1枚からmm精度を得る観測システムの設計図/スケールシート — V3-OBS-53/45
date: "2026-07-17"
status: active
---

# mm精度観測システム 設計図(V3-OBS-53) + スケール紙標準(V3-OBS-45)

> V3-OBS-53「写真1枚からmm単位精度で色・光度・湿度・温度を取得・記録できる観測
> システムと設計図/スケールシートを提供する」の設計図。V3-OBS-45(スケール紙標準化)
> の実装済み部分(定数)と、未実装(client-side CV)の境界を明示する。

## 1. 実装済み(このC8ラン・obs-analysisレーン)

| 要素 | 実体 | 状態 |
|---|---|---|
| スケール紙の物理仕様 | `apps/api/src/observation-constants.ts` `SCALE_PAPER`(A4 19×26cm方眼・四隅マーカー10mm角・QR15mm角・1mm薄線/10mm太線・許容誤差±0.2mm) | 確定・凍結相当(値を変えるならTC緑化必須) |
| 実寸換算の式 | `apps/api/src/observation-constants.ts` `calibratedRealLengthMm(pixelLength, markerPixelLength, markerRealMm)` = `pixelLength × (markerRealMm / markerPixelLength)` | 実装済み・TC: `tests/observation-ext.test.ts` describe("OBS-45/53 calibratedRealLengthMm") |
| 撮影時の環境値(温度/湿度) | `apps/api/src/observation-routes.ts` `validatePhotoConditions`(OBS-28・偽装値拒否+閾値アラート) | 既存実装(先行ウェーブ) |
| 色特徴量の解析ノード | `components/obs-manifest/lab_features.py`(V3-OBS-14・部位別L\*a\*b\*+ヒストグラム、ピクセル領域を受け取る側) | 実装済み(領域抽出は下記2の担当) |

## 2. 未実装・後続wave(client-side・別レーンの担当)

以下は**ブラウザ側**(V3-AIP-104: スマホ/端末ローカル第一・サーバ側重処理なし既定OFF)
で実行する前提であり、本レーン(バックエンド/パイプライン中心)のスコープ外。
実装には「どのCVアプローチを採るか」というアーキテクチャ判断が要るため、
推測実装せず明示的に残す:

1. **四隅マーカー自動検出+射影変換**(OBS-45): 写真からスケール紙の四隅を検出し
   歪みを補正する。候補: 自前の最小限Canny/Hough実装 vs 軽量WASM CVライブラリ。
   OpenCV.js(重量級)は既存の要件statementで明示的に回避対象。
   → **判断待ち**: どちらの方式を採るかはUI/フロントエンドレーンとの協調が必要な
   アーキテクチャ分岐(ユーザー影響=バンドルサイズ/読み込み時間)。
2. **撮影直後ローカル解析**(OBS-47): HSV/Lab色空間・輪郭抽出・サイズ推定・
   ダメージ検出を端末内で実行し、ユーザーが目でダブルチェックする一連のUI+
   画像処理コード。上記1のCV基盤に依存する。
3. **LabelMe相当アノテーション統合**(OBS-46): 既存OSSのLabelMeをiframe+
   postMessageで統合(自作しない)。バックエンド側の受け皿(append-only
   `POST /observation/annotations`)は実装済み・テスト済み(`tests/
   obs-annotations.test.ts`)。iframe統合自体はフロントエンド作業。

## 3. データ契約(既に繋がっている部分)

クライアント側で算出された値(実寸mm・色・部位特徴等)は、既存の汎用契約で
そのままTruthへ書き込める(新スキーマは不要):

- 測定値: `measurements[].value_origin = "image_derived"`(既存9値enum・
  `apps/api/src/observation-routes.ts` `measurementValueOriginError`でゲート済み)
- 注釈/座標: `POST /observation/annotations`(OBS-46・append-only・
  `value_origin`任意付与)
- 撮影時条件: `photo_conditions`(OBS-28・偽装拒否込み)

したがって後続waveの実装者は「新しいAPIを設計する」のではなく、
「クライアントで計算した値をこの既存契約に流し込む」だけで完結する設計になっている。
