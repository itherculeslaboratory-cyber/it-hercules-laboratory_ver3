---
id: SCHEMAS-FROZEN-README
title: 互換必須スキーマ（CL-01〜13）凍結パックの対応表
date: "2026-07-10"
status: frozen
source: "docs/planning/ver3/ver3-最終要件定義書-v1.md §5.4 (CL-01〜13)@4a56cf6"
requirement_ids: [V3-FND-01, V3-FND-15, V3-AUT-17, V3-AUT-15, V3-SEC-20, V3-IND-01, V3-OBS-23, V3-OBS-09, V3-OBS-17, V3-OBS-20, V3-MKT-12, V3-KRM-19, V3-OBS-63]
---

## このディレクトリの契約（凍結宣言）

`schemas/frozen/` は、現行本番（ver2 = `it-hercules-laboratory-clean`）と**互換を壊せない** 13 レイヤー（CL-01〜13、要件定義書 §5.4）のうち、**データ形状契約**を JSON Schema draft 2020-12 に固定したものである。

**凍結ルール（変更禁止）**: これらのスキーマは、対応する negative TC が緑化するまで変更してはならない（要件定義書 §6.3 凍結範囲・ADR-V3-LAYER-01 §帰結「凍結範囲」）。スキーマ進化はイベントストア内の書き換えではなく、投影層（`libs/`・`packages/`）の upcaster か、`type` バージョンを上げた新イベント型でのみ行う（B2 §5 ルール 4）。`schemas/frozen/` への PR には対応 CL negative TC の提示を CI で必須化する（フォルダ設計 §8 手順 7f）。

各スキーマは移行時に ver2 の実データ形状から導出しており、`x_ihl_source`（ver2 出典パス @ コミット `4a56cf6`）と `x_ihl_cl`（対応 CL 番号）を自己記述で持つ。**ver2 の実装・fixture に存在しないフィールドは発明していない**。ver2 実装と要件文が食い違う箇所（CL-06 の親個体キー / CL-07 の画像フォーマット）は当該スキーマの `description` に「C1 実機照合で確定」と明記した。

## CL-01〜13 → スキーマ or 振る舞い TC の対応表

| CL | 契約 | 種別 | 担保先 | ver2 出典（@4a56cf6） |
|----|------|------|--------|------------------------|
| CL-01 | R2 INSERT ONLY / no-overwrite | 振る舞い | **negative TC で担保（C1）**: 同一キー再 put で後発が拒否される（2 重 put → 後発 null / 409） | `libs/ihl/core/event_store.py`（`path.exists()`→`R2NoOverwriteError`）・`libs/ihl/env/device_registry.py`（`_write_insert_only`） |
| CL-02 | Truth provenance メタ（run_id / schema_version / value_origin） | データ形状 | `frozen/provenance.schema.json` | `schemas/common/provenance.schema.yaml`・`schemas/dictionaries/value_origin.yaml` |
| CL-03 | actor_id 解決 / セッション | 振る舞い | **negative TC で担保（C1）**: 既存ユーザーの actor_id 導出テストベクタ一致 / 不一致で帰属切れ | `libs/ihl/identity/auth_deps.py`（`resolve_actor_id`）・`apps/api/routes/auth.py`（`/auth/session`） |
| CL-04 | 認証境界 Scope A 公開 READ（deny-by-default） | 振る舞い | **negative TC で担保（C1）**: 未ログインで保護 route に GET → 401/403（57 route マトリクスの公開/保護列と照合） | `apps/api/routes/*`（route 保護境界）・`INFRA-ROUTE-MATRIX`（ver2） |
| CL-05 | 利用規約 同意記録（append-only・別ファイル） | データ形状 | `frozen/consent-record.schema.json` | `apps/api/main.py`（`legal_agree` → `legal_agree_v1`）・`tests/unit/test_terms.py` |
| CL-06 | 個体キー individual_id / sire_id / dam_id | データ形状 | `frozen/individual-key.schema.json` | `schemas/capture/individual.schema.yaml`・`schemas/lineage/cross_parent.schema.yaml` |
| CL-07 | 観測 R2 画像 + thumbnail 契約（長辺512px・EXIF transpose） | データ形状 | `frozen/thumbnail.schema.json` | `schemas/manifest/thumbnail_manifest.schema.yaml`・`libs/ihl/observation/image.py` |
| CL-08 | embedding 生成契約（dinov2・384・L2 正規化） | データ形状 | `frozen/embedding-manifest.schema.json` | `schemas/manifest/embedding_manifest.schema.yaml`・`libs/ihl/observation/embedding.py` |
| CL-09 | collector Ed25519 署名 + 秘密値非露出 | 振る舞い | **negative TC で担保（C1）**: 既存 collector の実署名で verify green / 改竄署名の拒否 | `libs/ihl/env/collector_ingest.py`（`verify_collector_signature`・`canonical_json`） |
| CL-10 | 個体 QR トークン発行・スキャン・観測再開 | データ形状 | `frozen/qr-token.schema.json` | `libs/ihl/env/placement_store.py`（`env_qr_token_v1`・`create_qr_token`） |
| CL-11 | GMO deriveTransferCode(userId) 振込コード | データ形状 | `frozen/transfer-code.schema.json` | `libs/ihl/payments/gmo_transfer_code.py`（`derive_transfer_code`） |
| CL-12 | カルマ / プラチナ 台帳 append-only | データ形状 | `frozen/ledger-entry.schema.json` | `schemas/economy/karma_event.schema.yaml`・`schemas/economy/coin_event.schema.yaml`（`pt_event.schema.yaml` も同 append-only パターン） |
| CL-13 | タグ append-only イベント + aggregate ビュー | データ形状 | `frozen/tag-event.schema.json` | `schemas/events/tag_event.schema.yaml` |

**集計**: データ形状スキーマ 9 件（CL-02/05/06/07/08/10/11/12/13）+ 振る舞い TC で担保 4 件（CL-01/03/04/09）= 13。振る舞い契約（CL-01 INSERT ONLY・CL-03 認証・CL-04 deny-by-default・CL-09 署名）は形状で表現できないため**スキーマ化せず、C1 の negative TC 最優先緑化で担保**する（要件定義書 §6.4・開発計画 §5 C1 完了条件）。

## エンベロープとの関係

`frozen/provenance.schema.json`（CL-02）は Truth レコードの再現性メタ（run_id / schema_version / input_hash / value_origin）である。これは `../events/envelope.schema.json` の CloudEvents 拡張 `provenance`（生成主体 = human / agent+model / device と入力イベント ID 列 — B2 §5 ルール 3）とは**層が異なる別契約**であり、混同しない。前者は「どの run がどのスキーマ版でこの値を生んだか」、後者は「このイベントを誰が発行し何を入力にしたか」を表す。
