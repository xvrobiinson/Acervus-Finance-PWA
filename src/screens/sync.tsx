// The sync center: every change made on this device and where it stands —
// waiting, synced, or refused and waiting for a person (fix, confirm with the
// loan's current figures, or discard; discards are kept in a journal).

import { useEffect, useState } from "react";
import { describeErrorData } from "../lib/errors";
import { useT } from "../lib/i18n";
import { journalFor, type JournalEntry, type QueuedOp } from "../offline/store";
import { useBooks } from "../state/app";
import { Banner, Button, Card, Confirm, Empty, Pill } from "../ui/kit";

export function SyncScreen() {
  const t = useT();
  const app = useBooks();
  const { ops, fmt, mode, connected, syncing, lastSync, user } = app;
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [discarding, setDiscarding] = useState<QueuedOp | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    if (user) void journalFor(user.id).then(setJournal);
    void navigator.storage?.persisted?.().then(setPersisted);
  }, [user, ops]);
  const mine = ops.filter((o) => o.businessId === app.businessId);
  const review = mine.filter((o) => o.status === "needs_review");
  const waiting = mine.filter((o) => o.status === "pending" || o.status === "syncing");
  const done = mine.filter((o) => o.status === "synced").reverse();
  const kindLabel = (o: QueuedOp) =>
    ({ "client.create": t("New client", "Cliente nuevo"), "payment.record": t("Payment", "Pago"), "entry.expense": t("Expense", "Gasto"), "entry.income": t("Income", "Ingreso") })[o.kind];
  const line = (o: QueuedOp) => (
    <>
      <div className="title">
        {kindLabel(o)} · {o.summary.title}
      </div>
      <div className="sub">
        {o.summary.amount !== undefined ? `${fmt.money(o.summary.amount)} · ` : ""}
        {t("made", "hecho")} {new Date(o.createdAt).toLocaleString(fmt.lang)}
      </div>
    </>
  );
  return (
    <div>
      <div className="topbar">
        <h1>{t("Sync", "Sincronización")}</h1>
        <Button size="small" icon="sync" loading={syncing} disabled={mode !== "online" || !connected} onClick={() => void app.syncNow()}>
          {t("Sync now", "Sincronizar")}
        </Button>
      </div>
      {mode !== "online" || !connected ? (
        <Banner tone="offline" icon="cloudOff">{t("Offline. Changes below are kept on this device and sent when you're back online.", "Sin conexión. Los cambios de abajo se guardan en este dispositivo y se envían al volver la conexión.")}</Banner>
      ) : (
        <Banner tone="info" icon="check">
          {lastSync ? t(`Connected. Last sync ${new Date(lastSync.at).toLocaleTimeString(fmt.lang)}.`, `Conectado. Última sincronización ${new Date(lastSync.at).toLocaleTimeString(fmt.lang)}.`) : t("Connected.", "Conectado.")}
        </Banner>
      )}
      {persisted === false && (
        <Banner tone="warn" icon="alert">
          {t("This browser may clear offline data when space runs low. Install the app (Add to Home Screen) to keep it.", "Este navegador podría borrar los datos sin conexión si falta espacio. Instala la app (Agregar a inicio) para conservarlos.")}
        </Banner>
      )}

      <Card title={t("Needs your review", "Necesita tu revisión")} action={<Pill tone={review.length ? "warn" : undefined}>{review.length}</Pill>}>
        <ul className="list">
          {review.map((o) => (
            <li key={o.opId}>
              <div className="list-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                <div className="grow">
                  {line(o)}
                  <div className="small neg" style={{ marginTop: 4, whiteSpace: "normal" }}>{o.error ? describeErrorData(t, fmt, o.error) : ""}</div>
                </div>
                <div className="actions" style={{ width: "100%", justifyContent: "flex-end" }}>
                  {o.error?.code === "stale" && (
                    <Button size="small" variant="primary" onClick={() => void app.retry(o, { ...o.args, confirmedStale: true })}>
                      {t("Record anyway", "Registrar igual")}
                    </Button>
                  )}
                  {o.error?.code !== "stale" && <Button size="small" onClick={() => void app.retry(o)}>{t("Try again", "Reintentar")}</Button>}
                  <Button size="small" variant="danger-ghost" onClick={() => setDiscarding(o)}>{t("Discard", "Descartar")}</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {review.length === 0 && <Empty icon="check">{t("Nothing to review.", "Nada que revisar.")}</Empty>}
      </Card>

      <Card title={t("Waiting to sync", "Esperando sincronizar")} className="section" action={<Pill>{waiting.length}</Pill>}>
        <ul className="list">
          {waiting.map((o) => (
            <li key={o.opId}>
              <div className="list-row">
                <div className="grow">{line(o)}</div>
                <Pill tone="warn">{o.status === "syncing" ? t("Sending…", "Enviando…") : t("Pending", "Pendiente")}</Pill>
              </div>
            </li>
          ))}
        </ul>
        {waiting.length === 0 && <Empty icon="check">{t("Everything is synced.", "Todo está sincronizado.")}</Empty>}
      </Card>

      {done.length > 0 && (
        <Card title={t("Synced from this device", "Sincronizado desde este dispositivo")} className="section">
          <ul className="list">
            {done.slice(0, 30).map((o) => (
              <li key={o.opId}>
                <div className="list-row">
                  <div className="grow">{line(o)}</div>
                  <Pill tone="pos">{t("Synced", "Sincronizado")}</Pill>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {journal.length > 0 && (
        <Card title={t("Discarded", "Descartados")} className="section">
          <ul className="list">
            {journal.slice(0, 30).map((j) => (
              <li key={j.id}>
                <div className="list-row muted">
                  <div className="grow">{line(j.op)}</div>
                  <span className="micro muted">{new Date(j.at).toLocaleString(fmt.lang)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {discarding && (
        <Confirm
          title={t("Discard this change?", "¿Descartar este cambio?")}
          danger
          confirmLabel={t("Discard", "Descartar")}
          onClose={() => setDiscarding(null)}
          onConfirm={() => app.discard(discarding)}
        >
          {t("It will not be sent to the server. A note that you discarded it stays on this device.", "No se enviará al servidor. Queda una nota en este dispositivo de que lo descartaste.")}
        </Confirm>
      )}
    </div>
  );
}
