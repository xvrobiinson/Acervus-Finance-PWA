// Terms of Service and Privacy Policy: public pages, readable signed in or
// out, in English and Spanish. The desktop app links here from its About.
// A plain-language draft written for the owner (2026-10-30); not reviewed by
// a lawyer.

import { Link } from "react-router";
import { useLang, useT } from "../lib/i18n";
import { Button } from "../ui/kit";

const UPDATED: [string, string] = ["October 30, 2026", "30 de octubre de 2026"];
export const SUPPORT_EMAIL = "officialvzlabs@gmail.com";

type Section = { h: [string, string]; p: [string, string][] };

const TERMS: Section[] = [
  {
    h: ["About these terms", "Sobre estos términos"],
    p: [
      [
        "Acervus Finance (\"Acervus\", \"the app\") is made by VZ Labs. These terms cover the web and phone app and the Windows desktop app. By using Acervus you agree to them; if you don't, please don't use it.",
        "Acervus Finance (\"Acervus\", \"la app\") es creada por VZ Labs. Estos términos cubren la app web y de teléfono y la app de escritorio para Windows. Al usar Acervus aceptas estos términos; si no estás de acuerdo, no la uses.",
      ],
    ],
  },
  {
    h: ["What Acervus does", "Qué hace Acervus"],
    p: [
      [
        "Acervus is a tool to keep track of a lending book: clients, loans, payments, interest, expenses and capital. It does not lend money, hold money, collect payments or give financial, legal or tax advice.",
        "Acervus es una herramienta para llevar un libro de préstamos: clientes, préstamos, pagos, intereses, gastos y capital. No presta dinero, no guarda dinero, no cobra pagos y no da asesoría financiera, legal ni fiscal.",
      ],
      [
        "Every figure is calculated from what you record. Check important figures before relying on them. You are responsible for your loans and for following the laws that apply to you, including any rules on interest rates, lending, collections and record keeping.",
        "Cada cifra se calcula con lo que registras. Revisa las cifras importantes antes de confiar en ellas. Tú eres responsable de tus préstamos y de cumplir las leyes que te apliquen, incluidas las normas sobre tasas de interés, préstamos, cobros y registros.",
      ],
    ],
  },
  {
    h: ["Your account and your team", "Tu cuenta y tu equipo"],
    p: [
      [
        "You sign in with a code sent to your email or with Google. Keep access to your email and devices safe: what is done from your account is your responsibility.",
        "Inicias sesión con un código enviado a tu correo o con Google. Mantén seguros tu correo y tus dispositivos: lo que se haga desde tu cuenta es tu responsabilidad.",
      ],
      [
        "The person who creates a business is its admin and decides who else can see or change it (admin, collector or viewer). Invite only people you trust; you can remove them at any time.",
        "Quien crea un negocio es su administrador y decide quién más puede verlo o cambiarlo (administrador, cobrador o lector). Invita solo a personas de confianza; puedes quitarlas en cualquier momento.",
      ],
    ],
  },
  {
    h: ["Your data", "Tus datos"],
    p: [
      [
        "What you record is yours. VZ Labs stores it only to run the app for you, as the Privacy Policy explains, and never sells it.",
        "Lo que registras es tuyo. VZ Labs lo guarda solo para hacer funcionar la app para ti, como explica la Política de privacidad, y nunca lo vende.",
      ],
      [
        "You may record information about your clients, including ID numbers and ID photos. Do so only when you are allowed to, and let your clients know you keep it.",
        "Puedes registrar información de tus clientes, incluidos números y fotos de identificación. Hazlo solo cuando tengas permiso y avísales a tus clientes que la guardas.",
      ],
    ],
  },
  {
    h: ["Fair use", "Uso correcto"],
    p: [
      [
        "Don't use Acervus for anything illegal, to harass or threaten anyone, or to try to break, overload or get around the app's security.",
        "No uses Acervus para nada ilegal, para acosar o amenazar a nadie, ni para intentar romper, sobrecargar o saltarte la seguridad de la app.",
      ],
    ],
  },
  {
    h: ["Availability and backups", "Disponibilidad y copias de seguridad"],
    p: [
      [
        "We work to keep Acervus running and correct, but it is provided as it is, without guarantees. It may change, have errors or be unavailable at times. Keep your own copies of what matters: the app can export your data, and the desktop app makes backups.",
        "Trabajamos para que Acervus funcione bien, pero se ofrece tal como está, sin garantías. Puede cambiar, tener errores o no estar disponible a veces. Guarda tus propias copias de lo importante: la app puede exportar tus datos y la app de escritorio hace copias de seguridad.",
      ],
    ],
  },
  {
    h: ["Limits of responsibility", "Límites de responsabilidad"],
    p: [
      [
        "As far as the law allows, VZ Labs is not responsible for losses that come from using or not being able to use Acervus, from wrong figures, or from lost data, including lost profits or unpaid loans.",
        "En la medida que la ley lo permita, VZ Labs no es responsable por pérdidas que vengan de usar o no poder usar Acervus, de cifras erróneas o de datos perdidos, incluidas ganancias perdidas o préstamos no pagados.",
      ],
    ],
  },
  {
    h: ["Stopping", "Dejar de usarla"],
    p: [
      [
        "You can stop using Acervus at any time, delete a business you administer from Settings, or write to us to delete your account. We may suspend an account that breaks these terms.",
        "Puedes dejar de usar Acervus cuando quieras, borrar un negocio que administres desde Ajustes o escribirnos para borrar tu cuenta. Podemos suspender una cuenta que no cumpla estos términos.",
      ],
    ],
  },
  {
    h: ["Changes", "Cambios"],
    p: [
      [
        "We may update these terms. The date at the top shows the latest version, and we'll tell you in the app about important changes. Using Acervus after a change means you accept it.",
        "Podemos actualizar estos términos. La fecha de arriba muestra la última versión y te avisaremos en la app de los cambios importantes. Seguir usando Acervus después de un cambio significa que lo aceptas.",
      ],
    ],
  },
];

const PRIVACY: Section[] = [
  {
    h: ["Who we are", "Quiénes somos"],
    p: [
      [
        "Acervus Finance is made by VZ Labs. This policy explains what information the app keeps, why, where, and what you can do about it.",
        "Acervus Finance es creada por VZ Labs. Esta política explica qué información guarda la app, para qué, dónde y qué puedes hacer al respecto.",
      ],
    ],
  },
  {
    h: ["What we keep", "Qué guardamos"],
    p: [
      [
        "Your account: your email address and name, and, if you sign in with Google, the basic profile Google shares (name and email).",
        "Tu cuenta: tu correo y tu nombre y, si entras con Google, el perfil básico que Google comparte (nombre y correo).",
      ],
      [
        "Your business records: what you and your team enter, such as clients' names, contact details, ID numbers and ID photos, loans, payments, expenses, income, settings and a history of changes.",
        "Los registros de tu negocio: lo que tú y tu equipo ingresan, como nombres, datos de contacto, números y fotos de identificación de clientes, préstamos, pagos, gastos, ingresos, ajustes y un historial de cambios.",
      ],
      [
        "What is needed to run the service safely: sign-in sessions and, at our providers, technical logs such as IP addresses used to stop abuse.",
        "Lo necesario para que el servicio funcione con seguridad: las sesiones de inicio y, en nuestros proveedores, registros técnicos como direcciones IP usadas para frenar abusos.",
      ],
      [
        "We don't show ads, don't sell or rent your information, and don't use tracking or analytics tools.",
        "No mostramos anuncios, no vendemos ni alquilamos tu información y no usamos herramientas de rastreo ni de analítica.",
      ],
    ],
  },
  {
    h: ["The desktop app", "La app de escritorio"],
    p: [
      [
        "Without signing in, the Windows app keeps everything on your PC and makes no network requests. Signed in, it keeps the business you choose in step with the cloud. Google Drive backups happen only if you turn them on, and are saved in your own Drive.",
        "Sin iniciar sesión, la app de Windows guarda todo en tu PC y no usa internet. Con sesión iniciada, mantiene al día con la nube el negocio que elijas. Las copias en Google Drive solo se hacen si las activas y se guardan en tu propio Drive.",
      ],
    ],
  },
  {
    h: ["Where it is stored", "Dónde se guarda"],
    p: [
      [
        "We use these providers to run Acervus: Convex (database and files), Cloudflare (hosting the web app), Brevo (sending sign-in codes by email) and Google (sign-in with Google, and Drive backups if you choose them). They may process data in other countries, including the United States, and only on our behalf.",
        "Usamos estos proveedores para hacer funcionar Acervus: Convex (base de datos y archivos), Cloudflare (alojamiento de la app web), Brevo (envío de códigos por correo) y Google (inicio de sesión con Google y copias en Drive si las eliges). Pueden procesar datos en otros países, incluido Estados Unidos, y solo en nuestro nombre.",
      ],
    ],
  },
  {
    h: ["Who can see it", "Quién puede verlo"],
    p: [
      [
        "Only the people in your business, according to the role you gave them. ID photos are shown to admins only and are never cached, exported or printed. VZ Labs looks at your records only to help when you ask, or when the law requires it.",
        "Solo las personas de tu negocio, según el rol que les diste. Las fotos de identificación solo las ven los administradores y nunca se guardan en caché, se exportan ni se imprimen. VZ Labs mira tus registros solo para ayudarte cuando lo pides o cuando la ley lo exige.",
      ],
    ],
  },
  {
    h: ["Security", "Seguridad"],
    p: [
      [
        "Connections are encrypted, every request is checked against your role, and each business is kept apart from the others. No system is perfect, so keep your devices and email secure too.",
        "Las conexiones están cifradas, cada solicitud se revisa según tu rol y cada negocio se mantiene separado de los demás. Ningún sistema es perfecto, así que mantén seguros también tus dispositivos y tu correo.",
      ],
    ],
  },
  {
    h: ["Keeping and deleting", "Conservar y borrar"],
    p: [
      [
        "Records are kept while the business exists. When an admin deletes a business, its records and photos are deleted; copies in our providers' own backups may last a short while longer. To delete your account, write to us. Data in the desktop app stays on your PC until you delete it.",
        "Los registros se guardan mientras el negocio exista. Cuando un administrador borra un negocio, se borran sus registros y fotos; las copias en los respaldos de nuestros proveedores pueden durar un poco más. Para borrar tu cuenta, escríbenos. Los datos de la app de escritorio quedan en tu PC hasta que los borres.",
      ],
      [
        "You can see, correct and export your records at any time (Settings has CSV and JSON export).",
        "Puedes ver, corregir y exportar tus registros cuando quieras (Ajustes tiene exportación a CSV y JSON).",
      ],
    ],
  },
  {
    h: ["Your clients' information", "La información de tus clientes"],
    p: [
      [
        "When you record your clients' details you decide what to keep. Keep only what you need, have their permission when required, and tell them how to reach you about it.",
        "Cuando registras datos de tus clientes, tú decides qué guardar. Guarda solo lo necesario, ten su permiso cuando se requiera y diles cómo contactarte al respecto.",
      ],
    ],
  },
  {
    h: ["Age", "Edad"],
    p: [["Acervus is for adults (18 or older).", "Acervus es para adultos (18 años o más)."]],
  },
  {
    h: ["Changes", "Cambios"],
    p: [
      [
        "We may update this policy. The date at the top shows the latest version, and we'll tell you in the app about important changes.",
        "Podemos actualizar esta política. La fecha de arriba muestra la última versión y te avisaremos en la app de los cambios importantes.",
      ],
    ],
  },
];

export function LegalScreen({ page }: { page: "terms" | "privacy" }) {
  const t = useT();
  const { lang, setLang } = useLang();
  const es = lang === "es" ? 1 : 0;
  const sections = page === "terms" ? TERMS : PRIVACY;
  const title = page === "terms" ? t("Terms of Service", "Términos de servicio") : t("Privacy Policy", "Política de privacidad");
  return (
    <div className="legal">
      <header className="legal-top">
        <Link to="/" className="auth-brand">
          <img src="/pwa-192x192.png" alt="" />
          Acervus Finance
        </Link>
        <Button variant="ghost" size="small" onClick={() => setLang(lang === "es" ? "en" : "es")}>
          {lang === "es" ? "English" : "Español"}
        </Button>
      </header>
      <article className="legal-body">
        <h1>{title}</h1>
        <p className="muted small">
          {t("Last updated", "Última actualización")}: {UPDATED[es]} · VZ Labs
        </p>
        {sections.map((s) => (
          <section key={s.h[0]}>
            <h2>{s.h[es]}</h2>
            {s.p.map((p) => (
              <p key={p[0].slice(0, 32)}>{p[es]}</p>
            ))}
          </section>
        ))}
        <section>
          <h2>{t("Contact", "Contacto")}</h2>
          <p>
            {t("Questions, requests or account deletion:", "Preguntas, solicitudes o borrar tu cuenta:")}{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
        </section>
        <p className="legal-links small">
          {page === "terms" ? <Link to="/privacy">{t("Privacy Policy", "Política de privacidad")}</Link> : <Link to="/terms">{t("Terms of Service", "Términos de servicio")}</Link>}
          {" · "}
          <Link to="/">{t("Back to the app", "Volver a la app")}</Link>
        </p>
      </article>
    </div>
  );
}

/** "Terms · Privacy" for the foot of the sign-in pages and the About card. */
export function LegalLinks() {
  const t = useT();
  return (
    <span className="legal-links">
      <Link to="/terms">{t("Terms of Service", "Términos de servicio")}</Link>
      {" · "}
      <Link to="/privacy">{t("Privacy Policy", "Política de privacidad")}</Link>
    </span>
  );
}
