// V3-AUT-12 — protected-route guard. Every screen requires a session except
// the login entry points themselves (`/s/login`, `/s/login-sent`); an
// unauthenticated visit anywhere else gets a 307 redirect to `/s/login`.
//
// V3-AUT-10 — onboarding gate. A LOGGED-IN visitor whose profile is not yet
// set up (GET /me/preferences has no handle — the only field with no sane
// default, see settings-routes.ts PREF_FIELDS) is confined to the dedicated
// `/s/setup-profile` flow until they confirm a handle + locale, the same way
// the login gate above confines an anonymous visitor to `/s/login`.
//
// Both gates reuse the existing PUBLIC/PROTECTED API endpoints (never
// re-implement JWT/HMAC verification in the Edge runtime): the incoming
// Cookie header is forwarded as-is and the API's own answer is trusted. This
// keeps the session + preferences contracts in exactly one place (apps/api).
import { NextResponse, type NextRequest } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

// screenHref() maps screen_id "login"/"login-sent" -> "/s/login"/"/s/login-sent"
// (apps/web/src/renderer/renderer.tsx) — these are the only screens reachable
// without a session.
const PUBLIC_PATHS = new Set(["/s/login", "/s/login-sent"]);

// setup-profile itself must stay reachable once logged in, whether or not
// onboarding is complete yet (otherwise a visitor with no handle could never
// reach the one screen that lets them set one — a redirect loop).
const ONBOARDING_EXEMPT_PATHS = new Set(["/s/setup-profile"]);

/** Pure: does this pathname require a session? Exported for a direct unit test. */
export function requiresAuth(pathname: string): boolean {
  return !PUBLIC_PATHS.has(pathname);
}

/** Pure: does this pathname skip the onboarding-completeness check? */
export function skipsOnboardingCheck(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || ONBOARDING_EXEMPT_PATHS.has(pathname);
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (!requiresAuth(pathname)) return NextResponse.next();

  const cookie = req.headers.get("cookie") ?? "";
  let authenticated = false;
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/session`, { headers: { cookie } });
    const body = (await res.json().catch(() => null)) as { authenticated?: unknown } | null;
    authenticated = body?.authenticated === true;
  } catch {
    // ponytail: API unreachable — fail closed (treat as unauthenticated) so a
    // backend outage never silently exposes a protected screen.
    authenticated = false;
  }
  if (!authenticated) {
    const url = req.nextUrl.clone();
    url.pathname = "/s/login";
    url.search = "";
    return NextResponse.redirect(url, 307);
  }

  if (skipsOnboardingCheck(pathname)) return NextResponse.next();

  let onboardingComplete = true; // fail-open on this 2nd check only: an
  // unreachable API already got fail-closed above (redirected to /s/login);
  // if the session call above succeeded but THIS call errors, the safer
  // default is to let a real logged-in person through rather than trap them
  // in a redirect loop over a transient preferences-fetch hiccup.
  try {
    const res = await fetch(`${API_BASE}/api/v1/me/preferences`, { headers: { cookie } });
    if (res.ok) {
      const prefs = (await res.json().catch(() => null)) as { handle?: unknown } | null;
      onboardingComplete = typeof prefs?.handle === "string" && prefs.handle.length > 0;
    }
  } catch {
    onboardingComplete = true;
  }
  if (!onboardingComplete) {
    const url = req.nextUrl.clone();
    url.pathname = "/s/setup-profile";
    url.search = "";
    return NextResponse.redirect(url, 307);
  }

  return NextResponse.next();
}

// Skip Next internals/static assets and the same-origin API proxy (next.config.mjs
// rewrites /api/* to the worker — the worker's OWN auth gate protects it; adding
// this middleware's redirect on top would break JSON API callers expecting JSON).
export const config = {
  matcher: ["/((?!_next|api|favicon.ico|manifest.webmanifest|.*\\..*).*)"],
};
