/**
 * Cloudflare Pages post-build: drop webpack cache and guard static output.
 * CF Pages rejects any asset > 25 MiB; .next/cache can exceed that if the
 * dashboard Build output directory points at .next instead of .vercel/output/static.
 *
 * Invoked via npm "postbuild" (after next build, including when next-on-pages
 * runs `npm run build`) and again at the end of `npm run pages:build`.
 *
 * 移植元: ihl-ver2/apps/web/scripts/pages-postbuild.mjs(内容変更なし・汎用スクリプト)。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const cacheDir = join(cwd, ".next", "cache");
const outDir = join(cwd, ".vercel", "output", "static");

if (existsSync(cacheDir)) {
  rmSync(cacheDir, { recursive: true, force: true });
  console.log("[pages-postbuild] removed .next/cache");
}

if (!existsSync(outDir)) {
  console.log(
    "[pages-postbuild] skip .assetsignore — .vercel/output/static not ready (next-on-pages may run next)",
  );
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, ".assetsignore"),
  [
    "# Exclude stray build artifacts from CF static upload",
    "**/.next/**",
    "**/cache/**",
    "node_modules",
    "",
  ].join("\n"),
  "utf8",
);
console.log("[pages-postbuild] wrote .vercel/output/static/.assetsignore");
