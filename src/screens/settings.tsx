// Settings: this device (language, theme, business, sign-out), the business
// (admins: name, time zone, receipts, formats, defaults, logo, wording),
// people (members and invitations) and data export.

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DATE_STYLES, formatDay, type DateStyle } from "../../shared/domain/dates";
import { FREQUENCIES, type Frequency } from "../../shared/domain/loans";
import { NUMBER_STYLES, numberStyleLabel, type NumberStyle } from "../../shared/domain/money";
import { describeError } from "../lib/errors";
import { exportCsv, exportJson } from "../lib/export";
import { useLang, useT } from "../lib/i18n";
import { CURRENCIES, frequencyLabel, roleLabel } from "../lib/labels";
import { defaultRules, tagList, whenHint, withRules, withText, Wording, wordingProblem, type RuleLine, type RuleSet, type When } from "../receipts/wording";
import { useBooks } from "../state/app";
import { Banner, Button, Card, Check, Confirm, Field, Pill, Row, Segmented, Sheet, useToast } from "../ui/kit";
import { NewBusinessForm, PendingInvites } from "./auth";
import { LegalLinks, SUPPORT_EMAIL } from "./legal";
import { RateInput, useParseError, useRate } from "../ui/inputs";

export function SettingsScreen() {
  const t = useT();
  const app = useBooks();
  const { can, mode } = app;
  const admin = can("manage");
  return (
    <div>
      <div className="topbar">
        <h1>{t("Settings", "Ajustes")}</h1>
      </div>
      <DeviceCard />
      <BusinessesCard />
      {admin && mode === "online" && (
        <>
          <BusinessCard />
          <ReceiptCard />
          <WordingCard />
          <PeopleCard />
        </>
      )}
      {admin && mode !== "online" && <Banner tone="offline" icon="cloudOff">{t("Business settings need a connection.", "Los ajustes del negocio necesitan conexión.")}</Banner>}
      <DataCard />
      <AboutCard />
    </div>
  );
}

/** Who makes the app, the version, how to reach us and the legal pages. */
function AboutCard() {
  const t = useT();
  const toast = useToast();
  // Copies the address: a mail link could land on a webmail sign-in.
  const copy = () =>
    navigator.clipboard.writeText(SUPPORT_EMAIL).then(
      () => toast(t("Email address copied", "Correo copiado")),
      () => toast(SUPPORT_EMAIL),
    );
  return (
    <Card title={t("About", "Acerca de")} className="section">
      <div className="card-body stack tight">
        <div className="row wrap">
          <span className="strong">{t("Acervus Finance, by VZ Labs", "Acervus Finance, por VZ Labs")}</span>
          <span className="muted small">
            {t("Version", "Versión")} {__APP_VERSION__}
          </span>
        </div>
        <div className="row wrap small muted">
          <span>
            {t("Questions or help:", "Preguntas o ayuda:")} <span className="strong" style={{ color: "var(--ink)", userSelect: "all" }}>{SUPPORT_EMAIL}</span>
          </span>
          <Button size="small" variant="ghost" icon="mail" onClick={copy}>
            {t("Copy email", "Copiar correo")}
          </Button>
        </div>
        <div className="small">
          <LegalLinks />
        </div>
      </div>
    </Card>
  );
}

function DeviceCard() {
  const t = useT();
  const { lang, setLang } = useLang();
  const app = useBooks();
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => (localStorage.getItem("acervus.theme") as "light" | "dark") ?? "system");
  const [confirmOut, setConfirmOut] = useState(false);
  const unsynced = app.ops.filter((o) => o.status !== "synced").length;
  return (
    <Card title={t("This device", "Este dispositivo")}>
      <div className="card-body form-grid two">
        <Field label={t("Language", "Idioma")}>{() => <Segmented label={t("Language", "Idioma")} value={lang} onChange={setLang} options={[["es", "Español"], ["en", "English"]]} />}</Field>
        <Field label={t("Theme", "Tema")}>
          {() => (
            <Segmented
              label={t("Theme", "Tema")}
              value={theme}
              onChange={(v) => {
                setTheme(v);
                if (v === "system") {
                  localStorage.removeItem("acervus.theme");
                  delete document.documentElement.dataset.theme;
                } else {
                  localStorage.setItem("acervus.theme", v);
                  document.documentElement.dataset.theme = v;
                }
              }}
              options={[
                ["system", t("Auto", "Auto")],
                ["light", t("Light", "Claro")],
                ["dark", t("Dark", "Oscuro")],
              ]}
            />
          )}
        </Field>
        <div className="span2 row between wrap">
          <span className="small muted">
            {app.user?.email} · {app.role ? roleLabel(t, app.role) : ""}
          </span>
          <Button icon="logout" onClick={() => (unsynced ? setConfirmOut(true) : void app.signOut())}>
            {t("Sign out", "Cerrar sesión")}
          </Button>
        </div>
      </div>
      {confirmOut && (
        <Confirm title={t("Sign out with unsynced changes?", "¿Cerrar sesión con cambios sin sincronizar?")} confirmLabel={t("Sign out", "Cerrar sesión")} onClose={() => setConfirmOut(false)} onConfirm={() => app.signOut()}>
          {t(
            `${unsynced} change(s) made on this device haven't reached the server. They stay on this device and sync the next time you sign in here; the offline copy of the business is removed.`,
            `${unsynced} cambio(s) hechos en este dispositivo no han llegado al servidor. Se quedan aquí y se sincronizan la próxima vez que inicies sesión en este dispositivo; la copia sin conexión del negocio se borra.`,
          )}
        </Confirm>
      )}
    </Card>
  );
}

/** Every business the person belongs to: open one, start a new one, and
 *  (admins) delete one for everyone. */
function BusinessesCard() {
  const t = useT();
  const app = useBooks();
  const online = app.mode === "online";
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<{ businessId: Id<"businesses">; name: string } | null>(null);
  return (
    <Card
      title={t("Businesses", "Negocios")}
      className="section"
      action={
        online && (
          <Button icon="plus" onClick={() => setCreating(true)}>
            {t("New business", "Nuevo negocio")}
          </Button>
        )
      }
    >
      {online && <PendingInvites className="card-body" />}
      <ul className="list">
        {(app.businesses ?? []).map((b) => {
          const open = b.businessId === app.businessId;
          return (
            <Row
              key={b.businessId}
              title={b.name}
              sub={roleLabel(t, b.role)}
              trail={
                <div className="row">
                  {open ? (
                    <Pill tone="accent">{t("Open", "Abierto")}</Pill>
                  ) : (
                    <Button onClick={() => app.setBusinessId(b.businessId as Id<"businesses">)}>{t("Open", "Abrir")}</Button>
                  )}
                  {b.role === "admin" && online && (
                    <Button variant="ghost" icon="trash" aria-label={t("Delete business", "Eliminar negocio")} onClick={() => setDeleting({ businessId: b.businessId as Id<"businesses">, name: b.name })} />
                  )}
                </div>
              }
            />
          );
        })}
      </ul>
      {creating && (
        <Sheet title={t("New business", "Nuevo negocio")} onClose={() => setCreating(false)}>
          <NewBusinessForm onCreated={() => setCreating(false)} />
        </Sheet>
      )}
      {deleting && <DeleteBusiness {...deleting} onClose={() => setDeleting(null)} />}
    </Card>
  );
}

/** Deleting a business for everyone, once its name is typed. */
function DeleteBusiness({ businessId, name, onClose }: { businessId: Id<"businesses">; name: string; onClose: () => void }) {
  const t = useT();
  const app = useBooks();
  const toast = useToast();
  const remove = useMutation(api.businesses.remove);
  const [typed, setTyped] = useState("");
  return (
    <Confirm
      title={t("Delete this business?", "¿Eliminar este negocio?")}
      confirmLabel={t("Delete for everyone", "Eliminar para todos")}
      danger
      onClose={onClose}
      onConfirm={async () => {
        if (typed.trim() !== name) throw new Error(t("Type the name exactly as shown.", "Escribe el nombre tal como aparece."));
        try {
          await remove({ businessId, name: typed });
        } catch (e) {
          throw new Error(describeError(t, app.fmt, e));
        }
        toast(t("Business deleted", "Negocio eliminado"));
      }}
    >
      <div className="stack">
        <p>
          {t(
            `All of ${name}'s clients, loans, payments, money records, photos and members are deleted for everyone, on every device. This can't be undone.`,
            `Se eliminan para todos y en todos los dispositivos los clientes, préstamos, pagos, movimientos de dinero, fotos y miembros de ${name}. No se puede deshacer.`,
          )}
        </p>
        <Field label={t(`Type “${name}” to confirm`, `Escribe “${name}” para confirmar`)}>
          {(id) => <input id={id} className="input" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />}
        </Field>
      </div>
    </Confirm>
  );
}

function BusinessCard() {
  const t = useT();
  const { snapshot, businessId, fmt } = useBooks();
  const toast = useToast();
  const update = useMutation(api.businesses.update);
  const [name, setName] = useState(snapshot.business.name);
  const [tz, setTz] = useState(snapshot.business.timezone);
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [tz];
  return (
    <Card title={t("Business", "Negocio")} className="section">
      <div className="card-body form-grid two">
        <Field label={t("Name", "Nombre")}>{(id) => <input id={id} className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t("Time zone", "Zona horaria")} hint={t("“Today” for due dates and late fees.", "El “hoy” de vencimientos y mora.")}>
          {(id) => (
            <select id={id} className="input" value={tz} onChange={(e) => setTz(e.target.value)}>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          )}
        </Field>
        <div className="span2 actions end">
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await update({ businessId, name, timezone: tz });
                toast(t("Saved.", "Guardado."));
              } catch (e) {
                toast(describeError(t, fmt, e), true);
              }
            }}
          >
            {t("Save", "Guardar")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

type SettingsDoc = NonNullable<ReturnType<typeof useBooks>["snapshot"]["settings"]>;

function settingsArgs(s: SettingsDoc) {
  const { _id, _creationTime, businessId, logoId, logoUrl, updatedAt, version, ...rest } = s as SettingsDoc & { logoUrl: unknown };
  void _id; void _creationTime; void businessId; void logoId; void logoUrl; void updatedAt;
  return { ...rest, expectedVersion: version };
}

function useSaveSettings() {
  const t = useT();
  const { snapshot, businessId, fmt } = useBooks();
  const toast = useToast();
  const update = useMutation(api.settings.update);
  return async (changes: Partial<ReturnType<typeof settingsArgs>>) => {
    try {
      await update({ businessId, ...settingsArgs(snapshot.settings!), ...changes });
      toast(t("Saved.", "Guardado."));
      return true;
    } catch (e) {
      toast(describeError(t, fmt, e), true);
      return false;
    }
  };
}

function ReceiptCard() {
  const t = useT();
  const { snapshot, businessId, fmt, today } = useBooks();
  const save = useSaveSettings();
  const toast = useToast();
  const s = snapshot.settings!;
  const [f, setF] = useState(() => ({ ...s }));
  const [rate, setRate] = useRate(s.defaultRate);
  const [late, setLate] = useRate(s.lateFeeRate);
  const showErr = useParseError();
  const logoUpload = useMutation(api.settings.logoUploadUrl);
  const setLogo = useMutation(api.settings.setLogo);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  return (
    <Card title={t("Receipts, money and defaults", "Recibos, dinero y valores por defecto")} className="section">
      <div className="card-body form-grid two">
        <Field label={t("Name on receipts", "Nombre en los recibos")} hint={t("Empty: the business name.", "Vacío: el nombre del negocio.")}>{(id) => <input id={id} className="input" maxLength={60} value={f.receiptName} onChange={(e) => set("receiptName", e.target.value)} />}</Field>
        <Field label={t("Phone", "Teléfono")}>{(id) => <input id={id} className="input" maxLength={40} value={f.companyPhone} onChange={(e) => set("companyPhone", e.target.value)} />}</Field>
        <div className="span2">
          <Field label={t("Address", "Dirección")}>{(id) => <input id={id} className="input" maxLength={200} value={f.companyAddress} onChange={(e) => set("companyAddress", e.target.value)} />}</Field>
        </div>
        <div>
          <div className="small strong">{t("Company details on receipts", "Datos de la empresa en los recibos")}</div>
          <Check checked={f.receiptCompany.name} onChange={(v) => set("receiptCompany", { ...f.receiptCompany, name: v })}>{t("Name", "Nombre")}</Check>
          <Check checked={f.receiptCompany.address} onChange={(v) => set("receiptCompany", { ...f.receiptCompany, address: v })}>{t("Address", "Dirección")}</Check>
          <Check checked={f.receiptCompany.phone} onChange={(v) => set("receiptCompany", { ...f.receiptCompany, phone: v })}>{t("Phone", "Teléfono")}</Check>
        </div>
        <div>
          <div className="small strong">{t("Client details on receipts", "Datos del cliente en los recibos")}</div>
          <Check checked={f.receiptClient.name} onChange={(v) => set("receiptClient", { ...f.receiptClient, name: v })}>{t("Name", "Nombre")}</Check>
          <Check checked={f.receiptClient.idNumber} onChange={(v) => set("receiptClient", { ...f.receiptClient, idNumber: v })}>{t("ID number", "Identificación")}</Check>
          <Check checked={f.receiptClient.phone} onChange={(v) => set("receiptClient", { ...f.receiptClient, phone: v })}>{t("Phone", "Teléfono")}</Check>
          <Check checked={f.receiptClient.address} onChange={(v) => set("receiptClient", { ...f.receiptClient, address: v })}>{t("Address", "Dirección")}</Check>
          <p className="micro muted">{t("Client photos are never printed.", "Las fotos de clientes nunca se imprimen.")}</p>
        </div>
        <Check checked={f.receiptAfterPayment} onChange={(v) => set("receiptAfterPayment", v)}>{t("Show the receipt after recording a payment", "Mostrar el recibo al registrar un pago")}</Check>
        <Check checked={f.receiptAfterLoan} onChange={(v) => set("receiptAfterLoan", v)}>{t("Show the receipt after creating a loan", "Mostrar el recibo al crear un préstamo")}</Check>
        <Field label={t("Currency", "Moneda")} hint={t("Only the symbol changes; amounts are never converted.", "Solo cambia el símbolo; los montos no se convierten.")}>
          {(id) => (
            <select id={id} className="input" value={f.currencyCode} onChange={(e) => set("currencyCode", e.target.value)}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.symbol} · {t(c.en, c.es)}</option>)}
            </select>
          )}
        </Field>
        <Field label={t("Numbers", "Números")}>
          {(id) => (
            <select id={id} className="input" value={f.numberStyle} onChange={(e) => set("numberStyle", e.target.value as NumberStyle)}>
              {NUMBER_STYLES.map((n) => <option key={n} value={n}>{numberStyleLabel(n)}</option>)}
            </select>
          )}
        </Field>
        <Field label={t("Dates", "Fechas")}>
          {(id) => (
            <select id={id} className="input" value={f.dateStyle} onChange={(e) => set("dateStyle", e.target.value as DateStyle)}>
              {DATE_STYLES.map((d) => <option key={d} value={d}>{formatDay(today, d, fmt.lang)}</option>)}
            </select>
          )}
        </Field>
        <Field label={t("Business language (receipts default)", "Idioma del negocio")}>
          {() => <Segmented label={t("Language", "Idioma")} value={f.language} onChange={(v) => set("language", v)} options={[["es", "Español"], ["en", "English"]]} />}
        </Field>
        <Field label={t("Default rate", "Tasa por defecto")} error={showErr(rate, false)}>{(id) => <RateInput id={id} value={rate.text} onChange={setRate} />}</Field>
        <Field label={t("Default frequency", "Frecuencia por defecto")}>
          {(id) => (
            <select id={id} className="input" value={f.defaultFrequency} onChange={(e) => set("defaultFrequency", e.target.value as Frequency)}>
              {FREQUENCIES.map((x) => <option key={x} value={x}>{frequencyLabel(t, x)}</option>)}
            </select>
          )}
        </Field>
        <Field label={t("Default late fee", "Mora por defecto")} error={showErr(late, false)}>{(id) => <RateInput id={id} value={late.text} onChange={setLate} />}</Field>
        <Field label={t("Logo", "Logo")}>
          {() => (
            <div className="row wrap">
              {s.logoUrl && <img src={s.logoUrl} alt="" style={{ maxHeight: 44, maxWidth: 120, borderRadius: 6 }} />}
              <label className="btn small">
                {s.logoUrl ? t("Replace", "Reemplazar") : t("Upload", "Subir")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const res = await fetch(await logoUpload({ businessId }), { method: "POST", headers: { "Content-Type": file.type }, body: file });
                      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
                      await setLogo({ businessId, storageId });
                      toast(t("Logo saved.", "Logo guardado."));
                    } catch (err) {
                      toast(describeError(t, fmt, err), true);
                    }
                  }}
                />
              </label>
              {s.logoUrl && <Button size="small" variant="danger-ghost" onClick={() => void setLogo({ businessId, storageId: null })}>{t("Remove", "Quitar")}</Button>}
            </div>
          )}
        </Field>
        <div className="span2 actions end">
          <Button
            variant="primary"
            disabled={rate.value === null || late.value === null}
            onClick={() =>
              void save({
                receiptName: f.receiptName, companyAddress: f.companyAddress, companyPhone: f.companyPhone, receiptCompany: f.receiptCompany,
                receiptClient: f.receiptClient, currencyCode: f.currencyCode, numberStyle: f.numberStyle, dateStyle: f.dateStyle, language: f.language,
                defaultRate: rate.value!, defaultFrequency: f.defaultFrequency, lateFeeRate: late.value!, receiptAfterPayment: f.receiptAfterPayment, receiptAfterLoan: f.receiptAfterLoan,
              })
            }
          >
            {t("Save", "Guardar")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function WordingCard() {
  const t = useT();
  const { snapshot } = useBooks();
  const save = useSaveSettings();
  const [map, setMap] = useState<Record<string, string>>(() => ({ ...snapshot.settings!.receiptText }));
  const [set, setSet] = useState<RuleSet>("declining");
  const w = new Wording(map, t);
  const problem = wordingProblem(t, map);
  const lines = w.rules(set);
  const setLines = (next: RuleLine[] | null) => setMap(withRules(map, set, next));
  const textField = (key: "heading" | "clientSign" | "lenderSign" | "paymentFooter" | "loanFooter", label: string, max: number) => (
    <Field label={label} hint={w.custom(key) === null ? t("Built-in text", "Texto predeterminado") : undefined}>
      {(id) => (
        <div className="row">
          <input id={id} className="input grow" maxLength={max + 50} value={w.custom(key) ?? (key === "heading" ? w.heading() : key === "clientSign" ? w.clientSign() : key === "lenderSign" ? w.lenderSign() : key === "paymentFooter" ? w.paymentFooter() : w.loanFooter())} onChange={(e) => setMap(withText(map, key, e.target.value))} />
          {w.custom(key) !== null && <Button size="small" variant="ghost" onClick={() => setMap(withText(map, key, null))}>{t("Reset", "Restablecer")}</Button>}
        </div>
      )}
    </Field>
  );
  return (
    <Card title={t("Receipt wording", "Texto de los recibos")} className="section">
      <div className="card-body stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t("Tags are filled in with each loan's figures:", "Las etiquetas se llenan con los datos de cada préstamo:")} {tagList(t).map(([k, v]) => `${k} ${v}`).join(" · ")}
        </p>
        <div className="form-grid two">
          {textField("heading", t("Heading of “How payments work”", "Título de “Cómo funcionan los pagos”"), 80)}
          {textField("paymentFooter", t("Closing line of payment receipts", "Línea final del recibo de pago"), 300)}
          {textField("clientSign", t("Under the client's signature", "Bajo la firma del cliente"), 80)}
          {textField("lenderSign", t("Under the lender's signature", "Bajo la firma del prestamista"), 80)}
          {textField("loanFooter", t("Closing line of loan receipts", "Línea final del recibo de préstamo"), 300)}
        </div>
        <Segmented label={t("Loan type", "Tipo de préstamo")} value={set} onChange={setSet} options={[["declining", t("Declining", "Decreciente")], ["flat", t("Flat", "Fijo")], ["interest_only", t("Interest only", "Solo interés")]]} />
        {lines.map((l, i) => (
          <div key={i} className="stack tight">
            <textarea className="input" style={{ minHeight: 64 }} maxLength={550} value={l.text} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            <div className="row between">
              <select className="input" style={{ maxWidth: 280, minHeight: 36 }} value={l.when} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, when: e.target.value as When } : x)))}>
                {(["always", "converted", "late_fee", "edited"] as When[]).map((wh) => <option key={wh} value={wh}>{whenHint(t, wh) ?? t("Always", "Siempre")}</option>)}
              </select>
              <Button size="small" variant="danger-ghost" icon="trash" aria-label={t("Remove line", "Quitar línea")} onClick={() => setLines(lines.filter((_, j) => j !== i))} />
            </div>
          </div>
        ))}
        <div className="actions">
          <Button size="small" icon="plus" onClick={() => setLines([...lines, { when: "always", text: "" }])}>{t("Add line", "Agregar línea")}</Button>
          {w.customRules(set) && <Button size="small" variant="ghost" onClick={() => setLines(null)}>{t("Back to built-in lines", "Volver al texto predeterminado")}</Button>}
          {!w.customRules(set) && <span className="micro muted">{t(`${defaultRules(t, set).length} built-in lines`, `${defaultRules(t, set).length} líneas predeterminadas`)}</span>}
        </div>
        {problem && <div className="banner warn">{problem}</div>}
        <div className="actions end">
          <Button variant="primary" disabled={!!problem} onClick={() => void save({ receiptText: map })}>{t("Save wording", "Guardar texto")}</Button>
        </div>
      </div>
    </Card>
  );
}

function PeopleCard() {
  const t = useT();
  const { businessId, fmt, user } = useBooks();
  const toast = useToast();
  const members = useQuery(api.businesses.members, { businessId });
  const invites = useQuery(api.invites.list, { businessId });
  const invite = useAction(api.invites.create);
  const revoke = useMutation(api.invites.revoke);
  const setRole = useMutation(api.businesses.setRole);
  const removeMember = useMutation(api.businesses.removeMember);
  const [email, setEmail] = useState("");
  const [role, setRoleNew] = useState<"admin" | "collector" | "viewer">("collector");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; emailed: boolean } | null>(null);
  const [removing, setRemoving] = useState<Id<"members"> | null>(null);
  const roles: ["admin" | "collector" | "viewer", string][] = [["admin", roleLabel(t, "admin")], ["collector", roleLabel(t, "collector")], ["viewer", roleLabel(t, "viewer")]];
  return (
    <Card title={t("People", "Personas")} className="section">
      <ul className="list">
        {(members ?? []).filter((m) => m.active).map((m) => (
          <li key={m._id}>
            <div className="list-row" style={{ flexWrap: "wrap" }}>
              <div className="grow">
                <div className="title">{m.name}{m.userId === user?.id ? ` · ${t("you", "tú")}` : ""}</div>
                <div className="sub">{m.email}</div>
              </div>
              <select
                className="input"
                style={{ width: 160, minHeight: 38 }}
                value={m.role}
                aria-label={t("Role", "Rol")}
                onChange={async (e) => {
                  try {
                    await setRole({ businessId, memberId: m._id, role: e.target.value as typeof role });
                  } catch (err) {
                    toast(describeError(t, fmt, err), true);
                  }
                }}
              >
                {roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <Button size="small" variant="danger-ghost" icon="trash" aria-label={t("Remove", "Quitar")} onClick={() => setRemoving(m._id)} />
            </div>
          </li>
        ))}
      </ul>
      <div className="card-body stack">
        <div className="small muted">
          {t(
            "Admin: everything. Collector: clients, payments, expenses, income and receipts. Viewer: read only.",
            "Administrador: todo. Cobrador: clientes, pagos, gastos, ingresos y recibos. Solo lectura: ver.",
          )}
        </div>
        <div className="form-grid two">
          <Field label={t("Invite by email", "Invitar por correo")}>{(id) => <input id={id} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label={t("Role", "Rol")}>{() => <Segmented label={t("Role", "Rol")} value={role} onChange={setRoleNew} options={roles} />}</Field>
        </div>
        <div className="actions end">
          <Button
            variant="primary"
            icon="mail"
            loading={busy}
            disabled={!email.includes("@")}
            onClick={async () => {
              setBusy(true);
              try {
                setLink(await invite({ businessId, email, role }));
                setEmail("");
              } catch (e) {
                toast(describeError(t, fmt, e), true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Send invitation", "Enviar invitación")}
          </Button>
        </div>
        {link && (
          <Banner tone="info" icon="mail" action={<Button size="small" onClick={() => void navigator.clipboard?.writeText(link.url).then(() => toast(t("Link copied.", "Enlace copiado.")))}>{t("Copy link", "Copiar enlace")}</Button>}>
            {link.emailed ? t("Invitation emailed. You can also share this link (valid 7 days, works once):", "Invitación enviada. También puedes compartir este enlace (7 días, un solo uso):") : t("Email isn't set up, so share this link yourself (valid 7 days, works once):", "El correo no está configurado; comparte tú este enlace (7 días, un solo uso):")}
            <div className="micro" style={{ overflowWrap: "anywhere" }}>{link.url}</div>
          </Banner>
        )}
        {(invites ?? []).length > 0 && (
          <ul className="list">
            {invites!.map((i) => (
              <li key={i._id}>
                <div className="list-row">
                  <div className="grow">
                    <div className="title">{i.email}</div>
                    <div className="sub">{roleLabel(t, i.role)} · {t("until", "hasta")} {new Date(i.expiresAt).toLocaleDateString(fmt.lang)}</div>
                  </div>
                  <Pill>{t("Invited", "Invitado")}</Pill>
                  <Button size="small" variant="ghost" onClick={() => void revoke({ businessId, inviteId: i._id })}>{t("Revoke", "Revocar")}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {removing && (
        <Confirm title={t("Remove this person?", "¿Quitar a esta persona?")} danger needsReason confirmLabel={t("Remove", "Quitar")} onClose={() => setRemoving(null)} onConfirm={async (reason) => {
          try {
            await removeMember({ businessId, memberId: removing, reason });
          } catch (e) {
            throw new Error(describeError(t, fmt, e));
          }
        }}>
          {t("They lose access to this business at once. Their past changes stay in the history.", "Pierde el acceso al negocio de inmediato. Sus cambios anteriores siguen en el historial.")}
        </Confirm>
      )}
    </Card>
  );
}

function DataCard() {
  const t = useT();
  const { snapshot, books, today, can } = useBooks();
  if (!can("manage")) return null;
  return (
    <Card title={t("Data", "Datos")} className="section">
      <div className="card-body stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t("Download your records as spreadsheets (CSV) or as one JSON file. ID photos are never included. The data itself is kept in the cloud (Convex) with its own backups.", "Descarga tus registros como hojas de cálculo (CSV) o en un archivo JSON. Las fotos de identificación nunca se incluyen. Los datos se guardan en la nube (Convex) con sus propias copias de seguridad.")}
        </p>
        <div className="actions">
          <Button icon="download" onClick={() => exportCsv(snapshot, books)}>{t("Export CSV", "Exportar CSV")}</Button>
          <Button icon="download" onClick={() => exportJson(snapshot, today)}>{t("Export JSON", "Exportar JSON")}</Button>
        </div>
      </div>
    </Card>
  );
}
