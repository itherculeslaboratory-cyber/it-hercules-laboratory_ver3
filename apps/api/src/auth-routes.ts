import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { TruthStore, deriveActorId } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import type { KVNamespaceLite } from "./kv";
import { isBanned } from "./ledger-routes";
import { sendMagicLink } from "./mail";
import { ensureAccount, projectOnboardingStatus } from "./account";
import {
  MAGIC_TTL,
  SESSION_TTL,
  findMatchingIat,
  issueMagicToken,
  issueNumericCode,
  issueSessionToken,
  verifyMagicToken,
  verifySessionToken,
} from "./session";

// email 正規化は入口で統一（第6回裁定③）。deriveActorId 自体は raw 有意のまま凍結。
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function bearerToken(auth: string | undefined): string {
  const h = auth ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /magic-link (公開): email → magic token → mail. 202 { sent:true }.
// V3-AUT-46: 同じ iat から数字コード(6桁)も導出し、リンクと併せて送る(別端末/webview
// でリンクを開けない場合の受け皿)。
authRoutes.post("/magic-link", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
  if (!body || typeof body.email !== "string" || !body.email.includes("@")) {
    return c.json({ error: "INVALID_EMAIL" }, 400);
  }
  const email = normalizeEmail(body.email);
  const token = await issueMagicToken(email, c.env.SESSION_SECRET);
  const minted = await verifyMagicToken(token, c.env.SESSION_SECRET); // 直後の検証=常に非null
  const code = await issueNumericCode(email, minted!.iat, c.env.SESSION_SECRET);
  await sendMagicLink(c.env, email, token, code);
  const res: Record<string, unknown> = { sent: true };
  if (c.env.IHL_DEV_EXPOSE_MAGIC_TOKEN === "1") {
    res.dev_magic_token = token;
    res.dev_numeric_code = code;
  }
  return c.json(res, 202);
});

// POST /verify (公開): magic token → session token + Set-Cookie. { actor_id }.
authRoutes.post("/verify", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
  if (!body || typeof body.token !== "string") {
    return c.json({ error: "INVALID_TOKEN" }, 401);
  }
  const payload = await verifyMagicToken(body.token, c.env.SESSION_SECRET);
  if (!payload) return c.json({ error: "INVALID_TOKEN" }, 401);
  const actorId = await deriveActorId(payload.email); // email already normalized at magic-link entry
  const store = new TruthStore(c.env.TRUTH);
  // KRM-04: 永久 BAN は session 発行前に弾く（ログイン時のみ判定＝毎リクエスト走査回避）。
  if (await isBanned(store, actorId)) {
    return c.json({ error: "BANNED" }, 403);
  }
  // V3-AUT-09: 初回検証でオープン登録(アカウント行を put-if-absent・2回目以降は
  // 既存キーとの衝突を無視するidempotent no-op)。独立サインアップ画面は持たない。
  await ensureAccount(store, actorId);
  const session = await issueSessionToken(actorId, c.env.SESSION_SECRET);
  setCookie(c, "ihl_session", session, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
  return c.json({ actor_id: actorId });
});

// ── V3-AUT-46 数字コード verify(round-16 OQ-ONB-03)────────────────────────
// magic-link と同一 OTP の別提示: email+code → session。ワンタイム性(消費済み iat
// を記録)・試行回数制限(V3-SEC-14 のログイン系レート制限=濫用を短く止める思想に整合。
// 6桁=10^6空間の総当り対策としてリンクより厳しい回数で止める)・期限は magic-link と
// 同一(findMatchingIat が MAGIC_TTL 窓内の iat しか照合しない)。
const CODE_MAX_ATTEMPTS = 5;
interface CodeState {
  attempts: number;
  consumed: number[]; // 消費済み iat(ワンタイム性)
}

function codeStateKey(email: string): string {
  return `code-state:${email}`;
}

async function readCodeState(kv: KVNamespaceLite, email: string): Promise<CodeState> {
  const raw = await kv.get(codeStateKey(email));
  if (!raw) return { attempts: 0, consumed: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<CodeState>;
    return {
      attempts: typeof parsed.attempts === "number" ? parsed.attempts : 0,
      consumed: Array.isArray(parsed.consumed)
        ? parsed.consumed.filter((x): x is number => typeof x === "number")
        : [],
    };
  } catch {
    return { attempts: 0, consumed: [] };
  }
}

async function writeCodeState(kv: KVNamespaceLite, email: string, state: CodeState): Promise<void> {
  await kv.put(codeStateKey(email), JSON.stringify(state), { expirationTtl: MAGIC_TTL });
}

// POST /verify-code (公開): { email, code } → session token + Set-Cookie. { actor_id }.
authRoutes.post("/verify-code", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { email?: unknown; code?: unknown } | null;
  if (!body || typeof body.email !== "string" || !body.email.includes("@")) {
    return c.json({ error: "INVALID_EMAIL" }, 400);
  }
  if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) {
    return c.json({ error: "INVALID_CODE" }, 400);
  }
  const email = normalizeEmail(body.email);
  const kv = c.env.AUTH_CODE_STATE;
  const state = kv ? await readCodeState(kv, email) : { attempts: 0, consumed: [] };
  if (state.attempts >= CODE_MAX_ATTEMPTS) {
    return c.json({ error: "TOO_MANY_ATTEMPTS" }, 429);
  }
  const iat = await findMatchingIat(email, body.code, c.env.SESSION_SECRET);
  const alreadyUsed = iat !== null && state.consumed.includes(iat);
  if (iat === null || alreadyUsed) {
    if (kv) await writeCodeState(kv, email, { attempts: state.attempts + 1, consumed: state.consumed });
    return c.json({ error: "INVALID_CODE" }, 401);
  }
  if (kv) await writeCodeState(kv, email, { attempts: 0, consumed: [...state.consumed, iat] });
  const actorId = await deriveActorId(email);
  const codeStore = new TruthStore(c.env.TRUTH);
  // KRM-04: /verify と同じ BAN ゲート(session 発行前に弾く)。
  if (await isBanned(codeStore, actorId)) {
    return c.json({ error: "BANNED" }, 403);
  }
  // V3-AUT-09: /verify と同じオープン登録(idempotent no-op が2回目以降)。
  await ensureAccount(codeStore, actorId);
  const session = await issueSessionToken(actorId, c.env.SESSION_SECRET);
  setCookie(c, "ihl_session", session, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
  return c.json({ actor_id: actorId });
});

// GET /session (公開): reports auth state, never 401. 認証済みなら V3-AUT-10/I18-02
// の必須2ゲート(handle+locale)充足状況(onboarding_complete)も同梱する — ProtectedApp
// 側が別 route を叩かず1回の呼び出しで「ログイン済みか」と「初期設定済みか」を両方読める。
authRoutes.get("/session", async (c) => {
  const token = getCookie(c, "ihl_session") ?? bearerToken(c.req.header("Authorization"));
  const payload = token ? await verifySessionToken(token, c.env.SESSION_SECRET) : null;
  if (!payload) return c.json({ authenticated: false });
  const status = await projectOnboardingStatus(new TruthStore(c.env.TRUTH), payload.sub);
  return c.json({ authenticated: true, actor_id: payload.sub, onboarding_complete: status.onboarding_complete });
});

// POST /dev-login (公開・dev 限定): §1.4 V3-AUT-05「画面内トークン認証ボタン」の実体。
// DEV_TOKEN が設定されている（= dev）ときのみ、固定 dev actor（deriveActorId(
// "dev@ihl.local")・§1.4）のセッション cookie を 1-click 発行する。本番は
// DEV_TOKEN 未設定 → 404（この経路は存在しない）。付与範囲は既存 DEV_TOKEN Bearer
// と同一の決定的 dev actor で、新たな権限面を増やさない。
authRoutes.post("/dev-login", async (c) => {
  if (!c.env.DEV_TOKEN) return c.json({ error: "NOT_FOUND" }, 404);
  const actorId = await deriveActorId("dev@ihl.local");
  const devStore = new TruthStore(c.env.TRUTH);
  // KRM-04: dev 1-click login も session 発行前に BAN 判定（§2.6 と同契約）。
  if (await isBanned(devStore, actorId)) {
    return c.json({ error: "BANNED" }, 403);
  }
  // V3-AUT-09: dev-login も同じ open registration 経路を通す(dev actor も一貫)。
  await ensureAccount(devStore, actorId);
  const session = await issueSessionToken(actorId, c.env.SESSION_SECRET);
  setCookie(c, "ihl_session", session, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
  return c.json({ actor_id: actorId });
});

// POST /logout (保護): clear cookie (Max-Age=0). Stateless — no server-side purge.
authRoutes.post("/logout", (c) => {
  deleteCookie(c, "ihl_session", { path: "/" });
  return c.json({ ok: true });
});
