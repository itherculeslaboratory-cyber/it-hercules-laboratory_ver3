import type { Bindings } from "./env";

// Magic-link mail adapter (V3-AUT-05). Resend HTTP API when RESEND_API_KEY is
// set; otherwise skip send (dev fallback — the dev_magic_token path covers it).
// Real key does not exist yet (人間ゲート: 実鍵投入) — code is send-ready.
export async function sendMagicLink(
  env: Bindings,
  email: string,
  token: string,
): Promise<{ sent: boolean }> {
  if (!env.RESEND_API_KEY) return { sent: false }; // dev fallback
  const link = `${env.PUBLIC_APP_URL ?? ""}/auth/verify?token=${encodeURIComponent(token)}`;
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
      html: `<p><a href="${link}">ログインを続ける</a></p><p>このリンクは15分間有効です。</p>`,
    }),
  });
  return { sent: res.ok };
}
