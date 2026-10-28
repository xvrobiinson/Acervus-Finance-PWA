// Clients: searchable list, profile with loans and totals, the form, and the
// ID photo (admins only, fetched on request, never kept on the device).

import { useMutation } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useForms } from "../App";
import { authClient } from "../lib/auth-client";
import { CONVEX_SITE_URL } from "../lib/env";
import { describeError, describeErrorData } from "../lib/errors";
import { useT } from "../lib/i18n";
import { displayStatusLabel, methodShort } from "../lib/labels";
import { useBooks } from "../state/app";
import { Avatar, Banner, Button, Card, Confirm, Empty, Field, Pill, Row, Segmented, Sheet, useToast } from "../ui/kit";
import { Icon } from "../ui/icons";
import { statusTone } from "./loans";

export function ClientsScreen() {
  const t = useT();
  const { books, fmt, can, ops } = useBooks();
  const open = useForms();
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"active" | "archived">("active");
  const pending = ops.filter((o) => o.kind === "client.create" && o.status !== "synced");
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return books.clients
      .filter((c) => (show === "archived") === Boolean(c.client.archivedAt))
      .filter(
        (c) =>
          !needle ||
          c.client.fullName.toLowerCase().includes(needle) ||
          c.client.phone.includes(needle) ||
          c.client.idNumber.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.client.fullName.localeCompare(b.client.fullName));
  }, [books.clients, q, show]);
  return (
    <div>
      <div className="topbar">
        <h1>{t("Clients", "Clientes")}</h1>
        {can("record") && (
          <Button variant="primary" size="small" icon="plus" onClick={() => open({ kind: "client" })}>
            {t("Client", "Cliente")}
          </Button>
        )}
      </div>
      <div className="stack" style={{ marginBottom: 12 }}>
        <div className="search">
          <Icon name="search" />
          <input className="input" type="search" placeholder={t("Name, phone or ID", "Nombre, teléfono o cédula")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Search clients", "Buscar clientes")} />
        </div>
        <Segmented
          label={t("Show", "Mostrar")}
          value={show}
          onChange={setShow}
          options={[
            ["active", t("Active", "Activos")],
            ["archived", t("Archived", "Archivados")],
          ]}
        />
      </div>
      <Card>
        <ul className="list">
          {pending.map((o) => (
            <Row key={o.opId} to="/sync" lead={<Avatar name={o.summary.title} />} title={o.summary.title} sub={t("Saved on this device · not synced yet", "Guardado en este dispositivo · sin sincronizar")} trail={<Pill tone="warn">{o.status === "needs_review" ? t("Review", "Revisar") : t("Pending", "Pendiente")}</Pill>} />
          ))}
          {list.map((c) => (
            <Row
              key={c.client._id}
              to={`/clients/${c.client._id}`}
              lead={<Avatar name={c.client.fullName} />}
              title={c.client.fullName}
              sub={[c.client.phone, t(`${c.loans.length} loans`, `${c.loans.length} préstamos`)].filter(Boolean).join(" · ")}
              trail={
                <>
                  <span className="amount num">{fmt.money(c.outstanding)}</span>
                  {c.worst && c.worst !== "active" && <Pill tone={statusTone(c.worst)}>{displayStatusLabel(t, c.worst)}</Pill>}
                </>
              }
            />
          ))}
        </ul>
        {list.length === 0 && pending.length === 0 && <Empty icon="users">{q ? t("No client matches.", "Ningún cliente coincide.") : t("No clients yet.", "Aún no hay clientes.")}</Empty>}
      </Card>
    </div>
  );
}

export function ClientDetail() {
  const t = useT();
  const { id } = useParams();
  const app = useBooks();
  const { books, fmt, can, businessId, mode } = app;
  const navigate = useNavigate();
  const open = useForms();
  const toast = useToast();
  const setArchived = useMutation(api.clients.setArchived);
  const remove = useMutation(api.clients.remove);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const view = books.clientById.get(id ?? "");
  if (!view) return <Empty icon="users">{t("This client no longer exists.", "Este cliente ya no existe.")}</Empty>;
  const c = view.client;
  const online = mode === "online";
  return (
    <div>
      <div className="topbar">
        <Button variant="ghost" icon="back" className="back" aria-label={t("Back", "Atrás")} onClick={() => navigate(-1)} />
        <h1 className="ellipsis">{c.fullName}</h1>
        {can("manage") && online && <Button size="small" icon="edit" onClick={() => open({ kind: "client", clientId: c._id })}>{t("Edit", "Editar")}</Button>}
      </div>
      {c.archivedAt && <Banner tone="offline" icon="alert">{t("Archived client.", "Cliente archivado.")}</Banner>}
      <div className="grid2">
        <div>
          <Card>
            <div className="stats">
              <div className="stat lead" style={{ gridColumn: "1 / -1" }}>
                <div className="label">{t("Capital owed", "Capital adeudado")}</div>
                <div className="value">{fmt.money(view.outstanding)}</div>
              </div>
              <div className="stat">
                <div className="label">{t("Overdue", "Atrasado")}</div>
                <div className={`value ${view.overdue > 0 ? "neg" : ""}`}>{fmt.money(view.overdue)}</div>
              </div>
              <div className="stat">
                <div className="label">{t("Paid to date", "Pagado a la fecha")}</div>
                <div className="value">{fmt.money(view.paidTotal)}</div>
              </div>
            </div>
          </Card>
          <Card
            title={t("Loans", "Préstamos")}
            className="section"
            action={can("manage") && online && !c.archivedAt ? <Button size="small" icon="plus" onClick={() => open({ kind: "loan", clientId: c._id })}>{t("Loan", "Préstamo")}</Button> : null}
          >
            <ul className="list">
              {view.loans.map((l) => (
                <Row
                  key={l.loan._id}
                  to={`/loans/${l.loan._id}`}
                  title={`#${l.loan.recordNo} · ${fmt.money(l.loan.principal)}`}
                  sub={`${methodShort(t, l.loan.method)} · ${fmt.day(l.loan.startDate)}`}
                  trail={
                    <>
                      <span className="amount num">{fmt.money(l.payoff)}</span>
                      <Pill tone={statusTone(l.display)}>{displayStatusLabel(t, l.display)}</Pill>
                    </>
                  }
                />
              ))}
            </ul>
            {view.loans.length === 0 && <Empty icon="loans">{t("No loans yet.", "Aún no tiene préstamos.")}</Empty>}
          </Card>
        </div>
        <div>
          <Card title={t("Details", "Datos")}>
            <dl className="kv card-body" style={{ gridTemplateColumns: "auto 1fr" }}>
              {(
                [
                  [t("Phone", "Teléfono"), c.phone],
                  [t("Email", "Correo"), c.email],
                  [t("ID number", "Identificación"), c.idNumber],
                  [t("Address", "Dirección"), c.address],
                ] as [string, string][]
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt>{k}</dt>
                    <dd style={{ textAlign: "left", overflowWrap: "anywhere" }}>{k === t("Phone", "Teléfono") ? <a href={`tel:${v}`}>{v}</a> : v}</dd>
                  </div>
                ))}
            </dl>
            {c.notes && <p className="card-body small" style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{c.notes}</p>}
          </Card>
          {can("manage") && <PhotoCard clientId={c._id} hasPhoto={c.hasPhoto} online={online} businessId={businessId} />}
          {can("manage") && online && (
            <div className="actions section" style={{ marginTop: 16 }}>
              <Button
                onClick={async () => {
                  try {
                    await setArchived({ businessId, clientId: c._id, archived: !c.archivedAt });
                  } catch (e) {
                    toast(describeError(t, fmt, e), true);
                  }
                }}
              >
                {c.archivedAt ? t("Restore", "Restaurar") : t("Archive", "Archivar")}
              </Button>
              <Button variant="danger-ghost" icon="trash" onClick={() => setConfirmDelete(true)}>
                {t("Delete", "Eliminar")}
              </Button>
            </div>
          )}
        </div>
      </div>
      {confirmDelete && (
        <Confirm
          title={t("Delete client", "Eliminar cliente")}
          danger
          needsReason
          confirmLabel={t("Delete", "Eliminar")}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async (reason) => {
            try {
              await remove({ businessId, clientId: c._id, reason });
              navigate("/clients", { replace: true });
            } catch (e) {
              throw new Error(describeError(t, fmt, e));
            }
          }}
        >
          {t("Only clients without loans can be deleted. The deletion is kept in the history.", "Solo se pueden eliminar clientes sin préstamos. La eliminación queda en el historial.")}
        </Confirm>
      )}
    </div>
  );
}

/** Shrinks a photo to at most 1600px as JPEG before upload. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("image"))), "image/jpeg", 0.85));
}

async function convexToken(): Promise<string | null> {
  const r = (await (authClient as unknown as { convex: { token: () => Promise<{ data?: { token?: string } }> } }).convex.token()) ?? {};
  return r.data?.token ?? null;
}

function PhotoCard({ clientId, hasPhoto, online, businessId }: { clientId: Id<"clients">; hasPhoto: boolean; online: boolean; businessId: Id<"businesses"> }) {
  const t = useT();
  const { fmt } = useBooks();
  const toast = useToast();
  const uploadUrl = useMutation(api.clients.photoUploadUrl);
  const setPhoto = useMutation(api.clients.setPhoto);
  const removePhoto = useMutation(api.clients.removePhoto);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  const show = async () => {
    setBusy(true);
    try {
      const token = await convexToken();
      const res = await fetch(`${CONVEX_SITE_URL}/client-photo?businessId=${businessId}&clientId=${clientId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      setUrl(URL.createObjectURL(await res.blob()));
    } catch {
      toast(t("The photo could not be loaded.", "No se pudo cargar la foto."), true);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const blob = await shrink(file);
      const post = await fetch(await uploadUrl({ businessId }), { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      const { storageId } = (await post.json()) as { storageId: Id<"_storage"> };
      await setPhoto({ businessId, clientId, storageId });
      setUrl(null);
      toast(t("Photo saved.", "Foto guardada."));
    } catch (e) {
      toast(describeError(t, fmt, e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={t("ID photo", "Foto de identificación")} className="section">
      <div className="card-body stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t("Only admins can see it. It is never printed or kept on this device.", "Solo los administradores pueden verla. Nunca se imprime ni se guarda en este dispositivo.")}
        </p>
        {url && <img className="photo" src={url} alt={t("Client ID photo", "Foto de identificación")} />}
        {!online ? (
          <span className="small muted">{t("Needs a connection.", "Necesita conexión.")}</span>
        ) : (
          <div className="actions">
            {hasPhoto && !url && <Button icon="image" loading={busy} onClick={() => void show()}>{t("Show photo", "Ver foto")}</Button>}
            {url && <Button onClick={() => setUrl(null)}>{t("Hide", "Ocultar")}</Button>}
            <label className="btn">
              <Icon name="image" />
              {hasPhoto ? t("Replace", "Reemplazar") : t("Add photo", "Agregar foto")}
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            </label>
            {hasPhoto && (
              <Button
                variant="danger-ghost"
                onClick={async () => {
                  await removePhoto({ businessId, clientId });
                  setUrl(null);
                }}
              >
                {t("Remove", "Quitar")}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export function ClientForm({ clientId, onClose, afterCreate }: { clientId?: string; onClose: () => void; afterCreate?: (id: string) => void }) {
  const t = useT();
  const app = useBooks();
  const toast = useToast();
  const update = useMutation(api.clients.update);
  const existing = clientId ? app.books.clientById.get(clientId)?.client : undefined;
  const [f, setF] = useState({
    fullName: existing?.fullName ?? "",
    phone: existing?.phone ?? "",
    email: existing?.email ?? "",
    idNumber: existing?.idNumber ?? "",
    address: existing?.address ?? "",
    notes: existing?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.fullName.trim()) {
      setError(t("Enter the client's full name", "Escribe el nombre completo del cliente"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        await update({ businessId: app.businessId, clientId: existing._id, expectedVersion: existing.version, ...f });
        toast(t("Client saved.", "Cliente guardado."));
        onClose();
        return;
      }
      const r = await app.submit("client.create", f, { title: f.fullName.trim(), subtitle: t("New client", "Cliente nuevo") });
      if (r.status === "refused") {
        setError(describeErrorData(t, app.fmt, r.error as never));
        return;
      }
      toast(r.status === "synced" ? t("Client saved.", "Cliente guardado.") : t("Saved on this device. It will sync when you're online.", "Guardado en este dispositivo. Se sincronizará al tener conexión."));
      if (r.status === "synced" && r.resultId) afterCreate?.(r.resultId);
      onClose();
    } catch (e) {
      setError(describeError(t, app.fmt, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={existing ? t("Edit client", "Editar cliente") : t("New client", "Nuevo cliente")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel", "Cancelar")}</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {t("Save", "Guardar")}
          </Button>
        </>
      }
    >
      <div className="form-grid two">
        <div className="span2">
          <Field label={t("Full name", "Nombre completo")}>{(id) => <input id={id} className="input" autoComplete="off" maxLength={200} value={f.fullName} onChange={set("fullName")} />}</Field>
        </div>
        <Field label={t("Phone", "Teléfono")}>{(id) => <input id={id} className="input" type="tel" inputMode="tel" maxLength={60} value={f.phone} onChange={set("phone")} />}</Field>
        <Field label={t("ID number", "Identificación")}>{(id) => <input id={id} className="input" maxLength={40} value={f.idNumber} onChange={set("idNumber")} />}</Field>
        <Field label={t("Email", "Correo")}>{(id) => <input id={id} className="input" type="email" maxLength={200} value={f.email} onChange={set("email")} />}</Field>
        <Field label={t("Address", "Dirección")}>{(id) => <input id={id} className="input" maxLength={300} value={f.address} onChange={set("address")} />}</Field>
        <div className="span2">
          <Field label={t("Notes", "Notas")}>{(id) => <textarea id={id} className="input" maxLength={10000} value={f.notes} onChange={set("notes")} />}</Field>
        </div>
      </div>
      {error && <div className="banner error" style={{ marginTop: 12 }}>{error}</div>}
    </Sheet>
  );
}
