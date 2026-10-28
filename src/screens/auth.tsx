// Signing in and up (Better Auth), password reset, accepting an invitation
// and creating a business.

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { authClient } from "../lib/auth-client";
import { describeError } from "../lib/errors";
import { useLang, useT } from "../lib/i18n";
import { CURRENCIES, roleLabel } from "../lib/labels";
import { useApp } from "../state/app";
import { Banner, Button, Field } from "../ui/kit";

const INVITE_KEY = "acervus.inviteToken";
const googleEnabled = import.meta.env.VITE_GOOGLE_SIGN_IN === "true";

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
function authError(t: ReturnType<typeof useT>, e: { status?: number; code?: string; message?: string } | null | undefined): string | null {
  if (!e) return null;
  if (e.code === "EMAIL_NOT_VERIFIED" || e.status === 403) {
    return t("Confirm your email first: we sent you a link. Check your spam folder too.", "Primero confirma tu correo: te enviamos un enlace. Revisa también el correo no deseado.");
  }
  if (e.code === "INVALID_EMAIL_OR_PASSWORD" || e.status === 401) return t("Wrong email or password.", "Correo o contraseña incorrectos.");
  if (e.code === "USER_ALREADY_EXISTS" || e.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
    return t("There is already an account with this email. Sign in instead.", "Ya existe una cuenta con este correo. Inicia sesión.");
  }
  if (e.code === "PASSWORD_TOO_SHORT") return t("Use at least 10 characters.", "Usa al menos 10 caracteres.");
  if (e.status === 429) return t("Too many attempts. Wait a few minutes and try again.", "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.");
  if (!navigator.onLine) return t("No connection. Try again when you're online.", "Sin conexión. Inténtalo de nuevo cuando estés en línea.");
  return e.message || t("Something went wrong. Try again.", "Algo salió mal. Inténtalo de nuevo.");
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
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (err) {
      setUnverified(err.status === 403);
      setError(authError(t, err));
      return;
    }
    const invite = sessionStorage.getItem(INVITE_KEY);
    location.assign(invite ? `/invite#token=${invite}` : "/");
  };
  return (
    <AuthPanel title={t("Sign in", "Iniciar sesión")} sub="Acervus Finance">
      {params.get("verified") && <Banner tone="info" icon="check">{t("Email confirmed. Sign in to continue.", "Correo confirmado. Inicia sesión para continuar.")}</Banner>}
      {params.get("reset") && <Banner tone="info" icon="check">{t("Password changed. Sign in with the new one.", "Contraseña cambiada. Inicia sesión con la nueva.")}</Banner>}
      <form className="stack" onSubmit={submit}>
        <Field label={t("Email", "Correo")}>{(id) => <input id={id} className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label={t("Password", "Contraseña")}>
          {(id) => <input id={id} className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        {error && <div className="banner error" role="alert">{error}</div>}
        {unverified && (
          <Button
            variant="ghost"
            onClick={async () => {
              await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: `${location.origin}/sign-in?verified=1` });
              setError(t("We sent a new confirmation link.", "Te enviamos un nuevo enlace de confirmación."));
            }}
          >
            {t("Send the confirmation link again", "Enviar de nuevo el enlace")}
          </Button>
        )}
        <Button type="submit" variant="primary" block loading={busy}>
          {t("Sign in", "Iniciar sesión")}
        </Button>
      </form>
      <GoogleButton />
      <div className="row between small">
        <Link to="/forgot-password">{t("Forgot your password?", "¿Olvidaste tu contraseña?")}</Link>
        <Link to="/sign-up">{t("Create an account", "Crear una cuenta")}</Link>
      </div>
      {app.user === null && localStorage.getItem("acervus.lastUser") && !navigator.onLine && (
        <Button onClick={app.continueOffline}>{t("Continue offline", "Continuar sin conexión")}</Button>
      )}
    </AuthPanel>
  );
}

export function SignUp() {
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) {
      setError(t("Use at least 10 characters.", "Usa al menos 10 caracteres."));
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
      callbackURL: `${location.origin}/sign-in?verified=1`,
    });
    setBusy(false);
    if (err) setError(authError(t, err));
    else setSent(true);
  };
  if (sent) {
    return (
      <AuthPanel title={t("Check your email", "Revisa tu correo")}>
        <p>
          {t(
            `We sent a link to ${email}. Open it to confirm your address, then sign in.`,
            `Enviamos un enlace a ${email}. Ábrelo para confirmar tu correo y luego inicia sesión.`,
          )}
        </p>
        <Link to="/sign-in" className="btn primary block">{t("Go to sign in", "Ir a iniciar sesión")}</Link>
      </AuthPanel>
    );
  }
  return (
    <AuthPanel title={t("Create an account", "Crear una cuenta")} sub={t("Then create your business or accept an invitation.", "Luego crea tu negocio o acepta una invitación.")}>
      <form className="stack" onSubmit={submit}>
        <Field label={t("Your name", "Tu nombre")}>{(id) => <input id={id} className="input" autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t("Email", "Correo")}>{(id) => <input id={id} className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label={t("Password", "Contraseña")} hint={t("At least 10 characters.", "Al menos 10 caracteres.")}>
          {(id) => <input id={id} className="input" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        {error && <div className="banner error" role="alert">{error}</div>}
        <Button type="submit" variant="primary" block loading={busy}>
          {t("Create account", "Crear cuenta")}
        </Button>
      </form>
      <GoogleButton />
      <p className="small" style={{ textAlign: "center" }}>
        <Link to="/sign-in">{t("I already have an account", "Ya tengo una cuenta")}</Link>
      </p>
    </AuthPanel>
  );
}

export function ForgotPassword() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthPanel title={t("Reset your password", "Restablece tu contraseña")}>
      {done ? (
        <p>{t("If there is an account with that email, we sent it a link to reset the password.", "Si hay una cuenta con ese correo, le enviamos un enlace para restablecer la contraseña.")}</p>
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const { error: err } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: `${location.origin}/reset-password` });
            setBusy(false);
            if (err && err.status === 429) setError(authError(t, err));
            else setDone(true);
          }}
        >
          <Field label={t("Email", "Correo")}>{(id) => <input id={id} className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          {error && <div className="banner error">{error}</div>}
          <Button type="submit" variant="primary" block loading={busy}>
            {t("Send link", "Enviar enlace")}
          </Button>
        </form>
      )}
      <p className="small" style={{ textAlign: "center" }}>
        <Link to="/sign-in">{t("Back to sign in", "Volver a iniciar sesión")}</Link>
      </p>
    </AuthPanel>
  );
}

export function ResetPassword() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? t("This link has expired. Ask for a new one.", "Este enlace venció. Pide uno nuevo.") : null);
  return (
    <AuthPanel title={t("Choose a new password", "Elige una contraseña nueva")}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!token) return;
          setBusy(true);
          const { error: err } = await authClient.resetPassword({ newPassword: password, token });
          setBusy(false);
          if (err) setError(authError(t, err));
          else location.assign("/sign-in?reset=1");
        }}
      >
        <Field label={t("New password", "Contraseña nueva")} hint={t("At least 10 characters.", "Al menos 10 caracteres.")}>
          {(id) => <input id={id} className="input" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        {error && <div className="banner error">{error}</div>}
        <Button type="submit" variant="primary" block loading={busy} disabled={!token}>
          {t("Save password", "Guardar contraseña")}
        </Button>
      </form>
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
