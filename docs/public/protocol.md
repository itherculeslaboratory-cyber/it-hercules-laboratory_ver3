---
id: public-protocol
title: it-hercules-laboratory — 公開プロトコル構造（Protocol）
date: "2026-07-11"
status: draft
---

# it-hercules-laboratory — 公開プロトコル構造

> **公開範囲**: 本書は Truth プロトコルの公開仕様の構造説明（V3-AIP-80）。**契約の唯一正本は `schemas/`（JSON Schema draft 2020-12）**であり、
> 本書はそれを複製しない — 各項は正本スキーマ・route へのリンクである。実装済みの構造のみを記述し、未実装は §6 に分離する。

## 1. Truth モデル（append-only イベントストア）

一次事実は不変イベントとして Cloudflare R2 に INSERT ONLY で積まれる。永続正本はイベント列だけで、投影（一覧・集計・台帳）は都度再計算する。

- **書込規律**: put-if-absent。同一キー再 PUT は **409**。UPDATE / DELETE 経路は存在しない（storage 層強制）。
- **キー構造**: `truth/<type>/<id>.json`。`<id>` はエンベロープの id（多くは ULID・時系列ソート可能）。
- **provenance**: 各イベントは生成主体（`actor_id`）と系譜（`input_event_ids`）を持つ。書込 `actor_id` はセッション principal に強制 stamp される（クライアント申告を信用しない）。

## 2. エンベロープ（CloudEvents v1.0 薄ラッパ + 拡張）

イベントは CloudEvents v1.0 の薄いエンベロープに `provenance` 拡張を載せた形。`data` に型別の本体を格納し、`dataschema` が正本スキーマ（`schemas/events/<name>.schema.json`）を指す。

- 正本: `schemas/events/envelope.schema.json`。
- inner `data` の検証は、登録済みイベント型についてエンベロープ検証時に併せて行う（未登録型は inner 無検証で INSERT されない設計）。

## 3. イベント型（抜粋・正本は `schemas/events/`）

| ドメイン | type | 正本スキーマ | キー構造 |
|----------|------|--------------|----------|
| 観測 | `ihl.obs.capture.v1` | `events/obs-capture.schema.json` | `truth/ihl.obs.capture.v1/<capture_id>.json` |
| 観測写真 | `ihl.obs.photo.v1` | `events/obs-photo.schema.json` | `truth/ihl.obs.photo.v1/<capture_id>-<photo_id>.json` |
| 個体 QR | `ihl.ind.qr.v1` | `events/ind-qr.schema.json` | `truth/ihl.ind.qr.v1/<token>.json` |
| 知の広場 投稿 | `ihl.plaza.post.v1` | `events/plaza-post.schema.json` | `truth/ihl.plaza.post.v1/<channel>/<thread_id>/<post_id>.json` |
| スレ要約 | `ihl.plaza.summary.v1` | `events/plaza-summary.schema.json` | `truth/ihl.plaza.summary.v1/<thread_id>/<block_index>-<summary_id>.json` |
| 意図台帳 | `ihl.process.intent.v1` | `events/intent.schema.json` | `truth/ihl.process.intent.v1/<intent_id>.json` |
| 文化テンプレ | `ihl.culture.template.v1` | `events/culture-template.schema.json` | `truth/ihl.culture.template.v1/<version_id>.json` |

> 全型は `schemas/events/` に列挙。市場（`mkt-*`）・ガバナンス（`gov-*`）・経済（`economy-*`）等も同一のエンベロープ/append-only 規律に従う。

## 4. API サーフェス（deny-by-default）

主 API は Cloudflare Workers + Hono。**全 route は protected 既定（deny-by-default）**で、公開は認証系の 3 経路のみ。

- 公開（3 経路のみ）: `POST /api/v1/auth/magic-link`・`POST /api/v1/auth/verify`・`GET /api/v1/auth/session`。
- それ以外（現行マトリクス 66 route）は未認証で **401 AUTH_REQUIRED**（ルーティング前にゲート）。
- 汎用書込は `POST /events`（put-if-absent・provenance.actor_id をセッション主体へ force-stamp）。新規イベント型でも API サーフェスを増やさず、この汎用経路に収束させる。
- 権限整合の正本は `tests/fixtures/route-matrix.csv`（CL-04・public/protected 照合）。実 app 駆動で各 protected route の 401 を機械検証する。

## 5. 系譜と検証（fork / lineage）

- **fork 文化**: 改善は Component 単位の fork + lineage。派生は親を `forked_from` 等で指し、系譜を append で残す。
- **検証**: 独立批評家（正しさ / 回帰 / 設計整合）通過が納品条件。機械 GATE の PASS を人間の完成宣言より優先する。

## 6. 未実装・人間ゲート（誇張ゼロ）

以下はプロトコル上の位置づけのみを示し、稼働は主張しない。

- **知の広場スレッドの spec JSON**（V3-AIP-34）: 検証 TC（`tests/spec-thread.test.ts`）は用意済。スレッド画面 spec の正本は掲示板クラスタ成果物で、未産出の間は当該 TC を skip。
- **市場／台帳の実 UI E2E**（V3-AIP-49）: E2E ハーネスと skip ガードは用意済。描画対象 screen-def が landed するまで skip。
- **BYOK 実鍵の LLM ライブ配線**（V3-AIP-40）: 既定 OFF。鍵はサーバ非保持。
- **本 repo の公開の実施**（V3-AIP-80）: 人間ゲート・未裁定。
