// V3-AUT-12 — protected-route guard. Every screen requires a session except
// the login entry points themselves (`/s/login`, `/s/login-sent`); an
// unauthenticated visit anywhere else gets a 307 redirect to `/s/login`.
//
// Reuses the existing PUBLIC `GET /api/v1/auth/session` endpoint (never 401 —
// see auth-routes.ts) instead of re-implementing JWT/HMAC verification in the
// Edge runtime: the incoming Cookie header is forwarded as-is and the API's
// own answer ({authenticated}) is trusted. This keeps the session contract in
// exactly one place (apps/api).
import { NextResponse, type NextRequest } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

// screenHref() maps screen_id "login"/"login-sent" -> "/s/login"/"/s/login-sent"
// (apps/web/src/renderer/renderer.tsx) — these are the only screens reachable
// without a session.
const PUBLIC_PATHS = new Set(["/s/login", "/s/login-sent"]);

/** Pure: does this pathname require a session? Exported for a direct unit test. */
export function requiresAuth(pathname: string): boolean {
  return !PUBLIC_PATHS.has(pathname);
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (!requiresAuth(pathname)) return NextResponse.next();

  let authenticated = false;
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/session`, {
      headers: { cookie: req.headers.get("cookie") ?? "" },
    });
    const body = (await res.json().catch(() => null)) as { authenticated?: unknown } | null;
    authenticated = body?.authenticated === true;
  } catch {
    // ponytail: API unreachable — fail closed (treat as unauthenticated) so a
    // backend outage never silently exposes a protected screen.
    authenticated = false;
  }
  if (authenticated) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/s/login";
  url.search = "";
  return NextResponse.redirect(url, 307);
}

// Skip Next internals/static assets and the same-origin API proxy (next.config.mjs
// rewrites /api/* to the worker — the worker's OWN auth gate protects it; adding
// this middleware's redirect on top would break JSON API callers expecting JSON).
export const config = {
  matcher: ["/((?!_next|api|favicon.ico|manifest.webmanifest|.*\\..*).*)"],
};
