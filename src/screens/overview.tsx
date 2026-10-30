// Overview: where the money is and who owes it, before anything to do.

import { useMemo, useState } from "react";
import { addMonths, maxDay } from "../../shared/domain/dates";
import { firstActivity, gain, history, netInvested, realizedIncome } from "../../shared/domain/portfolio";
import { ratioLabel } from "../../shared/domain/money";
import { useForms } from "../App";
import { useT } from "../lib/i18n";
import { displayStatusLabel } from "../lib/labels";
import { needsAttention } from "../state/books";
import { useBooks } from "../state/app";
import { GrowthChart } from "../ui/chart";
import { Avatar, Button, Card, Empty, LinkButton, Pill, Row, Segmented, Stat } from "../ui/kit";
import { statusTone } from "./loans";

export function OverviewScreen() {
  const t = useT();
  const { books, fmt, snapshot, today, can } = useBooks();
  const open = useForms();
  const admin = can("manage");
  const s = books.summary;
  const [range, setRange] = useState<"3" | "6" | "12" | "all">("6");
  const points = useMemo(() => {
    const first = firstActivity(books.book);
    if (!first) return [];
    const from = range === "all" ? first : maxDay(first, addMonths(today, -Number(range)));
    return history(books.book, from, today);
  }, [books.book, today, range]);
  const attention = needsAttention(books).slice(0, 8);
  const recent = [...snapshot.payments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const ret = ratioLabel(gain(s), netInvested(s));
  return (
    <div>
      <div className="topbar">
        <h1>{snapshot.business.name}</h1>
        {can("record") && (
          <Button variant="primary" size="small" icon="receipt" onClick={() => open({ kind: "payment" })}>
            {t("Payment", "Pago")}
          </Button>
        )}
      </div>
      <Card>
        {/* The business's totals are for admins; collectors and viewers see their work. */}
        {!admin ? (
          <div className="stats">
            <Stat lead label={t("Active loans", "Préstamos activos")} value={String(s.activeLoans)} caption={t(`${s.dueSoonLoans} due soon`, `${s.dueSoonLoans} vencen pronto`)} />
            <Stat
              label={t("Overdue", "Atrasado")}
              value={fmt.money(s.overdueAmount)}
              tone={s.overdueAmount > 0 ? "neg" : undefined}
              caption={t(`${s.overdueLoans} loans`, `${s.overdueLoans} préstamos`)}
            />
            <Stat
              label={t("Receivable", "Por cobrar")}
              value={fmt.money(s.interestReceivable + s.feesReceivable)}
              caption={t("Interest and late fees due, unpaid", "Interés y mora vencidos sin pagar")}
            />
          </div>
        ) : (
          <div className="stats">
            <Stat
              lead
              label={t("Portfolio value", "Valor del portafolio")}
              value={fmt.money(s.portfolioValue)}
              caption={
                <span className={gain(s) >= 0 ? "pos" : "neg"}>
                  {fmt.signed(gain(s))} {ret ? `(${ret})` : ""} · {t("on capital invested", "sobre capital invertido")}
                </span>
              }
            />
            <Stat label={t("Available capital", "Capital disponible")} value={fmt.money(s.availableCapital)} />
            <Stat label={t("Available interest", "Interés disponible")} value={fmt.money(s.availableInterest)} />
            <Stat label={t("Capital lent out", "Capital prestado")} value={fmt.money(s.outstandingPrincipal)} caption={t(`${s.activeLoans} active loans`, `${s.activeLoans} préstamos activos`)} />
            <Stat label={t("Interest earned", "Interés cobrado")} value={fmt.money(realizedIncome(s))} caption={t(`${fmt.money(s.expectedMonthlyInterest)} expected a month`, `${fmt.money(s.expectedMonthlyInterest)} esperados al mes`)} />
            <Stat
              label={t("Overdue", "Atrasado")}
              value={fmt.money(s.overdueAmount)}
              tone={s.overdueAmount > 0 ? "neg" : undefined}
              caption={t(`${s.overdueLoans} loans · ${s.dueSoonLoans} due soon`, `${s.overdueLoans} préstamos · ${s.dueSoonLoans} vencen pronto`)}
            />
            <Stat
              label={t("Receivable", "Por cobrar")}
              value={fmt.money(s.interestReceivable + s.feesReceivable)}
              caption={t("Interest and late fees due, unpaid", "Interés y mora vencidos sin pagar")}
            />
          </div>
        )}
      </Card>

      <div className={admin ? "grid2" : undefined} style={{ marginTop: 16 }}>
        {admin && (
          <Card
            title={t("Growth", "Crecimiento")}
            action={
              <div style={{ width: 200 }}>
                <Segmented
                  label={t("Range", "Rango")}
                  value={range}
                  onChange={setRange}
                  options={[
                    ["3", "3M"],
                    ["6", "6M"],
                    ["12", t("1Y", "1A")],
                    ["all", t("All", "Todo")],
                  ]}
                />
              </div>
            }
          >
            <div className="card-body">
              {points.length > 1 ? (
                <>
                  <GrowthChart points={points} fmt={fmt} label={t("Portfolio value over time", "Valor del portafolio en el tiempo")} />
                  <p className="micro muted">
                    {t("Solid: portfolio value. Dashed: capital invested.", "Línea continua: valor del portafolio. Discontinua: capital invertido.")}
                  </p>
                </>
              ) : (
                <Empty icon="chart">{t("The chart appears once there is activity on more than one day.", "El gráfico aparece cuando hay actividad en más de un día.")}</Empty>
              )}
            </div>
          </Card>
        )}
        <Card title={t("Needs attention", "Requiere atención")} action={<LinkButton to="/loans" size="small" variant="ghost">{t("All loans", "Préstamos")}</LinkButton>}>
          {attention.length === 0 ? (
            <Empty icon="check">{t("Nothing overdue or due in the next 5 days.", "Nada atrasado ni por vencer en los próximos 5 días.")}</Empty>
          ) : (
            <ul className="list">
              {attention.map((l) => (
                <Row
                  key={l.loan._id}
                  to={`/loans/${l.loan._id}`}
                  lead={<Avatar name={l.client?.fullName ?? "?"} />}
                  title={l.client?.fullName ?? "—"}
                  sub={
                    l.display === "overdue"
                      ? t(`${l.delinquency.daysOverdue} days overdue`, `${l.delinquency.daysOverdue} días de atraso`)
                      : l.delinquency.nextDue
                        ? t(`Due ${fmt.dayShort(l.delinquency.nextDue)}`, `Vence ${fmt.dayShort(l.delinquency.nextDue)}`)
                        : ""
                  }
                  trail={
                    <>
                      <span className="amount num">{fmt.money(l.display === "overdue" ? l.delinquency.overdueAmount : l.delinquency.nextDueAmount)}</span>
                      <Pill tone={statusTone(l.display)}>{displayStatusLabel(t, l.display)}</Pill>
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t("Recent payments", "Pagos recientes")} className="section" action={admin && <LinkButton to="/money" size="small" variant="ghost">{t("Money", "Dinero")}</LinkButton>}>
        {recent.length === 0 ? (
          <Empty icon="receipt">{t("No payments yet.", "Aún no hay pagos.")}</Empty>
        ) : (
          <ul className="list">
            {recent.map((p) => {
              const l = books.loanById.get(p.loanId);
              return (
                <Row
                  key={p._id}
                  to={`/loans/${p.loanId}`}
                  lead={<Avatar name={l?.client?.fullName ?? "?"} />}
                  title={l?.client?.fullName ?? "—"}
                  sub={`${fmt.dayShort(p.paidOn)} · ${t("interest", "interés")} ${fmt.money(p.interest)} · ${t("capital", "capital")} ${fmt.money(p.principal)}`}
                  trail={<span className="amount num pos">{fmt.money(p.amount)}</span>}
                />
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
