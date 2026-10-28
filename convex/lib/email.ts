// Transactional email (sign-in codes, invitations) through Resend's HTTP API.
// Server-only: RESEND_API_KEY and EMAIL_FROM are Convex environment variables
// and never reach the browser.
//
// Without RESEND_API_KEY / EMAIL_FROM the message is written to the Convex
// logs instead, so sign-in works before an email provider is connected.
// Anyone with log access can then read sign-in codes: connect Resend before
// real users arrive.

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
  if (!emailConfigured()) {
    console.log(`[email not sent: no RESEND_API_KEY] to=${email.to} subject=${email.subject}\n${email.text}`);
    return;
  }
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
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const page = (body: string) => `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1d2433;max-width:520px;margin:auto;padding:24px">
<h2 style="margin:0 0 16px">Acervus Finance</h2>
${body}
</body></html>`;

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
  const html = page(`<p>${escape(opts.en)}</p>
<p style="color:#5b6475">${escape(opts.es)}</p>
<p style="margin:28px 0"><a href="${escape(opts.url)}" style="background:#1f5f4a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${escape(opts.button)}</a></p>
<p style="font-size:12px;color:#7a8394">${escape(opts.url)}</p>`);
  return { to: opts.to, subject: opts.subject, text, html };
}

/** The bilingual sign-in code message. */
export function codeEmail(opts: { to: string; code: string; minutes: number }): Email {
  const en = `Your sign-in code is ${opts.code}. It expires in ${opts.minutes} minutes. If you didn't ask for it, ignore this email.`;
  const es = `Tu código de acceso es ${opts.code}. Vence en ${opts.minutes} minutos. Si no lo pediste, ignora este correo.`;
  const text = `CODE: ${opts.code}\n\n${en}\n\n${es}\n\nAcervus Finance`;
  const html = page(`<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0 24px">${escape(opts.code)}</p>
<p>${escape(en)}</p>
<p style="color:#5b6475">${escape(es)}</p>`);
  return { to: opts.to, subject: "Your sign-in code / Tu código de acceso", text, html };
}
