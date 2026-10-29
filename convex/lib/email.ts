// Transactional email (sign-in codes, invitations) through Brevo's or
// Resend's HTTP API. Server-only: BREVO_API_KEY or RESEND_API_KEY, and
// EMAIL_FROM, are Convex environment variables and never reach the browser.
//
// Brevo can send from a single verified address (no domain needed); Resend
// needs a verified domain. If both keys are set, Brevo is used.
//
// Without a key and EMAIL_FROM the message is written to the Convex logs
// instead, so sign-in works before an email provider is connected. Anyone
// with log access can then read sign-in codes: connect a provider before
// real users arrive.

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function emailConfigured(): boolean {
  return Boolean((process.env.BREVO_API_KEY || process.env.RESEND_API_KEY) && process.env.EMAIL_FROM);
}

/** "Name <address>" or a bare address, as Brevo wants it. */
export function parseSender(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { ...(m[1] ? { name: m[1].replace(/^"|"$/g, "") } : {}), email: m[2] } : { email: from.trim() };
}

function request(email: Email, from: string): { url: string; headers: Record<string, string>; body: unknown } {
  const brevo = process.env.BREVO_API_KEY;
  if (brevo) {
    return {
      url: "https://api.brevo.com/v3/smtp/email",
      headers: { "api-key": brevo },
      body: {
        sender: parseSender(from),
        to: [{ email: email.to }],
        subject: email.subject,
        textContent: email.text,
        htmlContent: email.html,
      },
    };
  }
  return {
    url: "https://api.resend.com/emails",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: { from, to: [email.to], subject: email.subject, text: email.text, html: email.html },
  };
}

export async function sendEmail(email: Email): Promise<void> {
  if (!emailConfigured()) {
    console.log(`[email not sent: no email provider] to=${email.to} subject=${email.subject}\n${email.text}`);
    return;
  }
  const req = request(email, process.env.EMAIL_FROM!);
  const res = await fetch(req.url, {
    method: "POST",
    headers: { ...req.headers, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(req.body),
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
