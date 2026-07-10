<!-- ponytail: frontmatter は md 文書規約（フォルダ設計 §3.2）。README は spine 補助のため最小限に留める。 -->
---
id: V3-APP-API
title: apps/api — Cloudflare Workers + Hono API
date: "2026-07-10"
status: draft
---

# apps/api — Cloudflare Workers + Hono

Cloudflare Workers 上で動く thin API（B2 確定 — Workers + Hono / TypeScript）。
デプロイ端点であり、ドメインロジックは持たない（DAG D6 — `packages/` `libs/` `components/` 側）。

## 契約正本

**API 契約の正本は `schemas/api/`（JSON Schema draft 2020-12）。** 本ディレクトリの
実装（Hono ルート・Zod スキーマ）は契約に従属し、整合は CI で突合する。ルート実装が
契約とずれた場合は `schemas/api/` を正とみなす。

- `GET /health` → `200 { "status": "ok" }`（契約: `schemas/api/health.schema.json`）

## 開発

```bash
npm install            # repo ルートで（npm workspaces）
npm test -w apps/api   # vitest run（app.request でルート検証）
npx wrangler dev       # ローカル実行（apps/api 内）
```

シークレット・アカウント ID は `wrangler.toml` に書かない（`.env.example` の型のみが正本）。
