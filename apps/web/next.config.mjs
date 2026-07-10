/** @type {import('next').NextConfig} */
// ponytail: screen-defs live at repo root; server components read them via fs
// (see src/lib/screendefs.ts), so no outside-root import config is needed.
const nextConfig = {
  reactStrictMode: true,
};
export default nextConfig;
