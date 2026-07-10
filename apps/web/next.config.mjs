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
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_BASE}/api/:path*` }];
  },
};
export default nextConfig;
