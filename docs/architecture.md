---
id: V3-DOC-ARCHITECTURE
title: アーキテクチャ 1 ページ骨格
date: "2026-07-10"
status: approved
requirement_ids: [V3-AIP-61, V3-FND-01, V3-FND-02, V3-FND-14, V3-UIX-17]
---

# アーキテクチャ 1 ページ骨格

> 詳細設計は B4 設計書 3 種（AI 用/一般人用/開発者用）へ委譲。本書は 6 点骨格 + 依存 DAG の 1 ページ。典拠 = `ver3-開発計画-v1.md` §1・フォルダ設計 §7.2。

## 6 点骨格

| # | 骨格 | 内容 |
|---|------|------|
| 1 | **R2 Truth append-only + 投影層** | 永続正本は Cloudflare R2 のみ（V3-FND-02）。書込は INSERT ONLY（V3-FND-01）。イベントは CloudEvents v1.0 薄エンベロープ + ULID + provenance 拡張、スキーマ正本は repo 内 JSON Schema、upcasting は投影層のみ。人間可読ビューは全て生成物 |
| 2 | **Workers + Hono (TS)** | 主 API は最初から Cloudflare Workers + Hono + zod-openapi。FastAPI→移植の二度書きは棄却。既存 FastAPI は (i) OpenAPI 契約の仕様正本 (ii) 切替時の strangler legacy 側の 2 役のみ。VPS SMTP は選択肢に降格（メールは Resend、実鍵投入は人間ゲート） |
| 3 | **埋め込み 384 一本化 + 端末 ONNX オフロード** | 画像 = DINOv2 ViT-S/14 系 384（L2 正規化 float32）。色は rerank 分離。テキスト = ruri-v3-70m（384・ONNX）。端末実行（WASM/WebGPU/ONNX）を 384 系サイズで担保。768 はエスケープハッチ（実装しない） |
| 4 | **C-USB 部品化** | 同期・接続・管理の最小契約単位（V3-FND-14）。TTS「VOICEVOX 互換 REST」・画像「ComfyUI API JSON」等、境界を契約で固定し中身を差替自由に。1 部品 = `components/<name>/`（manifest.json + run + tests） |
| 5 | **ScreenDef（UI-as-data）** | UI はコードでなくデータ（ScreenDef JSON）で宣言し単一 React Renderer へ変換（V3-UIX-17・第1波土台）。自然言語→ScreenDef 生成は第2波 |
| 6 | **5 不変条項** | ① 10 年コスト最小（決定論優先・モデル最小化）② fork 文化 ③ append-only ④ 人間ゲート ⑤ 批評家ゲート。全マイルストーンの受け入れ条件に貫通 |

## レイヤーと投影

```text
R2 Truth (append-only events)  ──►  投影純粋関数 f / reducer  ──►  投影ビュー（Parquet / API レスポンス / 画面）
     ▲ INSERT ONLY                     （libs/ · packages/ の upcaster 経由）
     │
契約 = schemas/frozen/ · schemas/events/（葉。repo が持つのは契約と f のみ）
```

Truth は repo の外（R2）。repo が持つのは「契約（スキーマ）」と「投影を再生成する純粋関数 f」。投影層にしか存在しない事実を作らない（ADR-V3-LAYER-01 不変条件）。

## 依存 DAG（フォルダ設計 §7.2 の写し）

```text
apps/  ──►  packages/*  ·  libs/<domain>/  ·  components/*
                │                │
                └──── 読む ────► schemas/（葉。何にも依存しない）
screen-defs/（データ）──読まれる──► apps/web の単一 Renderer
```

- **apps → apps 禁止**（D1）。`libs/ packages/ components/ → apps` 禁止（D2）。`*/shared/` 禁止（D3）。
- `schemas/` は葉。codegen の向きは schemas → generated の一方向（D4）。
- `screen-defs/` はデータ。import せず Renderer だけが読む（D5）。UI はロジックを持たず transform は components/libs 側（D6）。

## デプロイ端点

| 端点 | スタック | 住所 |
|------|----------|------|
| Web | Next.js + 単一 React Renderer | `apps/web/` |
| API | Workers + Hono(TS)・wrangler.toml + thin routes | `apps/api/`（契約は `schemas/api/` が正本） |
| Python パイプライン | 観測/embedding(DINOv2)/画像解析/動画量産(ffmpeg・VOICEVOX) | `components/<name>/run.py`・共有コードは `libs/<domain>/` |

> 詳細は `02-design/constitution.md`（憲法 v2）§4 の深度制限・DAG・アンチパターン表、および `docs/planning/status.md` の現在地を参照。
