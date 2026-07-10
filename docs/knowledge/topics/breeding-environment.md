---
type: Topic
title: 飼育環境の知識（環境ドメイン・環境IoT）
description: 観測対象の「環境」ドメインと、飼育環境データ（温度・湿度・照度）の取得・保存規約
tags: [observation, environment, iot, breeding, append-only]
timestamp: 2026-07-09T00:00:00+09:00
---

# 飼育環境の知識

## 観測ドメインとしての「環境」

観測は昆虫専用ではない（ADR-H-16）。観測対象は 5 ドメインに分岐し、その最初の分岐をナビゲータが使う。

| ドメイン | 葉ランク | 亜種必須 | 例 |
|---|---|---|---|
| 生物 (biological) | subspecies | ○ | 動物・植物・菌類。亜種まで到達（不可なら「亜種未区別（種まで）」を明示） |
| 器物 (artifact) | item | – | 皿・容器・工具などの人工物 |
| デジタル (digital) | work | – | ゲーム作品・ソフトウェア |
| **環境 (environment)** | place | – | **飼育ケース・棚・部屋など観測の「場」** |
| カスタム (custom) | custom | – | 自由対象（弱 enum・タグのみ） |

「環境」ドメインは飼育の「場」を表し、Phase 3 で Placement（棚・QR）と接続する（OBS-ENV-03）。生物ドメインは kingdom→subspecies の 8 ランク（界・門・綱・目・科・属・種・亜種）を持ち、検索 facet に出すのは目以下のみ（タグ過多回避）。同定の確定は常にユーザーで、GBIF/Wikidata はテキストメタの候補根拠に留まる（画像取得はしない）。

## 環境データの 2 モデル分離（ADR-H-36 B モデル）

飼育環境の状態点 `environment_snapshot` と撮影条件 `photo_conditions` を**分離**する。写真がある観測では snapshot を除去し、撮影条件側に寄せる。サーバ secret による snapshot 正本取得は禁止（ADR-H-30）。

## 保存列 — 生値のみ、派生は保存しない

CSV v1 の保存列は **温度・湿度・`light_level`** の 3 つ。

- `light_level` は SwitchBot の**離散レベル**（lux ではない）。照明そのものは手入力のみ（OBS-RX-ROW-11）。
- **保存しない**: DPT（露点）・VPD（飽差）・絶対湿度（ADR-H-31/35）。これらは生値から再計算できる派生値であり、保存最小・決定論優先の原則により Truth には残さない。

## 取得経路（append-only）

- **SwitchBot**: 手動取り込み または定期 poller → R2 `env-samples/{YYYY-MM-DD}/{sampleId}.json` + index（OBS-ENV-02）。precheck で 5 分類、秘密値は非表示。
- **ローカル collector**: Ed25519 署名付きで env ingest（OBS-ENV-04）。秘密は `collector/.env` のみに置く。
- 修正は UPDATE/DELETE ではなく**新規レコード**で表現（新 env-sample・新 binding event）。索引も末尾追記型（`env-samples-index.json`）。

## 値の出所（provenance）

環境 IoT テレメトリから導出した計測値は `value_origin = environment_derived`。手入力温度は `provenance`（source / confidence / methodTag）で SwitchBot 由来と区別する（OBS-ENV-06）。欠測を補間で埋めた値は `imputed`、実測の代替推定は `estimated` と、出所を混同させない。

## なぜこの設計か

コア思想の「ランニングコスト最小（決定論優先・保存最小化）」の直接の帰結。生値だけを append-only で残し、派生量（露点・飽差・集計）は問い合わせ時に再計算する。これにより保存量が減り、計算式を後から差し替えても過去データが壊れない。

# Citations

- 観測対象ドメイン正本: [`schemas/dictionaries/observation_target_domain.yaml`](../../../schemas/dictionaries/observation_target_domain.yaml)
- 生物分類ランク正本: [`schemas/dictionaries/biological_rank.yaml`](../../../schemas/dictionaries/biological_rank.yaml)
- 値の出所 enum 正本: [`schemas/dictionaries/value_origin.yaml`](../../../schemas/dictionaries/value_origin.yaml)
- 環境 IoT / CSV 保存列 / 2 モデル分離: [`01-要件/05-観測.md`](../../../01-要件/05-観測.md)（環境 IoT · OBS-ENV-01〜06 · ADR-H-30/31/35/36）
