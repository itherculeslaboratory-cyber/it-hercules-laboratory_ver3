import type { Bindings } from "./env";

// Magic-link mail adapter (V3-AUT-05). Resend HTTP API when RESEND_API_KEY is
// set; otherwise skip send (dev fallback — the dev_magic_token path covers it).
// Real key does not exist yet (人間ゲート: 実鍵投入) — code is send-ready.
// code: V3-AUT-46 数字コードフォールバック(round-16 OQ-ONB-03)。magic-link と同一 OTP
// の別提示 — 別端末/webview で link を開けない場合の受け皿として本文に併記する。
export async function sendMagicLink(
  env: Bindings,
  email: string,
  token: string,
  code?: string,
): Promise<{ sent: boolean }> {
  if (!env.RESEND_API_KEY) return { sent: false }; // dev fallback
  const link = `${env.PUBLIC_APP_URL ?? ""}/auth/verify?token=${encodeURIComponent(token)}`;
  const codeHtml = code
    ? `<p>リンクを開けない場合は数字コード <strong>${code}</strong> をログイン画面に入力してください(15分間有効)。</p>`
    : "";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM ?? "login@localhost",
      to: email,
      subject: "IT Hercules Laboratory — ログインリンク",
      html: `<p><a href="${link}">ログインを続ける</a></p><p>このリンクは15分間有効です。</p>${codeHtml}`,
    }),
  });
  return { sent: res.ok };
}

// Ops alert mail (V3-FND-34 cron failure heartbeat). Same degrade-safe adapter
// pattern as sendMagicLink: no RESEND_API_KEY or no OPS_ALERT_EMAIL configured
// (both are one-time設備投資 env vars, not per-call cost) → skip send, never throw
// (a failed notification must not crash the batch it is reporting on).
export async function sendOpsAlert(
  env: Bindings,
  subject: string,
  bodyText: string,
): Promise<{ sent: boolean }> {
  if (!env.RESEND_API_KEY || !env.OPS_ALERT_EMAIL) return { sent: false };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM ?? "login@localhost",
      to: env.OPS_ALERT_EMAIL,
      subject: `IT Hercules Laboratory — ${subject}`,
      html: `<pre>${bodyText.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</pre>`,
    }),
  });
  return { sent: res.ok };
}
