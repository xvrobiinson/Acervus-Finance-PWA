// Signing in and up with an emailed one-time code (Better Auth), accepting an
// invitation and creating a business.

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { authClient } from "../lib/auth-client";
import { describeError } from "../lib/errors";
import { useLang, useT } from "../lib/i18n";
import { CURRENCIES, roleLabel } from "../lib/labels";
import { useApp } from "../state/app";
import { Banner, Button, Field } from "../ui/kit";

const INVITE_KEY = "acervus.inviteToken";
const CODE_LENGTH = 6;
const googleEnabled = import.meta.env.VITE_GOOGLE_SIGN_IN === "true";

interface CodeRequest {
  email: string;
  name?: string;
}

type AuthFailure = { status?: number; code?: string; message?: string } | null | undefined;

function AuthPanel({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  const { lang, setLang } = useLang();
  return (
    <div className="auth">
      <div className="panel stack">
        <img className="logo" src="/pwa-192x192.png" alt="Acervus Finance" />
        <div>
          <h1>{title}</h1>
          {sub && <p className="muted" style={{ margin: 0 }}>{sub}</p>}
        </div>
        {children}
        <div className="row" style={{ justifyContent: "center" }}>
          <Button variant="ghost" size="small" onClick={() => setLang(lang === "es" ? "en" : "es")}>
            {lang === "es" ? "English" : "Español"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Better Auth error → a sentence. */
function authError(t: ReturnType<typeof useT>, e: AuthFailure): string | null {
  if (!e) return null;
  if (e.code === "INVALID_OTP") return t("That code is wrong. Check it and try again.", "Ese código no es correcto. Revísalo e inténtalo de nuevo.");
  if (e.code === "OTP_EXPIRED") return t("That code expired. Send a new one.", "Ese código venció. Pide uno nuevo.");
  if (e.code === "TOO_MANY_ATTEMPTS") return t("Too many wrong tries for this code. Send a new one.", "Demasiados intentos con este código. Pide uno nuevo.");
  if (e.status === 429) return t("Too many attempts. Wait a few minutes and try again.", "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.");
  if (!navigator.onLine) return t("No connection. Try again when you're online.", "Sin conexión. Inténtalo de nuevo cuando estés en línea.");
  return e.message || t("Something went wrong. Try again.", "Algo salió mal. Inténtalo de nuevo.");
}

const sendCode = (email: string) => authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });

function enterApp() {
  const invite = sessionStorage.getItem(INVITE_KEY);
  location.assign(invite ? `/invite#token=${invite}` : "/");
}

function GoogleButton() {
  const t = useT();
  if (!googleEnabled) return null;
  return (
    <>
      <div className="divider">{t("or", "o")}</div>
      <Button block onClick={() => void authClient.signIn.social({ provider: "google", callbackURL: `${location.origin}/` })}>
        {t("Continue with Google", "Continuar con Google")}
      </Button>
    </>
  );
}

export function SignIn() {
  const t = useT();
  const app = useApp();
  const [request, setRequest] = useState<CodeRequest | null>(null);
  if (request) return <CodeStep request={request} onBack={() => setRequest(null)} />;
  return (
    <AuthPanel title={t("Sign in", "Iniciar sesión")} sub={t("We'll email you a 6-digit code.", "Te enviaremos un código de 6 dígitos por correo.")}>
      <EmailForm submitLabel={t("Send code", "Enviar código")} onSent={setRequest} />
      <GoogleButton />
      <p className="small" style={{ textAlign: "center" }}>
        <Link to="/sign-up">{t("Create an account", "Crear una cuenta")}</Link>
      </p>
      {app.user === null && localStorage.getItem("acervus.lastUser") && !navigator.onLine && (
        <Button onClick={app.continueOffline}>{t("Continue offline", "Continuar sin conexión")}</Button>
      )}
    </AuthPanel>
  );
}

export function SignUp() {
  const t = useT();
  const [name, setName] = useState("");
  const [request, setRequest] = useState<CodeRequest | null>(null);
  if (request) return <CodeStep request={request} onBack={() => setRequest(null)} />;
  return (
    <AuthPanel title={t("Create an account", "Crear una cuenta")} sub={t("Then create your business or accept an invitation.", "Luego crea tu negocio o acepta una invitación.")}>
      <EmailForm name={name.trim()} submitLabel={t("Send code", "Enviar código")} onSent={setRequest}>
        <Field label={t("Your name", "Tu nombre")}>{(id) => <input id={id} className="input" autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      </EmailForm>
      <GoogleButton />
      <p className="small" style={{ textAlign: "center" }}>
        <Link to="/sign-in">{t("I already have an account", "Ya tengo una cuenta")}</Link>
      </p>
    </AuthPanel>
  );
}

/** Asks for the email address and sends the sign-in code to it. */
function EmailForm({ name, submitLabel, onSent, children }: { name?: string; submitLabel: string; onSent: (request: CodeRequest) => void; children?: ReactNode }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const address = email.trim();
    const { error: err } = await sendCode(address);
    setBusy(false);
    if (err) setError(authError(t, err));
    else onSent({ email: address, name });
  };
  return (
    <form className="stack" onSubmit={submit}>
      {children}
      <Field label={t("Email", "Correo")}>{(id) => <input id={id} className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      {error && <div className="banner error" role="alert">{error}</div>}
      <Button type="submit" variant="primary" block loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}

/** Checks the emailed code; the first sign-in with an address creates the account. */
function CodeStep({ request, onBack }: { request: CodeRequest; onBack: () => void }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signIn.emailOtp({ email: request.email, otp: code.trim(), name: request.name });
    setBusy(false);
    if (err) setError(authError(t, err));
    else enterApp();
  };
  const resend = async () => {
    setError(null);
    setNotice(null);
    const { error: err } = await sendCode(request.email);
    if (err) setError(authError(t, err));
    else setNotice(t("We sent a new code.", "Te enviamos un código nuevo."));
  };
  return (
    <AuthPanel title={t("Enter your code", "Escribe tu código")} sub={t(`We sent a ${CODE_LENGTH}-digit code to ${request.email}.`, `Enviamos un código de ${CODE_LENGTH} dígitos a ${request.email}.`)}>
      <form className="stack" onSubmit={submit}>
        <Field label={t("Code", "Código")} hint={t("It expires in 10 minutes. Check your spam folder too.", "Vence en 10 minutos. Revisa también el correo no deseado.")}>
          {(id) => (
            <input
              id={id}
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern={`[0-9]{${CODE_LENGTH}}`}
              maxLength={CODE_LENGTH}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          )}
        </Field>
        {notice && <Banner tone="info" icon="check">{notice}</Banner>}
        {error && <div className="banner error" role="alert">{error}</div>}
        <Button type="submit" variant="primary" block loading={busy}>
          {t("Continue", "Continuar")}
        </Button>
      </form>
      <div className="row between small">
        <Button variant="ghost" size="small" onClick={onBack}>{t("Use a different email", "Usar otro correo")}</Button>
        <Button variant="ghost" size="small" onClick={() => void resend()}>{t("Send a new code", "Enviar otro código")}</Button>
      </div>
    </AuthPanel>
  );
}

export function InviteScreen() {
  const t = useT();
  const app = useApp();
  const navigate = useNavigate();
  const [token] = useState(() => {
    const fromHash = new URLSearchParams(location.hash.slice(1)).get("token");
    if (fromHash) sessionStorage.setItem(INVITE_KEY, fromHash);
    return fromHash ?? sessionStorage.getItem(INVITE_KEY);
  });
  useEffect(() => {
    // Keep the token out of the address bar and history.
    if (location.hash) history.replaceState(null, "", "/invite");
  }, []);
  const preview = useQuery(api.invites.preview, token ? { token } : "skip");
  const accept = useMutation(api.invites.accept);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!token || preview === null) {
    return (
      <AuthPanel title={t("Invitation", "Invitación")}>
        <Banner tone="error" icon="alert">{t("This invitation is no longer valid. Ask for a new one.", "Esta invitación ya no es válida. Pide una nueva.")}</Banner>
        <Link to="/" className="btn block">{t("Continue", "Continuar")}</Link>
      </AuthPanel>
    );
  }
  if (preview === undefined) return <AuthPanel title={t("Invitation", "Invitación")}>{t("Loading…", "Cargando…")}</AuthPanel>;
  const sub = t(
    `You were invited to ${preview.businessName} as ${roleLabel(t, preview.role)}, with ${preview.email}.`,
    `Te invitaron a ${preview.businessName} como ${roleLabel(t, preview.role)}, con ${preview.email}.`,
  );
  if (!app.user) {
    return (
      <AuthPanel title={t("Invitation", "Invitación")} sub={sub}>
        <p className="small muted">{t("Sign in or create an account with that email address to accept.", "Inicia sesión o crea una cuenta con ese correo para aceptar.")}</p>
        <Link to="/sign-up" className="btn primary block">{t("Create an account", "Crear una cuenta")}</Link>
        <Link to="/sign-in" className="btn block">{t("Sign in", "Iniciar sesión")}</Link>
      </AuthPanel>
    );
  }
  return (
    <AuthPanel title={t("Invitation", "Invitación")} sub={sub}>
      {error && <div className="banner error">{error}</div>}
      <Button
        variant="primary"
        block
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const id = await accept({ token });
            sessionStorage.removeItem(INVITE_KEY);
            app.setBusinessId(id);
            navigate("/", { replace: true });
          } catch (e) {
            setError(describeError(t, app.fmt, e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Accept invitation", "Aceptar invitación")}
      </Button>
      <Button variant="ghost" block onClick={() => void app.signOut()}>
        {t(`Not ${app.user.email}? Sign out`, `¿No eres ${app.user.email}? Cerrar sesión`)}
      </Button>
    </AuthPanel>
  );
}

/** A signed-in person with no business yet: create one. */
export function Welcome() {
  const t = useT();
  const { lang } = useLang();
  const app = useApp();
  const create = useMutation(api.businesses.create);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Santo_Domingo");
  const [currency, setCurrency] = useState("DOP");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [timezone];
  return (
    <AuthPanel
      title={t("Create your business", "Crea tu negocio")}
      sub={t("You'll be its administrator. You can invite others later.", "Serás su administrador. Luego puedes invitar a otros.")}
    >
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const id = await create({ name, timezone, language: lang, currencyCode: currency });
            app.setBusinessId(id as Id<"businesses">);
          } catch (err) {
            setError(describeError(t, app.fmt, err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t("Business name", "Nombre del negocio")}>{(id) => <input id={id} className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t("Currency", "Moneda")} hint={t("Only the symbol; amounts are never converted.", "Solo el símbolo; los montos no se convierten.")}>
          {(id) => (
            <select id={id} className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol} · {t(c.en, c.es)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("Time zone", "Zona horaria")} hint={t("Due dates and late fees follow the date here.", "Los vencimientos y la mora siguen la fecha de esta zona.")}>
          {(id) => (
            <select id={id} className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          )}
        </Field>
        {error && <div className="banner error">{error}</div>}
        <Button type="submit" variant="primary" block loading={busy}>
          {t("Create business", "Crear negocio")}
        </Button>
      </form>
      <p className="small muted">
        {t("Were you invited? Open the link from the invitation email.", "¿Te invitaron? Abre el enlace del correo de invitación.")}
      </p>
      <Button variant="ghost" icon="logout" onClick={() => void app.signOut()}>
        {t("Sign out", "Cerrar sesión")}
      </Button>
    </AuthPanel>
  );
}
