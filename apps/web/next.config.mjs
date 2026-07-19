/** @type {import('next').NextConfig} */
// ponytail: screen-defs live at repo root; server components read them via fs
// (see src/lib/screendefs.ts), so no outside-root import config is needed.
//
// Same-origin API proxy (design-c2 §4.3 cross-origin resolution): the browser
// calls the API at same-origin `/api/*`, and Next rewrites those to the worker.
// This lets the HttpOnly `ihl_session` cookie (§1.3) flow without cross-site
// cookies or CORS — the recommendation recorded in e2e-evidence.md §6-1.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

const nextConfig = {
  reactStrictMode: true,
  // STRIP-1(knw-to-c9-strip-chrome「左下の黒『N』FAB」): grepしても app 側の
  // renderer.tsx/globals.css に該当要素は存在しない——実体は Next.js の開発時
  // dev indicator(黒丸"N"バッジ・fixed左下・本番ビルドには出ない)。KNW側の
  // 実測は `next dev` でのスクショだったため、恒久的な撤去はフレームワーク
  // 設定側(ここ)で行う方が正しい(全ゾーン適用・renderer側に架空クラスを
  // 足さない)。
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_BASE}/api/:path*` }];
  },
};
export default nextConfig;
