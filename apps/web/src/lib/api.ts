// API base — NEXT_PUBLIC_API_URL, dev default per design-c2 §4.3. Consumed by
// next.config.mjs rewrites to proxy /api/* to the worker.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

// The browser calls the API same-origin (`/api/...`) so the HttpOnly session
// cookie flows; Next's rewrite forwards it to the worker (see next.config.mjs).
// Paths are already rooted at "/api/v1/..." so they need no rewriting here.
export function apiUrl(path: string): string {
  return path;
}
