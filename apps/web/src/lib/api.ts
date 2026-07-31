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

// FND-22 S2: strips the response-envelope shape ({data, meta:{requestId,
// timestamp}}) back to the bare payload once apps/api starts wrapping
// allowlisted routes. No-op (returns v unchanged) for every pre-envelope
// response, since those never have both "data" and "meta" keys.
export function unwrapEnvelope(v: unknown): unknown {
  if (v && typeof v === "object" && "data" in v && "meta" in v) {
    const m = (v as { meta?: unknown }).meta as { requestId?: unknown; timestamp?: unknown } | undefined;
    if (m && typeof m.requestId === "string" && typeof m.timestamp === "string") return (v as { data: unknown }).data;
  }
  return v;
}
