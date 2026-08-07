---
id: c6-webdeploy-design
title: apps/web デプロイ方式(Cloudflare Pages)— 設計
date: "2026-08-07"
status: active
---

# apps/web デプロイ方式 — 設計(ihl-16)

> 発注元: `kits\lane-implement\ORDER-2026-08-07-w1-deploy.md`(T1)。
> 実装は `docs\ops\runbook.md` §5 手順3「本番 Pages デプロイ: apps/web を Pages プロジェクトへデプロイ」の具体化。

## 0. 結論(3行)

1. **配信方式 = Cloudflare Pages + `@cloudflare/next-on-pages`**(reuse-first: 姉妹プロジェクト `ihl-ver2/apps/web` が既にこの構成で稼働しており、そのまま踏襲する。自作アダプタは書かない)。
2. ビルド = `next build` → `npx @cloudflare/next-on-pages@1` → postbuild(`.next/cache` 除去+`.assetsignore` 生成)。出力先は `.vercel/output/static`。
3. ★**未解決のリスクを1件残す**: `apps/web/src/lib/screendefs.ts` が `node:fs` の `readFileSync`/`readdirSync` でリポジトリルートの `screen-defs/`(`apps/web` の外)を実行時に読んでいる。Pages のビルド出力にはこのディレクトリが含まれないため、**このままではデプロイ後に screen-def 読み込みが失敗する可能性が高い**(未実機検証)。是正案は §3 に書くが、`apps/web/src/` の編集は本ラウンドの担当外(デプロイ検証目的のみ)のため実装していない。

## 1. 採用理由(reuse-first)

`D:\claude\systems\ihl-ver2\apps\web` を実物確認した。同一ワークスペース内の姉妹プロジェクトであり、以下がすでに動く形で存在する:

- `wrangler.toml`: `pages_build_output_dir = ".vercel/output/static"` / `compatibility_flags = ["nodejs_compat"]`
- `package.json` scripts: `"pages:build": "next build && npx @cloudflare/next-on-pages@1 && node scripts/pages-postbuild.mjs"` / `"postbuild": "node scripts/pages-postbuild.mjs"`
- `scripts/pages-postbuild.mjs`: `.next/cache` 削除(CF Pages の25MiB上限対策)+ `.vercel/output/static/.assetsignore` 生成

これを ihl-ver3 の `apps/web` にそのまま移植する。新規に調べて選定するアダプタ探しはしていない(既に自分たちのワークスペースに実績がある選択肢を優先)。

## 2. 具体的な手順(実装 = T2)

1. `apps/web/wrangler.toml` を新規作成(ihl-ver2 と同型。`name` はプロジェクト固有値に変更)。
2. `apps/web/package.json` に `"pages:build"` / `"postbuild"` script と `"@cloudflare/next-on-pages"` devDependency を追加。
3. `apps/web/scripts/pages-postbuild.mjs` を ihl-ver2 からそのまま移植(内容は汎用・プロジェクト固有記述なし)。
4. デプロイ実行コマンド(**実行は人間ゲート・本ラウンドでは実行しない**):
   ```
   cd D:\claude\systems\ihl-ver3\apps\web
   npm run pages:build
   npx wrangler pages deploy .vercel/output/static --project-name <Cloudflare Pagesダッシュボードで作成したプロジェクト名>
   ```
   ★プロジェクト名は Cloudflare ダッシュボード側で一度作成する必要があり(人間ゲート・実在確認していない)、本設計では確定できない。

## 3. 未解決リスク: screen-defs の実行時 fs 読み込み(担当外・実装していない)

`apps/web/src/lib/screendefs.ts:1,8,12`(実測):
```
import { readFileSync, readdirSync } from "node:fs";
const SCREENDEFS_DIR = join(process.cwd(), "..", "..", "screen-defs");
readFileSync(join(SCREENDEFS_DIR, `${id}.json`), "utf8")
```
`process.cwd()` から2階層上(`apps/web` の外、repo ルートの `screen-defs/`)を実行時に読む設計。Pages/Workers のビルド出力にはこのファイル群がバンドルされないため、**デプロイ後に 404/例外になる可能性が高い**(`nodejs_compat` フラグは `fs` API 自体は使えるようにするが、任意のリポジトリパスを指すファイルシステムを提供するわけではない — 断定はしない、実機未検証)。

是正案(判断・実装ともに担当外。次工程への申し送り):
- 案A: `apps/web/scripts/copy-duckdb-assets.mjs` と同型の prebuild スクリプトで `screen-defs/*.json` を `apps/web` 内(例 `public/screen-defs/` か `src/screendefs-data/`)へビルド前にコピーし、`screendefs.ts` の読み込み先を変更する。
- 案B: screen-defs を import 時に静的バンドルする(`import.meta.glob` 相当・Next のserver component機能で可能か要検証)。
どちらも `apps/web/src` の編集を伴うため、本ラウンドの発注範囲(「機能実装はしない」)の外。

## 4. 検証(次工程)

- `npm run pages:build` を隔離環境(`NEXT_DIST_DIR` 分離済み)で実行し、`.vercel/output/static` が生成されることを確認する(本報告書末尾の検証ログ参照)。
- screen-defs 読み込みの実機検証(§3)は次工程の課題として残す。
