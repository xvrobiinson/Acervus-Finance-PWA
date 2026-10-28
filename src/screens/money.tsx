// Money: the two cash accounts and every movement — payments received,
// capital added or withdrawn, expenses, income, transfers, adjustments —
// with forms for each. Expenses and income work offline (outbox).

import { useMutation } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Day } from "../../shared/domain/dates";
import type { Cents } from "../../shared/domain/money";
import { availableFrom, balancesOn, type Account } from "../../shared/domain/portfolio";
import { useForms } from "../App";
import { describeError, describeErrorData } from "../lib/errors";
import { useT } from "../lib/i18n";
import { accountLabel, entryKindLabel } from "../lib/labels";
import { useBooks } from "../state/app";
import { DateInput, MoneyInput, useMoney, useParseError } from "../ui/inputs";
import { Button, Card, Confirm, Empty, Field, Pill, Row, Segmented, Sheet, useToast } from "../ui/kit";

export type EntryFormKind = "expense" | "income" | "transfer" | "contribution" | "withdrawal" | "adjust";

interface Movement {
  key: string;
  on: Day;
  order: number;
  title: string;
  sub: string;
  amount: Cents;
  tone: "pos" | "neg" | "";
  open?: () => void;
  pending?: boolean;
}

export function MoneyScreen() {
  const t = useT();
  const { books, fmt, snapshot, can, mode, ops, today } = useBooks();
  const open = useForms();
  const [show, setShow] = useState<"all" | "in" | "out">("all");
  const s = books.summary;
  const movements = useMemo(() => {
    const out: Movement[] = [];
    for (const p of snapshot.payments) {
      const l = books.loanById.get(p.loanId);
      out.push({ key: p._id, on: p.paidOn, order: p.recordNo, title: l?.client?.fullName ?? "—", sub: t(`Payment · loan #${l?.loan.recordNo ?? ""}`, `Pago · préstamo #${l?.loan.recordNo ?? ""}`), amount: p.amount, tone: "pos" });
    }
    for (const l of snapshot.loans) {
      out.push({ key: l._id, on: l.startDate, order: l.recordNo, title: books.clientById.get(l.clientId)?.client.fullName ?? "—", sub: t(`Loan #${l.recordNo} disbursed`, `Préstamo #${l.recordNo} entregado`), amount: -l.principal, tone: "neg" });
    }
    for (const c of snapshot.capital) {
      out.push({
        key: c._id,
        on: c.occurredOn,
        order: c.recordNo,
        title: entryKindLabel(t, c.kind),
        sub: c.notes || accountLabel(t, "capital"),
        amount: c.kind === "contribution" ? c.amount : -c.amount,
        tone: c.kind === "contribution" ? "pos" : "neg",
        open: can("manage") && mode === "online" ? () => open({ kind: "entry", entry: c.kind, id: c._id }) : undefined,
      });
    }
    for (const e of snapshot.entries) {
      out.push({
        key: e._id,
        on: e.occurredOn,
        order: e.recordNo,
        title: entryKindLabel(t, e.kind),
        sub: [e.description, e.kind === "transfer" ? `${accountLabel(t, e.account)} →` : accountLabel(t, e.account)].filter(Boolean).join(" · "),
        amount: e.kind === "expense" ? -e.amount : e.amount,
        tone: e.kind === "expense" || (e.kind === "adjustment" && e.amount < 0) ? "neg" : e.kind === "transfer" ? "" : "pos",
        open: can("manage") && mode === "online" ? () => open({ kind: "entry", entry: e.kind === "adjustment" ? "adjust" : e.kind, id: e._id }) : undefined,
      });
    }
    for (const o of ops) {
      if ((o.kind === "entry.expense" || o.kind === "entry.income") && o.status !== "synced") {
        out.push({ key: o.opId, on: String(o.args.occurredOn), order: Infinity, title: o.summary.title, sub: `${o.summary.subtitle} · ${t("not synced", "sin sincronizar")}`, amount: (o.kind === "entry.expense" ? -1 : 1) * Number(o.args.amount), tone: "", pending: true });
      }
    }
    return out
      .filter((m) => show === "all" || (show === "in" ? m.amount > 0 : m.amount < 0))
      .sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : b.order - a.order));
  }, [snapshot, books, ops, show, t, can, mode, open]);
  return (
    <div>
      <div className="topbar">
        <h1>{t("Money", "Dinero")}</h1>
      </div>
      <Card>
        <div className="stats">
          <div className="stat lead">
            <div className="label">{t("Cash on hand", "Efectivo disponible")}</div>
            <div className="value">{fmt.money(s.availableCash)}</div>
          </div>
          <div className="stat">
            <div className="label">{accountLabel(t, "capital")}</div>
            <div className="value">{fmt.money(s.availableCapital)}</div>
          </div>
          <div className="stat">
            <div className="label">{accountLabel(t, "interest")}</div>
            <div className="value">{fmt.money(s.availableInterest)}</div>
          </div>
        </div>
      </Card>
      {can("record") && (
        <div className="actions" style={{ margin: "12px 0" }}>
          <Button icon="plus" onClick={() => open({ kind: "entry", entry: "expense" })}>{t("Expense", "Gasto")}</Button>
          <Button icon="plus" onClick={() => open({ kind: "entry", entry: "income" })}>{t("Income", "Ingreso")}</Button>
          {can("manage") && mode === "online" && (
            <>
              <Button onClick={() => open({ kind: "entry", entry: "contribution" })}>{t("Add capital", "Agregar capital")}</Button>
              <Button onClick={() => open({ kind: "entry", entry: "withdrawal" })}>{t("Withdraw", "Retirar")}</Button>
              <Button onClick={() => open({ kind: "entry", entry: "transfer" })}>{t("Move money", "Mover dinero")}</Button>
              <Button variant="ghost" onClick={() => open({ kind: "entry", entry: "adjust" })}>{t("Adjust balances", "Ajustar saldos")}</Button>
            </>
          )}
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        <Segmented
          label={t("Show", "Mostrar")}
          value={show}
          onChange={setShow}
          options={[
            ["all", t("All", "Todo")],
            ["in", t("In", "Entradas")],
            ["out", t("Out", "Salidas")],
          ]}
        />
      </div>
      <Card>
        <ul className="list">
          {movements.slice(0, 300).map((m) => (
            <Row
              key={m.key}
              onClick={m.open}
              title={m.title}
              sub={`${fmt.dayShort(m.on)} · ${m.sub}`}
              trail={
                <>
                  <span className={`amount num ${m.tone}`}>{m.tone === "pos" ? fmt.signed(m.amount) : fmt.money(m.amount)}</span>
                  {m.pending && <Pill tone="warn">{t("Pending", "Pendiente")}</Pill>}
                </>
              }
            />
          ))}
        </ul>
        {movements.length === 0 && <Empty icon="wallet">{t("No money movements yet.", "Aún no hay movimientos.")}</Empty>}
      </Card>
      <p className="micro muted" style={{ marginTop: 8 }}>{t(`As of ${fmt.day(today)}.`, `Al ${fmt.day(today)}.`)}</p>
    </div>
  );
}

export function EntryForm({ kind, id, onClose }: { kind: EntryFormKind; id?: string; onClose: () => void }) {
  const t = useT();
  const app = useBooks();
  const { books, fmt, snapshot, today, businessId } = app;
  const toast = useToast();
  const addCapital = useMutation(api.money.addCapital);
  const updateCapital = useMutation(api.money.updateCapital);
  const removeCapital = useMutation(api.money.removeCapital);
  const addEntry = useMutation(api.money.addEntry);
  const updateEntry = useMutation(api.money.updateEntry);
  const removeEntry = useMutation(api.money.removeEntry);
  const adjust = useMutation(api.money.adjustBalances);
  const cap = id ? snapshot.capital.find((c) => c._id === id) : undefined;
  const entry = id ? snapshot.entries.find((e) => e._id === id) : undefined;
  const [amount, setAmount] = useMoney(cap?.amount ?? (entry ? Math.abs(entry.amount) : null));
  const [negative, setNegative] = useState(entry ? entry.amount < 0 : false);
  const [on, setOn] = useState<Day>(cap?.occurredOn ?? entry?.occurredOn ?? today);
  const [account, setAccount] = useState<Account>(entry?.account ?? (kind === "income" ? "interest" : "capital"));
  const [text, setText] = useState(cap?.notes ?? entry?.description ?? "");
  const [reason, setReason] = useState("");
  const b = balancesOn(books.book, on);
  const [capitalNow, setCapitalNow] = useMoney(kind === "adjust" && !entry ? b.capital : null);
  const [interestNow, setInterestNow] = useMoney(kind === "adjust" && !entry ? b.interest : null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const showErr = useParseError();
  const editing = Boolean(cap || entry);

  const titles: Record<EntryFormKind, string> = {
    expense: t("Expense", "Gasto"),
    income: t("Income", "Ingreso"),
    transfer: t("Move money between accounts", "Mover dinero entre cuentas"),
    contribution: t("Add capital", "Agregar capital"),
    withdrawal: t("Withdraw capital", "Retirar capital"),
    adjust: t("Adjust balances", "Ajustar saldos"),
  };
  const fromAccount: Account | null = kind === "expense" || kind === "transfer" ? account : kind === "withdrawal" ? "capital" : null;
  const available = fromAccount ? availableFrom(books.book, on, fromAccount) + (editing ? (cap?.amount ?? Math.abs(entry?.amount ?? 0)) : 0) : null;

  const save = async () => {
    setTried(true);
    setError(null);
    setBusy(true);
    try {
      if (kind === "adjust" && !entry) {
        if (capitalNow.value === null || interestNow.value === null) return;
        const n = await adjust({ businessId, capital: capitalNow.value, interest: interestNow.value, occurredOn: on, reason: text });
        toast(t(`${n} adjustment(s) recorded.`, `${n} ajuste(s) registrados.`));
        return onClose();
      }
      if (amount.value === null) return;
      if (cap) {
        await updateCapital({ businessId, id: cap._id, expectedVersion: cap.version, kind: cap.kind, amount: amount.value, occurredOn: on, notes: text, reason });
      } else if (entry) {
        await updateEntry({ businessId, id: entry._id, expectedVersion: entry.version, account, amount: entry.kind === "adjustment" && negative ? -amount.value : amount.value, occurredOn: on, description: text, reason });
      } else if (kind === "contribution" || kind === "withdrawal") {
        await addCapital({ businessId, kind, amount: amount.value, occurredOn: on, notes: text });
      } else if (kind === "transfer") {
        await addEntry({ businessId, opId: crypto.randomUUID(), kind: "transfer", account, amount: amount.value, occurredOn: on, description: text });
      } else if (kind === "expense" || kind === "income") {
        if (!text.trim()) {
          setError(kind === "expense" ? t("Write what the expense was for", "Escribe en qué fue el gasto") : t("Write where the income came from", "Escribe de dónde vino el ingreso"));
          return;
        }
        const r = await app.submit(
          kind === "expense" ? "entry.expense" : "entry.income",
          { kind, account, amount: amount.value, occurredOn: on, description: text },
          { title: titles[kind], subtitle: text.trim(), amount: amount.value, on },
        );
        if (r.status === "refused") return setError(describeErrorData(t, fmt, r.error as never));
        toast(r.status === "synced" ? t("Saved.", "Guardado.") : t("Saved on this device. It will sync when you're online.", "Guardado en este dispositivo. Se sincronizará al tener conexión."));
        return onClose();
      }
      toast(t("Saved.", "Guardado."));
      onClose();
    } catch (e) {
      setError(describeError(t, fmt, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={editing ? `${t("Edit", "Editar")}: ${titles[kind]}` : titles[kind]}
      onClose={onClose}
      footer={
        <>
          {editing && <Button variant="danger-ghost" icon="trash" onClick={() => setConfirmDelete(true)}>{t("Delete", "Eliminar")}</Button>}
          <Button onClick={onClose}>{t("Cancel", "Cancelar")}</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>{t("Save", "Guardar")}</Button>
        </>
      }
    >
      <div className="form-grid">
        {kind === "adjust" && !entry ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              {t("Type what each account really holds at the end of the date. An adjustment is recorded for each difference.", "Escribe lo que realmente hay en cada cuenta al final de la fecha. Se registra un ajuste por cada diferencia.")}
            </p>
            <Field label={accountLabel(t, "capital")} hint={t(`Books say ${fmt.money(b.capital)}`, `Según los libros: ${fmt.money(b.capital)}`)} error={showErr(capitalNow, tried)}>
              {(fid) => <MoneyInput id={fid} value={capitalNow.text} onChange={setCapitalNow} symbol={fmt.symbol} />}
            </Field>
            <Field label={accountLabel(t, "interest")} hint={t(`Books say ${fmt.money(b.interest)}`, `Según los libros: ${fmt.money(b.interest)}`)} error={showErr(interestNow, tried)}>
              {(fid) => <MoneyInput id={fid} value={interestNow.text} onChange={setInterestNow} symbol={fmt.symbol} />}
            </Field>
          </>
        ) : (
          <Field
            label={t("Amount", "Monto")}
            error={showErr(amount, tried)}
            hint={available !== null ? t(`Available: ${fmt.money(Math.max(available, 0))}`, `Disponible: ${fmt.money(Math.max(available, 0))}`) : undefined}
          >
            {(fid) => <MoneyInput id={fid} value={amount.text} onChange={setAmount} symbol={fmt.symbol} invalid={!!amount.error && tried} />}
          </Field>
        )}
        {entry?.kind === "adjustment" && (
          <Segmented label={t("Direction", "Sentido")} value={negative ? "down" : "up"} onChange={(v) => setNegative(v === "down")} options={[["up", t("Increase", "Aumentar")], ["down", t("Decrease", "Disminuir")]]} />
        )}
        {(kind === "expense" || kind === "income" || kind === "transfer" || entry) && (
          <Field label={kind === "transfer" ? t("From", "Desde") : kind === "income" ? t("Into", "Hacia") : t("Paid from", "Pagado desde")}>
            {() => (
              <Segmented label={t("Account", "Cuenta")} value={account} onChange={setAccount} options={[["capital", accountLabel(t, "capital")], ["interest", accountLabel(t, "interest")]]} />
            )}
          </Field>
        )}
        {kind === "income" && (
          <p className="micro muted" style={{ margin: 0 }}>
            {t("Into available interest it counts as income; into available capital it counts as capital invested.", "En interés disponible cuenta como ingreso; en capital disponible cuenta como capital invertido.")}
          </p>
        )}
        <Field label={t("Date", "Fecha")}>{(fid) => <DateInput id={fid} value={on} max={today} onChange={setOn} />}</Field>
        <Field label={kind === "expense" ? t("What it was for", "En qué fue") : kind === "income" ? t("Where it came from", "De dónde vino") : kind === "adjust" ? t("Reason", "Motivo") : t("Notes", "Notas")}>
          {(fid) => <input id={fid} className="input" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        {editing && (
          <Field label={t("Reason for the change (kept in the history)", "Motivo del cambio (queda en el historial)")}>{(fid) => <input id={fid} className="input" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        )}
      </div>
      {error && <div className="banner error" style={{ marginTop: 12 }}>{error}</div>}
      {confirmDelete && (
        <Confirm
          title={t("Delete", "Eliminar")}
          danger
          needsReason
          confirmLabel={t("Delete", "Eliminar")}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async (r) => {
            try {
              if (cap) await removeCapital({ businessId, id: cap._id as Id<"capitalTxs">, expectedVersion: cap.version, reason: r });
              else if (entry) await removeEntry({ businessId, id: entry._id as Id<"cashEntries">, expectedVersion: entry.version, reason: r });
              onClose();
            } catch (e) {
              throw new Error(describeError(t, fmt, e));
            }
          }}
        >
          {t("It is refused if an account would go below zero. The deletion is kept in the history.", "Se rechaza si una cuenta quedaría por debajo de cero. La eliminación queda en el historial.")}
        </Confirm>
      )}
    </Sheet>
  );
}
