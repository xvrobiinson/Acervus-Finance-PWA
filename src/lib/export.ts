// Exports a business's records as CSV files (one per table, amounts as plain
// decimals) or as one JSON file, for backups and spreadsheets. ID photos are
// never exported.

import type { Snapshot } from "../state/types";
import type { Books } from "../state/books";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote, and stop spreadsheet formulas from running (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
const dec = (cents: number) => (cents / 100).toFixed(2);

export function download(name: string, content: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function exportCsv(snap: Snapshot, books: Books) {
  const stamp = books.today;
  const clientName = (id: string) => books.clientById.get(id)?.client.fullName ?? "";
  download(
    `clients-${stamp}.csv`,
    csv([
      ["number", "name", "phone", "email", "id_number", "address", "archived", "capital_owed", "notes"],
      ...books.clients.map((c) => [c.client.recordNo, c.client.fullName, c.client.phone, c.client.email, c.client.idNumber, c.client.address, c.client.archivedAt ? "yes" : "", dec(c.outstanding), c.client.notes]),
    ]),
    "text/csv",
  );
  download(
    `loans-${stamp}.csv`,
    csv([
      ["loan", "client", "principal", "rate_pct", "interest_period", "frequency", "method", "installments", "late_fee_pct", "start_date", "status", "status_date", "display_status", "capital_owed", "payoff_now", "overdue", "notes"],
      ...books.loans.map((l) => [
        l.loan.recordNo, clientName(l.loan.clientId), dec(l.loan.principal), l.loan.rate / 10_000, l.loan.interestPeriod, l.loan.frequency, l.loan.method,
        l.loan.installments ?? "", l.loan.lateFeeRate / 10_000, l.loan.startDate, l.loan.status, l.loan.statusDate ?? "", l.display,
        dec(l.position.principalOutstanding), dec(l.payoff), dec(l.delinquency.overdueAmount), l.loan.notes,
      ]),
    ]),
    "text/csv",
  );
  download(
    `payments-${stamp}.csv`,
    csv([
      ["receipt", "loan", "client", "paid_on", "amount", "fee", "interest", "capital", "applied_as", "per_installment", "recorded_offline", "notes"],
      ...snap.payments.map((p) => {
        const l = books.loanById.get(p.loanId);
        return [
          p.recordNo, l?.loan.recordNo ?? "", l ? clientName(l.loan.clientId) : "", p.paidOn, dec(p.amount), dec(p.fee), dec(p.interest), dec(p.principal), p.mode,
          p.applied.map((a) => `#${a.seq}:${dec(a.principal + a.interest + a.fee)}`).join(" "), p.recordedOffline ? "yes" : "", p.notes,
        ];
      }),
    ]),
    "text/csv",
  );
  download(
    `money-${stamp}.csv`,
    csv([
      ["number", "date", "kind", "account", "amount", "description"],
      ...snap.capital.map((c) => [c.recordNo, c.occurredOn, c.kind, "capital", dec(c.amount), c.notes]),
      ...snap.entries.map((e) => [e.recordNo, e.occurredOn, e.kind, e.account, dec(e.amount), e.description]),
    ]),
    "text/csv",
  );
}

export function exportJson(snap: Snapshot, today: string) {
  const { settings, ...rest } = snap;
  const clean = settings ? { ...settings, logoUrl: undefined } : null;
  download(`acervus-${snap.business.name.replace(/[^\w-]+/g, "_")}-${today}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), ...rest, settings: clean }, null, 2), "application/json");
}
