// The change history: every create, edit and deletion, who made it and
// what changed. Read from the server a page at a time (online only).

import { usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useT } from "../lib/i18n";
import { useBooks } from "../state/app";
import { Banner, Button, Card, Empty, Pill } from "../ui/kit";

const MONEY_FIELDS = new Set(["amount", "principal", "interest", "fee", "fee_base", "received", "capital"]);

export function HistoryScreen() {
  const t = useT();
  const { businessId, fmt, mode } = useBooks();
  const { results, status, loadMore } = usePaginatedQuery(api.data.changes, mode === "online" ? { businessId } : "skip", { initialNumItems: 40 });
  const entity: Record<string, string> = {
    client: t("Client", "Cliente"),
    loan: t("Loan", "Préstamo"),
    payment: t("Payment", "Pago"),
    capital: t("Capital", "Capital"),
    entry: t("Money", "Dinero"),
    late_fee: t("Late fee", "Mora"),
    settings: t("Settings", "Ajustes"),
    member: t("Member", "Miembro"),
  };
  const action: Record<string, [string, "pos" | "warn" | "neg"]> = {
    create: [t("Created", "Creado"), "pos"],
    update: [t("Changed", "Cambiado"), "warn"],
    delete: [t("Deleted", "Eliminado"), "neg"],
  };
  const show = (field: string, v: string) => (v !== "" && MONEY_FIELDS.has(field) && /^-?\d+$/.test(v) ? fmt.money(Number(v)) : v.length > 80 ? `${v.slice(0, 80)}…` : v);
  return (
    <div>
      <div className="topbar">
        <h1>{t("History", "Historial")}</h1>
      </div>
      {mode !== "online" && <Banner tone="offline" icon="cloudOff">{t("The history needs a connection.", "El historial necesita conexión.")}</Banner>}
      <Card>
        <ul className="list">
          {results.map((c) => (
            <li key={c._id}>
              <div className="list-row" style={{ alignItems: "flex-start" }}>
                <div className="grow">
                  <div className="row wrap" style={{ gap: 6 }}>
                    <Pill tone={action[c.action][1]}>{action[c.action][0]}</Pill>
                    <span className="strong">{entity[c.entity]}</span>
                    <span className="micro muted">
                      {new Date(c.createdAt).toLocaleString(fmt.lang)} · {c.userName}
                    </span>
                  </div>
                  <div className="small" style={{ marginTop: 4 }}>
                    {c.changes.map((ch) => (
                      <div key={ch.field} className="muted" style={{ overflowWrap: "anywhere" }}>
                        {ch.field}: {c.action === "update" ? `${show(ch.field, ch.old) || "∅"} → ${show(ch.field, ch.new) || "∅"}` : show(ch.field, c.action === "delete" ? ch.old : ch.new)}
                      </div>
                    ))}
                    {c.reason && <div>“{c.reason}”</div>}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {results.length === 0 && status !== "LoadingFirstPage" && <Empty icon="history">{t("No changes yet.", "Aún no hay cambios.")}</Empty>}
      </Card>
      {status === "CanLoadMore" && (
        <div style={{ marginTop: 12 }}>
          <Button block onClick={() => loadMore(40)}>{t("Load more", "Cargar más")}</Button>
        </div>
      )}
    </div>
  );
}
