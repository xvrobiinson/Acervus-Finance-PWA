// Portfolio analytics: returns, the capital ledger, loans by status and the
// monthly cash flow, all from the same engine as the desktop app.

import { useMemo } from "react";
import { DISPLAY_ORDER } from "../../shared/domain/ledger";
import { ratioLabel } from "../../shared/domain/money";
import { gain, monthlyCashFlow, monthNet, netInvested, outsideIncome, realizedIncome, totalExpenses } from "../../shared/domain/portfolio";
import { shortMonthYear } from "../../shared/domain/dates";
import { useT } from "../lib/i18n";
import { displayStatusLabel } from "../lib/labels";
import { useBooks } from "../state/app";
import { Card, Pill } from "../ui/kit";
import { statusTone } from "./loans";

export function ReportsScreen() {
  const t = useT();
  const { books, fmt, today } = useBooks();
  const s = books.summary;
  const flows = useMemo(() => monthlyCashFlow(books.book, today).reverse(), [books.book, today]);
  const byStatus = DISPLAY_ORDER.map((d) => {
    const ls = books.loans.filter((l) => l.display === d);
    return { d, n: ls.length, owed: ls.reduce((a, l) => a + l.payoff, 0) };
  }).filter((x) => x.n > 0);
  const rows: [string, number, string?][] = [
    [t("Capital added", "Capital agregado"), s.contributions],
    [t("Capital withdrawn", "Capital retirado"), -s.withdrawals],
    [t("Capital adjustments", "Ajustes de capital"), s.capitalAdjustments],
    [t("Outside income into capital", "Ingresos externos a capital"), s.capitalIncome],
    [t("Expenses paid from capital", "Gastos desde capital"), -s.capitalExpenses],
    [t("Capital invested", "Capital invertido"), netInvested(s), "total"],
    [t("Interest collected", "Interés cobrado"), s.interestCollected],
    [t("Late fees collected", "Mora cobrada"), s.feesCollected],
    [t("Other income", "Otros ingresos"), s.otherIncome],
    [t("Interest adjustments", "Ajustes de interés"), s.interestAdjustments],
    [t("Expenses paid from interest", "Gastos desde interés"), -s.interestExpenses],
    [t("Interest and fees due, unpaid", "Interés y mora vencidos sin pagar"), s.interestReceivable + s.feesReceivable],
    [t("Defaulted capital (written down)", "Capital incobrable (descontado)"), -s.defaultedPrincipal],
    [t("Portfolio gain", "Ganancia del portafolio"), gain(s), "total"],
  ];
  return (
    <div>
      <div className="topbar">
        <h1>{t("Reports", "Reportes")}</h1>
      </div>
      <Card>
        <div className="stats">
          <div className="stat lead">
            <div className="label">{t("Return on invested capital", "Rendimiento sobre capital invertido")}</div>
            <div className={`value ${gain(s) >= 0 ? "pos" : "neg"}`}>{ratioLabel(gain(s), netInvested(s)) ?? "—"}</div>
            <div className="caption">{t("Total, not annualized", "Total, no anualizado")}</div>
          </div>
          <div className="stat">
            <div className="label">{t("Income received", "Ingreso recibido")}</div>
            <div className="value">{fmt.money(realizedIncome(s))}</div>
          </div>
          <div className="stat">
            <div className="label">{t("Expenses", "Gastos")}</div>
            <div className="value">{fmt.money(totalExpenses(s))}</div>
          </div>
          <div className="stat">
            <div className="label">{t("Outside income", "Ingresos externos")}</div>
            <div className="value">{fmt.money(outsideIncome(s))}</div>
          </div>
          <div className="stat">
            <div className="label">{t("Lent in total", "Prestado en total")}</div>
            <div className="value">{fmt.money(s.principalDisbursed)}</div>
          </div>
          <div className="stat">
            <div className="label">{t("Capital repaid", "Capital devuelto")}</div>
            <div className="value">{fmt.money(s.principalRepaid)}</div>
          </div>
        </div>
      </Card>
      <div className="grid2 even" style={{ marginTop: 16 }}>
        <Card title={t("Capital and gain", "Capital y ganancia")}>
          <dl className="kv card-body">
            {rows.map(([label, v, cls]) => (
              <div key={label} style={{ display: "contents" }}>
                <dt className={cls}>{label}</dt>
                <dd className={cls}>{fmt.money(v)}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title={t("Loans by status", "Préstamos por estado")}>
          <ul className="list">
            {byStatus.map((x) => (
              <li key={x.d}>
                <div className="list-row">
                  <div className="grow">
                    <Pill tone={statusTone(x.d)}>{displayStatusLabel(t, x.d)}</Pill>
                  </div>
                  <div className="trail">
                    <span className="amount num">{fmt.money(x.owed)}</span>
                    <span className="micro muted">{x.n}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title={t("Monthly cash flow", "Flujo de caja mensual")} className="section">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("Month", "Mes")}</th>
                <th className="num">{t("Capital in", "Capital entra")}</th>
                <th className="num">{t("Capital out", "Capital sale")}</th>
                <th className="num">{t("Lent", "Prestado")}</th>
                <th className="num">{t("Capital back", "Capital devuelto")}</th>
                <th className="num">{t("Interest", "Interés")}</th>
                <th className="num">{t("Fees", "Mora")}</th>
                <th className="num">{t("Income", "Ingresos")}</th>
                <th className="num">{t("Expenses", "Gastos")}</th>
                <th className="num">{t("Net", "Neto")}</th>
                <th className="num">{t("Cash at end", "Efectivo al cierre")}</th>
              </tr>
            </thead>
            <tbody>
              {flows.map((f) => (
                <tr key={f.month}>
                  <td>{shortMonthYear(f.month, fmt.lang)}</td>
                  {[f.contributions, f.withdrawals, f.disbursed, f.principalReturned, f.interestReceived, f.feesReceived, f.income, f.expenses].map((v, i) => (
                    <td key={i} className="num">{v ? fmt.money(v) : "—"}</td>
                  ))}
                  <td className={`num ${monthNet(f) < 0 ? "neg" : ""}`}>{fmt.money(monthNet(f))}</td>
                  <td className="num strong">{fmt.money(f.endingCash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
