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
import { Icon, type IconName } from "../ui/icons";
import { Banner, Button, Field } from "../ui/kit";
import { LegalLinks } from "./legal";

const INVITE_KEY = "acervus.inviteToken";
const CODE_LENGTH = 6;
const googleEnabled = import.meta.env.VITE_GOOGLE_SIGN_IN === "true";

interface CodeRequest {
  email: string;
  name?: string;
}

type AuthFailure = { status?: number; code?: string; message?: string } | null | undefined;

/** The signed-out pages: a sky, the brand in the corner and one floating
 *  card with an icon tile, a title and the form. */
function AuthPanel({ title, sub, icon = "login", children }: { title: string; sub?: ReactNode; icon?: IconName; children: ReactNode }) {
  const { lang, setLang } = useLang();
  return (
    <div className="auth">
      <header className="auth-top">
        <span className="auth-brand">
          <img src="/pwa-192x192.png" alt="" />
          Acervus Finance
        </span>
        <Button variant="ghost" size="small" onClick={() => setLang(lang === "es" ? "en" : "es")}>
          {lang === "es" ? "English" : "Español"}
        </Button>
      </header>
      <div className="auth-card stack">
        <div className="auth-head">
          <span className="auth-tile">
            <Icon name={icon} />
          </span>
          <h1>{title}</h1>
          {sub && <p className="muted">{sub}</p>}
        </div>
        {children}
      </div>
      <p className="auth-legal small">
        <LegalLinks />
      </p>
    </div>
  );
}

/** Google's "G", in its own colors as Google's sign-in branding asks. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Better Auth error → a sentence. */
function authError(t: ReturnType<typeof useT>, e: AuthFailure): string | null {
  if (!e) return null;
  if (e.code === "INVALID_OTP") return t("That code is wrong. Check it and try again.", "Ese código no es correcto. Revísalo e inténtalo de nuevo.");
  if (e.code === "OTP_EXPIRED") return t("That code expired. Send a new one.", "Ese código venció. Pide uno nuevo.");
  if (e.code === "TOO_MANY_ATTEMPTS") return t("Too many wrong tries for this code. Send a new one.", "Demasiados intentos con este código. Pide uno nuevo.");
  if (e.code === "EMAIL_NOT_SENT") return t("We couldn't email your code. Try again in a few minutes.", "No pudimos enviarte el código por correo. Inténtalo de nuevo en unos minutos.");
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
      <div className="auth-or">{t("Or continue with", "O continúa con")}</div>
      <button type="button" className="auth-google" onClick={() => void authClient.signIn.social({ provider: "google", callbackURL: `${location.origin}${sessionStorage.getItem(INVITE_KEY) ? "/invite" : "/"}` })}>
        <GoogleMark />
        {t("Continue with Google", "Continuar con Google")}
      </button>
    </>
  );
}

export function SignIn() {
  const t = useT();
  const app = useApp();
  const [request, setRequest] = useState<CodeRequest | null>(null);
  if (request) return <CodeStep request={request} onBack={() => setRequest(null)} />;
  return (
    <AuthPanel
      title={t("Sign in to Acervus", "Inicia sesión en Acervus")}
      sub={t("We'll email you a 6-digit code. No password to remember.", "Te enviaremos un código de 6 dígitos. Sin contraseñas que recordar.")}
    >
      <EmailForm submitLabel={t("Send code", "Enviar código")} onSent={setRequest} />
      <GoogleButton />
      <p className="auth-foot">
        {t("New here?", "¿Eres nuevo?")} <Link to="/sign-up">{t("Create an account", "Crea una cuenta")}</Link>
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
    <AuthPanel
      icon="userPlus"
      title={t("Create an account", "Crear una cuenta")}
      sub={t("Then create your business or accept an invitation.", "Luego crea tu negocio o acepta una invitación.")}
    >
      <EmailForm name={name.trim()} submitLabel={t("Send code", "Enviar código")} onSent={setRequest}>
        <label className="auth-field">
          <Icon name="users" />
          <input
            className="input"
            autoComplete="name"
            required
            maxLength={100}
            aria-label={t("Your name", "Tu nombre")}
            placeholder={t("Your name", "Tu nombre")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </EmailForm>
      <GoogleButton />
      <p className="auth-foot">
        {t("Already have an account?", "¿Ya tienes una cuenta?")} <Link to="/sign-in">{t("Sign in", "Inicia sesión")}</Link>
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
      <label className="auth-field">
        <Icon name="mail" />
        <input
          className="input"
          type="email"
          autoComplete="email"
          required
          aria-label={t("Email", "Correo")}
          placeholder={t("Email", "Correo")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {error && <div className="banner error" role="alert">{error}</div>}
      <Button type="submit" variant="primary" className="auth-submit" block loading={busy}>
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
    <AuthPanel
      icon="key"
      title={t("Enter your code", "Escribe tu código")}
      sub={t(`We sent a ${CODE_LENGTH}-digit code to ${request.email}.`, `Enviamos un código de ${CODE_LENGTH} dígitos a ${request.email}.`)}
    >
      <form className="stack" onSubmit={submit}>
        <Field label={t("Code", "Código")} hint={t("It expires in 10 minutes. Check your spam folder too.", "Vence en 10 minutos. Revisa también el correo no deseado.")}>
          {(id) => (
            <input
              id={id}
              className="input auth-code"
              placeholder={"0".repeat(CODE_LENGTH)}
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
        <Button type="submit" variant="primary" className="auth-submit" block loading={busy}>
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
      <AuthPanel icon="mail" title={t("Invitation", "Invitación")}>
        <Banner tone="error" icon="alert">{t("This invitation is no longer valid. Ask for a new one.", "Esta invitación ya no es válida. Pide una nueva.")}</Banner>
        <Link to="/" className="btn block">{t("Continue", "Continuar")}</Link>
      </AuthPanel>
    );
  }
  if (preview === undefined) return <AuthPanel icon="mail" title={t("Invitation", "Invitación")}>{t("Loading…", "Cargando…")}</AuthPanel>;
  const sub = t(
    `You were invited to ${preview.businessName} as ${roleLabel(t, preview.role)}, with ${preview.email}.`,
    `Te invitaron a ${preview.businessName} como ${roleLabel(t, preview.role)}, con ${preview.email}.`,
  );
  if (!app.user) {
    return (
      <AuthPanel icon="mail" title={t("Invitation", "Invitación")} sub={sub}>
        <p className="small muted">{t("Sign in or create an account with that email address to accept.", "Inicia sesión o crea una cuenta con ese correo para aceptar.")}</p>
        <Link to="/sign-up" className="btn primary block">{t("Create an account", "Crear una cuenta")}</Link>
        <Link to="/sign-in" className="btn block">{t("Sign in", "Iniciar sesión")}</Link>
      </AuthPanel>
    );
  }
  return (
    <AuthPanel icon="mail" title={t("Invitation", "Invitación")} sub={sub}>
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
  const app = useApp();
  return (
    <AuthPanel
      icon="briefcase"
      title={t("Create your business", "Crea tu negocio")}
      sub={t("You'll be its administrator. You can invite others later.", "Serás su administrador. Luego puedes invitar a otros.")}
    >
      <PendingInvites />
      <NewBusinessForm />
      <p className="small muted">
        {t("Were you invited? Sign in with the email address the invitation was sent to, or open the link in the email.", "¿Te invitaron? Inicia sesión con el correo al que llegó la invitación, o abre el enlace del correo.")}
      </p>
      <Button variant="ghost" icon="logout" onClick={() => void app.signOut()}>
        {t("Sign out", "Cerrar sesión")}
      </Button>
    </AuthPanel>
  );
}

/** Invitations waiting for the signed-in email, each with Accept; nothing
 *  when there are none. */
export function PendingInvites({ className }: { className?: string }) {
  const t = useT();
  const app = useApp();
  const pending = useQuery(api.invites.pending, {});
  const accept = useMutation(api.invites.acceptPending);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!pending?.length) return null;
  return (
    <div className={`stack ${className ?? ""}`}>
      {pending.map((i) => (
        <div key={i.inviteId} className="banner row between wrap">
          <span>
            {t(`You were invited to ${i.businessName} as ${roleLabel(t, i.role)}.`, `Te invitaron a ${i.businessName} como ${roleLabel(t, i.role)}.`)}
          </span>
          <Button
            variant="primary"
            loading={busy === i.inviteId}
            onClick={async () => {
              setBusy(i.inviteId);
              setError(null);
              try {
                app.setBusinessId(await accept({ inviteId: i.inviteId }));
                sessionStorage.removeItem(INVITE_KEY);
              } catch (e) {
                setError(describeError(t, app.fmt, e));
              } finally {
                setBusy(null);
              }
            }}
          >
            {t("Accept", "Aceptar")}
          </Button>
        </div>
      ))}
      {error && <div className="banner error">{error}</div>}
    </div>
  );
}

/** Name, currency and time zone for a new business; the creator becomes its
 *  admin and the app opens it. Used on the welcome screen and in Settings. */
export function NewBusinessForm({ onCreated }: { onCreated?: () => void }) {
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
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const id = await create({ name, timezone, language: lang, currencyCode: currency });
          app.setBusinessId(id as Id<"businesses">);
          onCreated?.();
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
  );
}
