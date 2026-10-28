// Transactional email (verification, password reset, invitations) through
// Resend's HTTP API. Server-only: RESEND_API_KEY and EMAIL_FROM are Convex
// environment variables and never reach the browser.
//
// Development without an email provider: set AUTH_LOG_EMAIL_LINKS=true on a
// *development* deployment and links are written to the Convex logs instead.
// Never set it in production — anyone with log access could use the links.

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(email: Email): Promise<void> {
  if (emailConfigured()) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    if (!res.ok) {
      // The provider's message can contain the address; log the status only.
      console.error(`email provider refused the message: HTTP ${res.status}`);
      throw new Error("The email could not be sent. Try again later.");
    }
    return;
  }
  if (process.env.AUTH_LOG_EMAIL_LINKS === "true") {
    console.log(`[dev email] to=${email.to} subject=${email.subject}\n${email.text}`);
    return;
  }
  throw new Error("Email is not set up on this server (RESEND_API_KEY / EMAIL_FROM).");
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A short bilingual message with one button. */
export function actionEmail(opts: {
  to: string;
  subject: string;
  en: string;
  es: string;
  button: string;
  url: string;
}): Email {
  const text = `${opts.en}\n\n${opts.es}\n\n${opts.url}\n\nAcervus Finance`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1d2433;max-width:520px;margin:auto;padding:24px">
<h2 style="margin:0 0 16px">Acervus Finance</h2>
<p>${escape(opts.en)}</p>
<p style="color:#5b6475">${escape(opts.es)}</p>
<p style="margin:28px 0"><a href="${escape(opts.url)}" style="background:#1f5f4a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${escape(opts.button)}</a></p>
<p style="font-size:12px;color:#7a8394">${escape(opts.url)}</p>
</body></html>`;
  return { to: opts.to, subject: opts.subject, text, html };
}
