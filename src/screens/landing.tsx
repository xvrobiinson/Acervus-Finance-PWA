// The public landing page: what Acervus is, for visitors who are not signed
// in. Signed-in people go straight to their app. Every feature named here is
// one the app has; the screenshots are the desktop app on synthetic demo
// data (public/landing). No prices, testimonials or figures are claimed.

import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useLang, useT } from "../lib/i18n";
import { Icon, type IconName } from "../ui/icons";
import { LegalLinks, SUPPORT_EMAIL } from "./legal";

/** The latest Windows installer: a direct file download (each desktop release
 *  also publishes it under this fixed name), so the visitor stays on the page. */
export const DESKTOP_DOWNLOAD = "https://github.com/xvrobiinson/ACERVUS-APP/releases/latest/download/AcervusFinance-Setup.exe";

type Pair = [string, string];

const FEATURES: { icon: IconName; title: Pair; body: Pair }[] = [
  {
    icon: "users",
    title: ["Clients", "Clientes"],
    body: [
      "Every client with contact details, ID photo and their full history of loans and payments. Search by name, phone or email.",
      "Cada cliente con sus datos de contacto, foto de identificación y todo su historial de préstamos y pagos. Busca por nombre, teléfono o correo.",
    ],
  },
  {
    icon: "loans",
    title: ["Loans", "Préstamos"],
    body: [
      "Installment or interest-only loans, daily to monthly. See the full schedule before you confirm, and adjust it when you need to.",
      "Préstamos por cuotas o solo interés, de diarios a mensuales. Mira el calendario completo antes de confirmar y ajústalo cuando lo necesites.",
    ],
  },
  {
    icon: "wallet",
    title: ["Payments", "Pagos"],
    body: [
      "Record full or partial payments and see the split between interest, capital and late fees before you save.",
      "Registra pagos completos o parciales y mira la división entre interés, capital y mora antes de guardar.",
    ],
  },
  {
    icon: "clock",
    title: ["Late fees", "Mora"],
    body: [
      "Late fees are added on their own when an installment is overdue, and you decide when to waive them.",
      "La mora se agrega sola cuando una cuota se atrasa, y tú decides cuándo perdonarla.",
    ],
  },
  {
    icon: "briefcase",
    title: ["Capital and money", "Capital y dinero"],
    body: [
      "Capital in and out, expenses, other income and transfers, so available capital and interest are always right.",
      "Entradas y salidas de capital, gastos, otros ingresos y transferencias, para que el capital y el interés disponibles estén siempre correctos.",
    ],
  },
  {
    icon: "receipt",
    title: ["Receipts", "Recibos"],
    body: [
      "Payment and loan receipts with your business name, logo and wording, ready to print or save as PDF.",
      "Recibos de pagos y préstamos con el nombre, logo y textos de tu negocio, listos para imprimir o guardar en PDF.",
    ],
  },
  {
    icon: "chart",
    title: ["Reports", "Reportes"],
    body: [
      "Portfolio value over time, return on capital, monthly cash flow and loans by status, computed from your records.",
      "Valor del portafolio en el tiempo, rendimiento del capital, flujo de caja mensual y préstamos por estado, calculados con tus registros.",
    ],
  },
  {
    icon: "key",
    title: ["Your team, your rules", "Tu equipo, tus reglas"],
    body: [
      "Invite collectors and viewers. Collectors record payments; the business totals stay with the admins.",
      "Invita cobradores y lectores. Los cobradores registran pagos; los totales del negocio quedan con los administradores.",
    ],
  },
];

const BENEFITS: { icon: IconName; title: Pair; body: Pair }[] = [
  {
    icon: "check",
    title: ["Everything in one place", "Todo en un solo lugar"],
    body: [
      "Clients, loans and payments live together, so you stop jumping between notebooks and spreadsheets.",
      "Clientes, préstamos y pagos juntos, para que dejes de saltar entre cuadernos y hojas de cálculo.",
    ],
  },
  {
    icon: "receipt",
    title: ["No more manual math", "Sin cuentas a mano"],
    body: [
      "Interest, splits, balances and late fees are calculated for you, the same way every time.",
      "Interés, divisiones, saldos y mora se calculan por ti, siempre de la misma forma.",
    ],
  },
  {
    icon: "alert",
    title: ["Know who is late", "Sabe quién está atrasado"],
    body: [
      "Overdue and soon-due loans come to the top, with the exact amount to collect.",
      "Los préstamos atrasados y por vencer aparecen primero, con el monto exacto a cobrar.",
    ],
  },
  {
    icon: "chart",
    title: ["See your growth", "Mira tu crecimiento"],
    body: [
      "Portfolio value, capital invested and interest earned, today and over time.",
      "Valor del portafolio, capital invertido e interés ganado, hoy y en el tiempo.",
    ],
  },
  {
    icon: "cloudOff",
    title: ["Collect on the road", "Cobra en la calle"],
    body: [
      "Record payments on your phone without signal; they sync when you are back online.",
      "Registra pagos en tu teléfono sin señal; se sincronizan cuando vuelves a tener conexión.",
    ],
  },
  {
    icon: "history",
    title: ["A clear trail", "Un historial claro"],
    body: [
      "Every change is kept in the history, so you can see who recorded what and when.",
      "Cada cambio queda en el historial, para que veas quién registró qué y cuándo.",
    ],
  },
];

const STEPS: { title: Pair; body: Pair }[] = [
  {
    title: ["Create your account", "Crea tu cuenta"],
    body: [
      "Sign up with a code sent to your email, or with Google. No password to remember.",
      "Regístrate con un código enviado a tu correo, o con Google. Sin contraseñas que recordar.",
    ],
  },
  {
    title: ["Organize your business", "Organiza tu negocio"],
    body: [
      "Add your capital, your clients and your loans. Invite your collectors if you have a team.",
      "Agrega tu capital, tus clientes y tus préstamos. Invita a tus cobradores si tienes equipo.",
    ],
  },
  {
    title: ["Manage with confidence", "Administra con confianza"],
    body: [
      "Record payments, follow balances and see what needs attention every day.",
      "Registra pagos, sigue los saldos y mira lo que requiere atención cada día.",
    ],
  },
];

const VIEWS: { key: string; label: Pair; caption: Pair }[] = [
  {
    key: "overview",
    label: ["Overview", "Resumen"],
    caption: ["Your totals, growth and the loans that need attention, the moment you open the app.", "Tus totales, tu crecimiento y los préstamos que requieren atención, apenas abres la app."],
  },
  {
    key: "loans",
    label: ["Loans", "Préstamos"],
    caption: ["Every loan with what is owed today, the next payment and how much capital is back.", "Cada préstamo con lo que se debe hoy, el próximo pago y cuánto capital ha regresado."],
  },
  {
    key: "clients",
    label: ["Clients", "Clientes"],
    caption: ["Clients with their active loans, balances and status at a glance.", "Clientes con sus préstamos activos, saldos y estado de un vistazo."],
  },
  {
    key: "analytics",
    label: ["Analytics", "Análisis"],
    caption: ["Returns, capital and growth, computed from what you record.", "Rendimiento, capital y crecimiento, calculados con lo que registras."],
  },
];

const FAQ: { q: Pair; a: Pair }[] = [
  {
    q: ["Do I need internet to use Acervus?", "¿Necesito internet para usar Acervus?"],
    a: [
      "The web and phone app needs a connection to start, then keeps working offline for recording clients, payments, expenses and income, and syncs when you are back online. The Windows app can work fully offline with no account at all.",
      "La app web y de teléfono necesita conexión para empezar; luego sigue funcionando sin conexión para registrar clientes, pagos, gastos e ingresos, y se sincroniza cuando vuelves a conectarte. La app de Windows puede funcionar totalmente sin internet y sin cuenta.",
    ],
  },
  {
    q: ["Can my collectors use it too?", "¿Mis cobradores también pueden usarla?"],
    a: [
      "Yes. Invite them by email as collectors or viewers. Collectors record payments and see the loans they work on; the business totals stay with the admins.",
      "Sí. Invítalos por correo como cobradores o lectores. Los cobradores registran pagos y ven los préstamos con los que trabajan; los totales del negocio quedan con los administradores.",
    ],
  },
  {
    q: ["Is my information private?", "¿Mi información es privada?"],
    a: [
      "Your records are yours. They are never sold or used for ads, and each business is kept apart from the others. The Privacy Policy explains where data is stored and how to delete it.",
      "Tus registros son tuyos. Nunca se venden ni se usan para anuncios, y cada negocio se mantiene separado de los demás. La Política de privacidad explica dónde se guardan los datos y cómo borrarlos.",
    ],
  },
  {
    q: ["Does Acervus lend money?", "¿Acervus presta dinero?"],
    a: [
      "No. Acervus is software to keep your lending business organized. It does not lend, hold or collect money for you.",
      "No. Acervus es un programa para mantener organizado tu negocio de préstamos. No presta, no guarda ni cobra dinero por ti.",
    ],
  },
  {
    q: ["Can I use my phone and my PC together?", "¿Puedo usar mi teléfono y mi PC juntos?"],
    a: [
      "Yes. Sign in on both and the same business stays in step between the web and phone app and the Windows app.",
      "Sí. Inicia sesión en ambos y el mismo negocio se mantiene al día entre la app web y de teléfono y la app de Windows.",
    ],
  },
  {
    q: ["Which languages are supported?", "¿Qué idiomas tiene?"],
    a: ["English and Spanish, switchable at any time.", "Inglés y español, y puedes cambiar cuando quieras."],
  },
];

/** A screenshot in the visitor's theme: both are in the page, CSS shows one. */
function Shot({ name, alt, className, eager }: { name: string; alt: string; className?: string; eager?: boolean }) {
  const loading = eager ? "eager" : "lazy";
  return (
    <>
      <img className={`${className ?? ""} lp-light-only`} src={`/landing/${name}-light.jpg`} alt={alt} loading={loading} decoding="async" />
      <img className={`${className ?? ""} lp-dark-only`} src={`/landing/${name}-dark.jpg`} alt={alt} loading={loading} decoding="async" />
    </>
  );
}

function Mark() {
  return (
    <span className="lp-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Check() {
  return <Icon name="check" className="lp-check" />;
}

function Section({ id, kicker, title, lead, center, children }: { id: string; kicker: string; title: string; lead?: string; center?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={`lp-section ${center ? "center" : ""}`}>
      <div className="lp-kicker">{kicker}</div>
      <h2 className="lp-h2">{title}</h2>
      {lead && <p className="lp-lead">{lead}</p>}
      {children}
    </section>
  );
}

export function LandingScreen() {
  const t = useT();
  const { lang, setLang } = useLang();
  const es = lang === "es" ? 1 : 0;
  const [menu, setMenu] = useState(false);
  const [view, setView] = useState(0);
  const other = lang === "es" ? "English" : "Español";
  const flip = () => setLang(lang === "es" ? "en" : "es");
  const links: [string, string][] = [
    ["#features", t("Features", "Funciones")],
    ["#benefits", t("Benefits", "Beneficios")],
    ["#how", t("How it works", "Cómo funciona")],
    ["#faq", t("FAQ", "Preguntas")],
  ];
  const v = VIEWS[view];

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <a href="#top" className="lp-brand">
            <Mark />
            <span>Acervus Finance</span>
          </a>
          <nav className="lp-links" aria-label={t("Sections", "Secciones")}>
            {links.map(([href, label]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <div className="lp-right">
            <button type="button" className="lp-pill ghost bare lp-wide-only" onClick={flip}>
              {other}
            </button>
            <Link to="/sign-in" className="lp-pill ghost lp-wide-only">
              {t("Sign in", "Iniciar sesión")}
            </Link>
            <Link to="/sign-up" className="lp-pill solid">
              {t("Get started", "Empezar")}
            </Link>
            <button type="button" className="lp-burger" aria-label={t("Menu", "Menú")} aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <Icon name={menu ? "close" : "more"} />
            </button>
          </div>
        </div>
        {menu && (
          <div className="lp-wrap lp-menu">
            {links.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenu(false)}>
                {label}
              </a>
            ))}
            <div className="lp-menu-row">
              <Link to="/sign-in" className="lp-pill ghost">
                {t("Sign in", "Iniciar sesión")}
              </Link>
              <button type="button" className="lp-pill ghost" onClick={flip}>
                {other}
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="lp-wrap" id="top">
        <div className="lp-hero">
          <div className="lp-hero-text">
            <div className="lp-eyebrow">
              <i />
              {t("Lending, organized", "Préstamos, en orden")}
            </div>
            <h1>{t("Take control of your lending business.", "Toma el control de tu negocio de préstamos.")}</h1>
            <p>
              {t(
                "Manage clients, loans, payments, expenses and income in one place. Acervus works out every split, due date and late fee, so you always know who owes what.",
                "Administra clientes, préstamos, pagos, gastos e ingresos en un solo lugar. Acervus calcula cada división, vencimiento y mora, para que siempre sepas quién debe qué.",
              )}
            </p>
            <div className="lp-cta">
              <Link to="/sign-up" className="lp-pill light">
                {t("Get started", "Empezar")} <Icon name="chevron" />
              </Link>
              <a href="#features" className="lp-pill glass">
                {t("Explore features", "Ver funciones")}
              </a>
            </div>
          </div>
          <Shot
            name="overview"
            eager
            className="lp-hero-shot"
            alt={t("The Acervus Overview: portfolio value, capital lent out, interest earned and loans that need attention", "El Resumen de Acervus: valor del portafolio, capital prestado, interés cobrado y préstamos que requieren atención")}
          />
        </div>
        <div className="lp-bar">
          <div className="lp-bar-item">
            <div className="k">{t("Works on", "Funciona en")}</div>
            <div className="v">{t("Phone, browser and Windows", "Teléfono, navegador y Windows")}</div>
          </div>
          <span className="lp-sep" />
          <div className="lp-bar-item">
            <div className="k">{t("Works offline", "Sin conexión")}</div>
            <div className="v">{t("Record payments without signal", "Registra pagos sin señal")}</div>
          </div>
          <span className="lp-sep" />
          <div className="lp-bar-item">
            <div className="k">{t("Languages", "Idiomas")}</div>
            <div className="v">English · Español</div>
          </div>
          <Link to="/sign-up" className="lp-pill solid square">
            {t("Get started", "Empezar")}
          </Link>
        </div>
        <p className="lp-tagline">{t("Your lending business. Organized in one place.", "Tu negocio de préstamos. Organizado en un solo lugar.")}</p>

        <Section
          id="features"
          kicker={t("Features", "Funciones")}
          title={t("Everything you need to manage your lending business.", "Todo lo que necesitas para administrar tu negocio de préstamos.")}
          lead={t(
            "Built around how lenders actually work: who owes what, what's due this week, and where every peso went.",
            "Hecho para cómo trabajan los prestamistas: quién debe qué, qué vence esta semana y a dónde fue cada peso.",
          )}
        >
          <div className="lp-grid four">
            {FEATURES.map((f, i) => (
              <div key={f.title[0]} className="lp-card">
                <span className={`lp-ico ${i === 0 ? "on" : ""}`}>
                  <Icon name={f.icon} />
                </span>
                <h3>{f.title[es]}</h3>
                <p>{f.body[es]}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="showcase" center kicker={t("See it in action", "Míralo en acción")} title={t("This is what you get after signing up.", "Esto es lo que tendrás al registrarte.")}>
          <div className="lp-tabs" role="tablist">
            {VIEWS.map((x, i) => (
              <button key={x.key} type="button" role="tab" aria-selected={i === view} className={i === view ? "on" : ""} onClick={() => setView(i)}>
                {x.label[es]}
              </button>
            ))}
          </div>
          <div className="lp-frame">
            <Shot key={v.key} name={v.key} alt={v.label[es]} />
          </div>
          <p className="lp-caption">{v.caption[es]}</p>
        </Section>

        <Section id="benefits" kicker={t("Benefits", "Beneficios")} title={t("Spend less time managing records. More time growing your business.", "Menos tiempo con los registros. Más tiempo para hacer crecer tu negocio.")}>
          <div className="lp-grid three">
            {BENEFITS.map((b) => (
              <div key={b.title[0]} className="lp-card">
                <span className="lp-ico">
                  <Icon name={b.icon} />
                </span>
                <h3>{b.title[es]}</h3>
                <p>{b.body[es]}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="how" kicker={t("How it works", "Cómo funciona")} title={t("Up and running in three steps.", "Listo en tres pasos.")}>
          <div className="lp-grid three">
            {STEPS.map((s, i) => (
              <div key={s.title[0]} className="lp-card">
                <div className="lp-step">0{i + 1}</div>
                <h3>{s.title[es]}</h3>
                <p>{s.body[es]}</p>
              </div>
            ))}
          </div>
          <div className="lp-center-row">
            <Link to="/sign-up" className="lp-pill solid big">
              {t("Start managing your business", "Empieza a administrar tu negocio")}
            </Link>
          </div>
        </Section>

        <Section
          id="ways"
          kicker={t("Web and desktop", "Web y escritorio")}
          title={t("Your business. Your way.", "Tu negocio. A tu manera.")}
          lead={t(
            "Use Acervus in your browser and on your phone, on your Windows PC, or both. They stay in step.",
            "Usa Acervus en tu navegador y en tu teléfono, en tu PC con Windows, o en ambos. Se mantienen al día.",
          )}
        >
          <div className="lp-ways">
            <div className="lp-way">
              <span className="lp-ico on">
                <Icon name="home" />
              </span>
              <h3>{t("Web and phone app", "App web y de teléfono")}</h3>
              <ul>
                <li><Check />{t("Open it in any modern browser, nothing to download.", "Ábrela en cualquier navegador moderno, sin descargar nada.")}</li>
                <li><Check />{t("Add it to your phone's home screen like an app.", "Agrégala a la pantalla de inicio de tu teléfono como una app.")}</li>
                <li><Check />{t("Record clients, payments, expenses and income offline; they sync later.", "Registra clientes, pagos, gastos e ingresos sin conexión; se sincronizan después.")}</li>
                <li><Check />{t("Your team works on the same business from their own phones.", "Tu equipo trabaja en el mismo negocio desde sus propios teléfonos.")}</li>
              </ul>
              <div className="lp-way-cta">
                <Link to="/sign-up" className="lp-pill solid">
                  {t("Open the web app", "Abrir la app web")}
                </Link>
              </div>
            </div>
            <div className="lp-way dark">
              <span className="lp-ico glassy">
                <Icon name="briefcase" />
              </span>
              <h3>{t("Windows desktop app", "App de escritorio para Windows")}</h3>
              <ul>
                <li><Check />{t("For Windows 10 and 11 (64-bit).", "Para Windows 10 y 11 (64 bits).")}</li>
                <li><Check />{t("Works fully offline and private on your PC, no account needed.", "Funciona totalmente sin internet y en privado en tu PC, sin cuenta.")}</li>
                <li><Check />{t("Or sign in to keep it in step with the web and phone app.", "O inicia sesión para mantenerla al día con la app web y de teléfono.")}</li>
                <li><Check />{t("Backups on your PC or in your own Google Drive.", "Copias de seguridad en tu PC o en tu propio Google Drive.")}</li>
              </ul>
              <div className="lp-way-cta">
                <a href={DESKTOP_DOWNLOAD} className="lp-pill light" download>
                  <Icon name="download" />
                  {t("Download for Windows", "Descargar para Windows")}
                </a>
                <span className="lp-small">{t("By VZ Labs", "Por VZ Labs")}</span>
              </div>
            </div>
          </div>
        </Section>

        <Section id="faq" center kicker={t("FAQ", "Preguntas")} title={t("Questions, answered.", "Preguntas frecuentes.")}>
          <div className="lp-faq">
            {FAQ.map((f, i) => (
              <details key={f.q[0]} className="lp-q" open={i === 0}>
                <summary>{f.q[es]}</summary>
                <p>{f.a[es]}</p>
              </details>
            ))}
          </div>
        </Section>

        <div className="lp-final">
          <h2>{t("Your lending business, organized.", "Tu negocio de préstamos, en orden.")}</h2>
          <p>{t("Create your account in a minute and add your first client today.", "Crea tu cuenta en un minuto y agrega tu primer cliente hoy.")}</p>
          <div className="lp-cta center">
            <Link to="/sign-up" className="lp-pill light">
              {t("Get started", "Empezar")}
            </Link>
            <Link to="/sign-in" className="lp-pill glass">
              {t("Sign in", "Iniciar sesión")}
            </Link>
          </div>
        </div>

        <footer className="lp-foot">
          <div className="lp-foot-who">
            <span className="strong">{t("Acervus Finance, by VZ Labs", "Acervus Finance, por VZ Labs")}</span>
            <span>
              {t("Questions or help:", "Preguntas o ayuda:")} <strong>{SUPPORT_EMAIL}</strong>
            </span>
          </div>
          <div className="lp-foot-links">
            <LegalLinks />
            <a href={DESKTOP_DOWNLOAD} download>
              {t("Download for Windows", "Descargar para Windows")}
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
