// Record (or, for admins, edit) a payment, with where every peso goes shown
// before saving. New payments go through the outbox, so they also work
// offline; the server works the split out again and its figures win.

import { useMutation } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Day } from "../../shared/domain/dates";
import { installmentStatus, owed, remaining, type Instruction } from "../../shared/domain/installments";
import { hasInstallments } from "../../shared/domain/loans";
import { parseMoney, type Cents } from "../../shared/domain/money";
import {
  installmentStateBefore,
  previewInstallmentPayment,
  previewPayment,
  type LateFeeRecord,
  type LoanRecord,
  type PaymentRecord,
} from "../../shared/domain/records";
import { describeError, describeErrorData, paymentErrorText, planErrorText } from "../lib/errors";
import { useT } from "../lib/i18n";
import { ReceiptSheet } from "../receipts/view";
import { useBooks } from "../state/app";
import { DateInput, MoneyInput, useMoney, useParseError } from "../ui/inputs";
import { Banner, Button, Field, Segmented, Sheet, useToast } from "../ui/kit";

type Mode = "auto" | "installment" | "spread" | "custom";

export function PaymentForm({ loanId, paymentId, onClose }: { loanId?: string; paymentId?: string; onClose: () => void }) {
  const t = useT();
  const app = useBooks();
  const { books, fmt, snapshot, today, businessId, mode: appMode } = app;
  const toast = useToast();
  const update = useMutation(api.payments.update);
  const editing = paymentId ? snapshot.payments.find((p) => p._id === paymentId) : undefined;
  const [loan, setLoan] = useState<string>(editing?.loanId ?? loanId ?? "");
  const view = books.loanById.get(loan);
  const [amount, setAmount, setAmountCents] = useMoney(editing?.amount ?? null);
  const [fee, setFee] = useMoney(editing?.feeInput || null);
  const [on, setOn] = useState<Day>(editing?.paidOn ?? today);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<Mode>((editing?.mode as Mode) ?? "auto");
  const [target, setTarget] = useState<number>(editing?.targetSeq ?? 0);
  const [spread, setSpread] = useState<Record<number, string>>(() =>
    Object.fromEntries((editing?.targets ?? []).map((x) => [x.seq, (x.amount / 100).toFixed(2)])),
  );
  const [custom, setCustom] = useState(() => ({
    fee: editing?.custom ? (editing.custom.fee / 100).toFixed(2) : "",
    interest: editing?.custom ? (editing.custom.interest / 100).toFixed(2) : "",
    principal: editing?.custom ? (editing.custom.principal / 100).toFixed(2) : "",
  }));
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const showErr = useParseError();

  const records = {
    payments: snapshot.payments as unknown as PaymentRecord[],
    lateFees: snapshot.lateFees as unknown as LateFeeRecord[],
  };
  const loanRec = view?.loan as unknown as LoanRecord | undefined;
  const installments = loanRec ? hasInstallments(loanRec.method) : false;
  const cents = (s: string) => {
    const r = parseMoney(s);
    return r.ok ? r.value : 0;
  };
  const instruction: Instruction = !installments
    ? { kind: "auto" }
    : mode === "installment"
      ? { kind: "installment", seq: target }
      : mode === "spread"
        ? { kind: "spread", parts: Object.entries(spread).map(([seq, a]) => ({ seq: Number(seq), amount: cents(a) })).filter((x) => x.amount > 0) }
        : mode === "custom"
          ? { kind: "custom", principal: cents(custom.principal), interest: cents(custom.interest), fee: cents(custom.fee) }
          : { kind: "auto" };
  const total: Cents | null =
    installments && mode === "spread"
      ? Object.values(spread).reduce((a, s) => a + cents(s), 0)
      : installments && mode === "custom"
        ? cents(custom.fee) + cents(custom.interest) + cents(custom.principal)
        : amount.value;
  const feeValue = installments ? 0 : (fee.value ?? 0);

  // What is owed right before it, for quick amounts and the installment list.
  const before = useMemo(() => {
    if (!loanRec) return null;
    if (installments) return installmentStateBefore(loanRec, records.payments, records.lateFees, paymentId ?? null, on, today);
    return null;
  }, [loanRec, installments, records.payments, records.lateFees, paymentId, on, today]);
  const openInstallments = before?.installments.filter((x) => remaining(x) > 0) ?? [];

  const preview = useMemo(() => {
    if (!loanRec || total === null || total <= 0) return null;
    if (installments) return previewInstallmentPayment(loanRec, records.payments, records.lateFees, paymentId ?? null, total, on, instruction, today);
    return previewPayment(loanRec, records.payments, paymentId ?? null, total, feeValue, on, today);
  }, [loanRec, installments, records.payments, records.lateFees, paymentId, total, on, JSON.stringify(instruction), today, feeValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const previewError = preview && !preview.ok ? (installments ? planErrorText(t, fmt, preview.error as never) : paymentErrorText(t, fmt, preview.error as never)) : null;
  const split = preview && preview.ok
    ? "applied" in preview.value
      ? preview.value.applied.reduce((a, x) => ({ fee: a.fee + x.fee, interest: a.interest + x.interest, principal: a.principal + x.principal }), { fee: 0, interest: 0, principal: 0 })
      : { fee: preview.value.fee, interest: preview.value.interest, principal: preview.value.principal }
    : null;

  const quick: [string, Cents][] = view
    ? ([
        [t("Next due", "Próximo"), view.delinquency.nextDueAmount],
        [t("Overdue", "Atrasado"), view.delinquency.overdueAmount],
        [t("Pay off", "Saldar"), view.payoff],
      ] as [string, Cents][]).filter(([, v]) => v > 0)
    : [];

  const save = async (confirmedStale = false) => {
    setTried(true);
    setError(null);
    if (!view || total === null || total <= 0) return;
    if (installments && mode === "installment" && !target) return setError(t("Choose the installment", "Elige la cuota"));
    setBusy(true);
    try {
      if (editing) {
        await update({
          businessId,
          paymentId: editing._id,
          expectedVersion: editing.version,
          amount: total,
          fee: feeValue,
          paidOn: on,
          notes,
          instruction: instruction as never,
          reason,
        });
        toast(t("Payment saved; the loan was worked out again.", "Pago guardado; el préstamo se recalculó."));
        onClose();
        return;
      }
      const args = {
        loanId: view.loan._id,
        loanVersion: view.loan.version,
        amount: total,
        fee: feeValue,
        paidOn: on,
        notes,
        instruction,
        ...(confirmedStale ? { confirmedStale: true } : {}),
      };
      const r = await app.submit("payment.record", args, {
        title: view.client?.fullName ?? "—",
        subtitle: t(`Payment · loan #${view.loan.recordNo}`, `Pago · préstamo #${view.loan.recordNo}`),
        amount: total,
        loanId: view.loan._id,
        on,
      });
      if (r.status === "refused") {
        setStale(r.error?.code === "stale");
        setError(describeErrorData(t, fmt, r.error as never));
        return;
      }
      if (r.status === "queued") {
        toast(t("Saved on this device. It will sync when you're online.", "Guardado en este dispositivo. Se sincronizará al tener conexión."));
        onClose();
        return;
      }
      toast(t("Payment recorded.", "Pago registrado."));
      if (snapshot.settings?.receiptAfterPayment && r.resultId) setReceiptId(r.resultId);
      else onClose();
    } catch (e) {
      setError(describeError(t, fmt, e));
    } finally {
      setBusy(false);
    }
  };

  if (receiptId) {
    return snapshot.payments.some((p) => p._id === receiptId) ? (
      <ReceiptSheet kind="payment" id={receiptId} onClose={onClose} />
    ) : (
      <Sheet title={t("Payment recorded", "Pago registrado")} onClose={onClose}>
        <p>{t("Preparing the receipt…", "Preparando el recibo…")}</p>
      </Sheet>
    );
  }

  const active = books.loans.filter((l) => l.loan.status === "active" || l.loan._id === loan).sort((a, b) => (a.client?.fullName ?? "").localeCompare(b.client?.fullName ?? ""));
  return (
    <Sheet
      wide={installments}
      title={editing ? t("Edit payment", "Editar pago") : t("Record payment", "Registrar pago")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel", "Cancelar")}</Button>
          <Button variant="primary" loading={busy} disabled={!!previewError} onClick={() => void save()}>
            {t("Save payment", "Guardar pago")}
          </Button>
        </>
      }
    >
      <div className="form-grid two">
        <div className="span2">
          <Field label={t("Loan", "Préstamo")} error={tried && !view ? t("Choose a loan", "Elige un préstamo") : null}>
            {(id) => (
              <select id={id} className="input" value={loan} disabled={!!editing || !!loanId} onChange={(e) => setLoan(e.target.value)}>
                <option value="">{t("Choose…", "Elige…")}</option>
                {active.map((l) => (
                  <option key={l.loan._id} value={l.loan._id}>
                    {l.client?.fullName ?? "—"} · #{l.loan.recordNo} · {fmt.money(l.payoff)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {view && installments && (
          <div className="span2">
            <Field label={t("Apply it", "Aplicarlo")}>
              {() => (
                <Segmented
                  label={t("Apply it", "Aplicarlo")}
                  value={mode}
                  onChange={setMode}
                  options={[
                    ["auto", t("Oldest first", "Más antigua")],
                    ["installment", t("One", "Una cuota")],
                    ["spread", t("Spread", "Repartir")],
                    ["custom", t("Custom", "Personal")],
                  ]}
                />
              )}
            </Field>
          </div>
        )}
        {(!installments || mode === "auto" || mode === "installment") && (
          <Field label={t("Amount", "Monto")} error={showErr(amount, tried)}>
            {(id) => (
              <div className="stack tight">
                <MoneyInput id={id} value={amount.text} onChange={setAmount} symbol={fmt.symbol} invalid={!!amount.error && tried} />
                {quick.length > 0 && !editing && (
                  <div className="chips">
                    {quick.map(([label, v]) => (
                      <button key={label} type="button" className="chip" onClick={() => setAmountCents(v)}>
                        {label} · {fmt.money(v)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>
        )}
        <Field label={t("Date paid", "Fecha de pago")}>{(id) => <DateInput id={id} value={on} max={today} min={view?.loan.startDate} onChange={setOn} />}</Field>
        {view && !installments && (
          <Field label={t("Extra fee (optional)", "Cargo adicional (opcional)")} hint={t("Taken first, before interest.", "Se toma primero, antes del interés.")} error={fee.text ? showErr(fee, tried) : null}>
            {(id) => <MoneyInput id={id} value={fee.text} onChange={setFee} symbol={fmt.symbol} />}
          </Field>
        )}
        {view && installments && mode === "installment" && (
          <Field label={t("Installment", "Cuota")}>
            {(id) => (
              <select id={id} className="input" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                <option value={0}>{t("Choose…", "Elige…")}</option>
                {openInstallments.map((x) => (
                  <option key={x.seq} value={x.seq}>
                    #{x.seq} · {fmt.dayShort(x.due)} · {t("owes", "debe")} {fmt.money(owed(x) || remaining(x))}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {view && installments && mode === "spread" && (
          <div className="span2 stack tight">
            {openInstallments.map((x) => (
              <div key={x.seq} className="row">
                <span className="grow small">
                  #{x.seq} · {fmt.dayShort(x.due)} · <span className={installmentStatus(x, on) === "overdue" ? "neg" : "muted"}>{fmt.money(remaining(x))}</span>
                </span>
                <div style={{ width: 160 }}>
                  <MoneyInput id={`sp${x.seq}`} value={spread[x.seq] ?? ""} onChange={(v) => setSpread({ ...spread, [x.seq]: v })} symbol={fmt.symbol} />
                </div>
              </div>
            ))}
            <div className="row between strong">
              <span>{t("Total", "Total")}</span>
              <span className="num">{fmt.money(total ?? 0)}</span>
            </div>
          </div>
        )}
        {view && installments && mode === "custom" && (
          <>
            {(
              [
                ["fee", t("To late fees", "A mora")],
                ["interest", t("To interest", "A interés")],
                ["principal", t("To capital", "A capital")],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                {(id) => <MoneyInput id={id} value={custom[k]} onChange={(v) => setCustom({ ...custom, [k]: v })} symbol={fmt.symbol} />}
              </Field>
            ))}
            <div className="row between strong">
              <span>{t("Total", "Total")}</span>
              <span className="num">{fmt.money(total ?? 0)}</span>
            </div>
          </>
        )}
        <div className="span2">
          <Field label={t("Notes", "Notas")}>{(id) => <input id={id} className="input" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        </div>
        {editing && (
          <div className="span2">
            <Field label={t("Reason for the change (kept in the history)", "Motivo del cambio (queda en el historial)")}>{(id) => <input id={id} className="input" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          </div>
        )}
      </div>

      {split && (
        <div className="preview" style={{ marginTop: 16 }}>
          <dl className="kv">
            {split.fee > 0 && (
              <>
                <dt>{installments ? t("Late fees", "Mora") : t("Fee", "Cargo")}</dt>
                <dd>{fmt.money(split.fee)}</dd>
              </>
            )}
            <dt>{t("Interest", "Interés")}</dt>
            <dd>{fmt.money(split.interest)}</dd>
            <dt>{t("Capital", "Capital")}</dt>
            <dd>{fmt.money(split.principal)}</dd>
            {preview?.ok && "principalAfter" in preview.value && (
              <>
                <dt className="total">{t("Capital left after it", "Capital restante")}</dt>
                <dd className="total">{fmt.money(preview.value.principalAfter)}</dd>
              </>
            )}
          </dl>
          {preview?.ok && "applied" in preview.value && preview.value.applied.length > 0 && (
            <p className="micro muted" style={{ marginBottom: 0 }}>
              {preview.value.applied.map((a) => `#${a.seq}: ${fmt.money(a.fee + a.interest + a.principal)}`).join(" · ")}
            </p>
          )}
          {(appMode !== "online" || editing) && (
            <p className="micro muted" style={{ marginBottom: 0 }}>
              {editing
                ? t("Later payments on this loan are split again when you save.", "Los pagos posteriores se reparten de nuevo al guardar.")
                : t("Worked out from the copy on this device; the server works it out again when it syncs.", "Calculado con la copia de este dispositivo; el servidor lo recalcula al sincronizar.")}
            </p>
          )}
        </div>
      )}
      {previewError && <div className="banner warn" style={{ marginTop: 12 }}>{previewError}</div>}
      {error && (
        <Banner tone="error" icon="alert" action={stale ? <Button size="small" onClick={() => void save(true)}>{t("Record anyway", "Registrar igual")}</Button> : undefined}>
          {error}
        </Banner>
      )}
    </Sheet>
  );
}

