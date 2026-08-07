// V3-AUT-12 — protected-route guard. Every screen requires a session except
// the login entry points themselves (`/s/login`, `/s/login-sent`); an
// unauthenticated visit anywhere else gets a 307 redirect to `/s/login`.
//
// V3-AUT-10 — onboarding gate. A LOGGED-IN visitor who hasn't cleared the
// required handle+locale gates is confined to the dedicated `/s/setup-profile`
// flow, the same way the login gate above confines an anonymous visitor to
// `/s/login`. SSOT for "is onboarding complete": apps/api/src/account.ts
// projectOnboardingStatus() (handle + explicit-locale gates), surfaced via the
// single GET /auth/session response's `onboarding_complete` field — this
// middleware does NOT re-derive it from /me/preferences (that would be a
// second, divergent definition of "done").
//
// Both gates reuse the existing PUBLIC/PROTECTED API endpoints (never
// re-implement JWT/HMAC verification in the Edge runtime): the incoming
// Cookie header is forwarded as-is and the API's own answer is trusted. This
// keeps the session + onboarding contracts in exactly one place (apps/api).
import { NextResponse, type NextRequest } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

// screenHref() maps screen_id "login"/"login-sent" -> "/s/login"/"/s/login-sent"
// (apps/web/src/renderer/renderer.tsx) — these are the only screens reachable
// without a session.
// V3-SEC-20: /s/terms must stay reachable without a session (unauthenticated
// visitors can read the full terms text before logging in).
const PUBLIC_PATHS = new Set(["/s/login", "/s/login-sent", "/s/terms", "/s/individual-detail"]);

// QRLINK-1(2026-08-08): 物理QRラベルの着地 /individuals/{id} は、未ログインでも
// 詳細画面へ到達できなければならない(ユーザー対案・仕様1)。{id} は動的セグメントなので
// Set の完全一致では表現できず、前方一致で判定する。API 側は index.ts の
// PUBLIC_READ_ROUTES で既に公開済み(profile/pedigree)。
//
// QRLINK-1 最後の穴(2026-08-08 R0808-620af2-REPORT-2026-08-08-w2b-gatefix.md §5・
// HQ裁定 kits/lane-implement/ORDER-2026-08-08-qranon-fix.md): screenHref()
// (apps/web/src/renderer/core/scope.ts:229-233) は screen-defs の route 宣言を見ず、
// 常に `/s/<screen_id>` を組む。よって QR着地画面からの実際の遷移先は
// `/individuals/` ではなく `/s/individual-detail?id=...` になる。この実URLも
// 前方一致で許可しないと、未ログイン訪問者は詳細画面の手前で /s/login に弾かれる。
const PUBLIC_PATH_PREFIXES = ["/individuals/"];

// setup-profile itself must stay reachable once logged in, whether or not
// onboarding is complete yet (otherwise a visitor with no handle could never
// reach the one screen that lets them set one — a redirect loop).
const ONBOARDING_EXEMPT_PATHS = new Set(["/s/setup-profile"]);

/** Pure: does this pathname skip the consent-completeness check? /s/terms is
 * already in PUBLIC_PATHS (reachable pre-auth), which also keeps it reachable
 * for a logged-in-but-not-consented visitor — no separate exempt set needed. */
export function skipsConsentCheck(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/** Pure: does this pathname require a session? Exported for a direct unit test. */
export function requiresAuth(pathname: string): boolean {
  return !PUBLIC_PATHS.has(pathname) && !PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p));
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
  // fail-open default: only an explicit `false` from the API flips this —
  // a malformed/missing field never traps an otherwise-authenticated visitor
  // in a redirect loop (the auth check above is the fail-closed gate).
  let onboardingComplete = true;
  let consentComplete = true;
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/session`, { headers: { cookie } });
    const body = (await res.json().catch(() => null)) as
      | { authenticated?: unknown; onboarding_complete?: unknown; consent_complete?: unknown }
      | null;
    authenticated = body?.authenticated === true;
    onboardingComplete = body?.onboarding_complete !== false;
    consentComplete = body?.consent_complete !== false;
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

  // V3-SEC-20/T2: authenticated but not yet consented → /s/terms, ahead of the
  // onboarding gate (consent precedes profile data collection).
  if (!skipsConsentCheck(pathname) && !consentComplete) {
    const url = req.nextUrl.clone();
    url.pathname = "/s/terms";
    url.search = "";
    return NextResponse.redirect(url, 307);
  }

  if (skipsOnboardingCheck(pathname)) return NextResponse.next();

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
