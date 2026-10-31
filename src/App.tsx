// Routes, the signed-in shell (side rail on wide screens, tab bar and "+"
// button on phones), the offline/sync banner and the update prompt.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useT } from "./lib/i18n";
import { InviteScreen, SignIn, SignUp, Welcome } from "./screens/auth";
import { ClientDetail, ClientForm, ClientsScreen } from "./screens/clients";
import { HistoryScreen } from "./screens/history";
import { LegalScreen } from "./screens/legal";
import { LoanDetail, LoanForm, LoansScreen } from "./screens/loans";
import { EntryForm, MoneyScreen, type EntryFormKind } from "./screens/money";
import { MoreScreen } from "./screens/more";
import { OverviewScreen } from "./screens/overview";
import { PaymentForm } from "./screens/payment";
import { ReportsScreen } from "./screens/reports";
import { SettingsScreen } from "./screens/settings";
import { SyncScreen } from "./screens/sync";
import { useApp } from "./state/app";
import { Icon, type IconName } from "./ui/icons";
import { Banner, Button, Sheet } from "./ui/kit";

export function App() {
  const app = useApp();
  const t = useT();
  const location = useLocation();

  // The Terms and the Privacy Policy are public: readable signed in or out.
  if (location.pathname === "/terms") return <LegalScreen page="terms" />;
  if (location.pathname === "/privacy") return <LegalScreen page="privacy" />;
  if (app.mode === "loading") return <Splash />;
  if (app.mode === "signed_out") {
    return (
      <>
        <AutoUpdate />
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/sign-up" element={<SignUp />} />
          <Route path="/invite" element={<InviteScreen />} />
          <Route path="*" element={<Navigate to={`/sign-in${location.search}`} replace />} />
        </Routes>
      </>
    );
  }
  if (location.pathname === "/invite") return <InviteScreen />;
  if (app.businesses === null) return <Splash />;
  if (app.businesses.length === 0) {
    return app.mode === "online" ? (
      <Welcome />
    ) : (
      <Splash message={t("Connect to the internet once to set up your business.", "Conéctate a internet una vez para configurar tu negocio.")} />
    );
  }
  if (!app.snapshot) {
    return app.mode === "online" ? (
      <Splash />
    ) : (
      <Splash
        message={t(
          "This business hasn't been opened on this device yet, so there is no offline copy. Connect to the internet to load it.",
          "Este negocio aún no se ha abierto en este dispositivo, así que no hay copia sin conexión. Conéctate para cargarlo.",
        )}
      />
    );
  }
  return (
    <FormsProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<OverviewScreen />} />
          <Route path="/clients" element={<ClientsScreen />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/loans" element={<LoansScreen />} />
          <Route path="/loans/:id" element={<LoanDetail />} />
          {/* The business's balances and returns: admins only. */}
          <Route path="/money" element={app.can("manage") ? <MoneyScreen /> : <Navigate to="/" replace />} />
          <Route path="/reports" element={app.can("manage") ? <ReportsScreen /> : <Navigate to="/" replace />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/sync" element={<SyncScreen />} />
          <Route path="/more" element={<MoreScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </FormsProvider>
  );
}

function Splash({ message }: { message?: string }) {
  const app = useApp();
  const t = useT();
  return (
    <div className="auth splash">
      <div className="panel stack" style={{ alignItems: "center", textAlign: "center" }}>
        <img className="logo" src="/pwa-192x192.png" alt="" />
        {message ? <p>{message}</p> : <span className="btn ghost" aria-busy="true"><span className="spinner" /> {t("Loading…", "Cargando…")}</span>}
        {message && app.user && (
          <Button variant="ghost" icon="logout" onClick={() => void app.signOut()}>
            {t("Sign out", "Cerrar sesión")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ----- forms opened from anywhere ------------------------------------------

export type FormRequest =
  | { kind: "payment"; loanId?: string; paymentId?: string }
  | { kind: "loan"; clientId?: string; loanId?: string }
  | { kind: "client"; clientId?: string; afterCreate?: (id: string) => void }
  | { kind: "entry"; entry: EntryFormKind; id?: string };

const FormsCtx = createContext<(r: FormRequest | null) => void>(() => {});
export const useForms = () => useContext(FormsCtx);

function FormsProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<FormRequest | null>(null);
  const close = () => setForm(null);
  return (
    <FormsCtx.Provider value={setForm}>
      {children}
      {form?.kind === "payment" && <PaymentForm loanId={form.loanId} paymentId={form.paymentId} onClose={close} />}
      {form?.kind === "loan" && <LoanForm clientId={form.clientId} loanId={form.loanId} onClose={close} />}
      {form?.kind === "client" && <ClientForm clientId={form.clientId} onClose={close} afterCreate={form.afterCreate} />}
      {form?.kind === "entry" && <EntryForm kind={form.entry} id={form.id} onClose={close} />}
    </FormsCtx.Provider>
  );
}

// ----- shell ---------------------------------------------------------------

function Shell({ children }: { children: ReactNode }) {
  const app = useApp();
  const t = useT();
  const open = useForms();
  const [quick, setQuick] = useState(false);
  const waiting = app.ops.filter((o) => o.status === "pending" || o.status === "syncing").length;
  const review = app.ops.filter((o) => o.status === "needs_review").length;
  const nav: [string, IconName, string][] = [
    ["/", "home", t("Overview", "Resumen")],
    ["/clients", "users", t("Clients", "Clientes")],
    ["/loans", "loans", t("Loans", "Préstamos")],
    ...(app.can("manage") ? [["/money", "wallet", t("Money", "Dinero")] as [string, IconName, string]] : []),
  ];
  const quickItems: [string, IconName, () => void, boolean][] = [
    [t("Record payment", "Registrar pago"), "receipt", () => open({ kind: "payment" }), app.can("record")],
    [t("New loan", "Nuevo préstamo"), "loans", () => open({ kind: "loan" }), app.can("manage") && app.mode === "online"],
    [t("New client", "Nuevo cliente"), "users", () => open({ kind: "client" }), app.can("record")],
    [t("Expense", "Gasto"), "wallet", () => open({ kind: "entry", entry: "expense" }), app.can("record")],
    [t("Income", "Ingreso"), "wallet", () => open({ kind: "entry", entry: "income" }), app.can("record")],
  ];
  return (
    <div className="shell">
      <nav className="nav-rail" aria-label={t("Sections", "Secciones")}>
        <div className="brand">
          <img src="/pwa-64x64.png" alt="" />
          <span className="ellipsis">{app.business?.name}</span>
        </div>
        {nav.map(([to, icon, label]) => (
          <NavLink key={to} to={to} end={to === "/"}>
            <Icon name={icon} />
            {label}
          </NavLink>
        ))}
        {app.can("manage") && (
          <NavLink to="/reports">
            <Icon name="chart" />
            {t("Reports", "Reportes")}
          </NavLink>
        )}
        <NavLink to="/history">
          <Icon name="history" />
          {t("History", "Historial")}
        </NavLink>
        <NavLink to="/sync">
          <Icon name="sync" />
          {t("Sync", "Sincronización")}
          {waiting + review > 0 && <span className="pill warn" style={{ marginLeft: "auto" }}>{waiting + review}</span>}
        </NavLink>
        <NavLink to="/settings">
          <Icon name="settings" />
          {t("Settings", "Ajustes")}
        </NavLink>
        <div className="spacer" />
        {app.can("record") && (
          <Button variant="primary" icon="plus" onClick={() => setQuick(true)}>
            {t("New", "Nuevo")}
          </Button>
        )}
      </nav>
      <main className="main">
        <StatusBanner waiting={waiting} review={review} />
        <UpdatePrompt />
        {children}
      </main>
      <nav className="tabbar" aria-label={t("Sections", "Secciones")}>
        {[...nav, ["/more", "more", t("More", "Más")] as [string, IconName, string]].map(([to, icon, label]) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `tab ${isActive ? "active" : ""}`}>
            <Icon name={icon} />
            {label}
            {to === "/more" && waiting + review > 0 && <span className="dot" />}
          </NavLink>
        ))}
      </nav>
      {app.can("record") && (
        <button type="button" className="fab" aria-label={t("New", "Nuevo")} onClick={() => setQuick(true)}>
          <Icon name="plus" />
        </button>
      )}
      {quick && (
        <Sheet title={t("New", "Nuevo")} onClose={() => setQuick(false)}>
          <ul className="list">
            {quickItems
              .filter(([, , , ok]) => ok)
              .map(([label, icon, go]) => (
                <li key={label}>
                  <button
                    type="button"
                    className="list-row"
                    onClick={() => {
                      setQuick(false);
                      go();
                    }}
                  >
                    <span className="avatar">
                      <Icon name={icon} width={18} height={18} />
                    </span>
                    <span className="title grow">{label}</span>
                    <Icon name="chevron" width={18} height={18} />
                  </button>
                </li>
              ))}
          </ul>
          {app.mode !== "online" && app.can("manage") && (
            <p className="small muted">
              {t("New loans need a connection: they move money between accounts.", "Los préstamos nuevos necesitan conexión: mueven dinero entre cuentas.")}
            </p>
          )}
        </Sheet>
      )}
    </div>
  );
}

/** Says whether what's on screen is live, and whether changes are waiting. */
function StatusBanner({ waiting, review }: { waiting: number; review: number }) {
  const app = useApp();
  const t = useT();
  const when = app.savedAt ? new Date(app.savedAt).toLocaleString(app.fmt.lang === "es" ? "es" : "en", { dateStyle: "medium", timeStyle: "short" }) : "—";
  return (
    <>
      {app.mode === "offline" || !app.connected ? (
        <Banner tone="offline" icon="cloudOff">
          <strong>{t("Offline.", "Sin conexión.")}</strong>{" "}
          {t(`Showing the copy saved on this device (${when}).`, `Mostrando la copia guardada en este dispositivo (${when}).`)}{" "}
          {waiting > 0 && t(`${waiting} change(s) will sync when you're back online.`, `${waiting} cambio(s) se sincronizarán al volver la conexión.`)}
        </Banner>
      ) : waiting > 0 ? (
        <Banner tone="info" icon="sync" action={<NavLink to="/sync" className="btn small ghost">{t("View", "Ver")}</NavLink>}>
          {app.syncing ? t(`Syncing ${waiting} change(s)…`, `Sincronizando ${waiting} cambio(s)…`) : t(`${waiting} change(s) waiting to sync.`, `${waiting} cambio(s) esperando sincronizar.`)}
        </Banner>
      ) : null}
      {review > 0 && (
        <Banner tone="warn" icon="alert" action={<NavLink to="/sync" className="btn small">{t("Review", "Revisar")}</NavLink>}>
          {t(`${review} change(s) made offline need your review before they can be saved.`, `${review} cambio(s) hechos sin conexión necesitan tu revisión antes de guardarse.`)}
        </Banner>
      )}
      {app.lastSync?.report.blocked === "auth" && (
        <Banner tone="error" icon="alert" action={<Button size="small" onClick={() => void app.signOut()}>{t("Sign in", "Iniciar sesión")}</Button>}>
          {t("Your session ended. Sign in again to sync; your changes are kept on this device.", "Tu sesión terminó. Inicia sesión para sincronizar; tus cambios siguen guardados en este dispositivo.")}
        </Banner>
      )}
    </>
  );
}

/** Signed out there is nothing to lose, so a new version is applied at
 *  once; otherwise the sign-in pages would keep showing the old one. */
function AutoUpdate() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });
  useEffect(() => {
    if (needRefresh) void updateServiceWorker(true);
  }, [needRefresh, updateServiceWorker]);
  return null;
}

function UpdatePrompt() {
  const t = useT();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });
  if (!needRefresh) return null;
  return (
    <Banner tone="info" icon="download" action={<Button size="small" variant="primary" onClick={() => void updateServiceWorker(true)}>{t("Update", "Actualizar")}</Button>}>
      {t("A new version of the app is ready.", "Hay una versión nueva de la aplicación.")}
    </Banner>
  );
}
