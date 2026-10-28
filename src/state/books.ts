// Every figure the screens show, worked out on the device from the business's
// records with the shared engine (the same code the server runs), as of
// "today" in the business's time zone.

import type { Day } from "../../shared/domain/dates";
import type { InstallmentState, PlanState } from "../../shared/domain/installments";
import { DISPLAY_ORDER, displayStatus, payoff, type Delinquency, type DisplayStatus, type Position } from "../../shared/domain/ledger";
import {
  bookDelinquency,
  bookPlanState,
  bookPosition,
  interestReceivable,
  summary,
  type Book,
  type LoanBook,
  type Summary,
} from "../../shared/domain/portfolio";
import { buildBook, type LoanRecord, type PaymentRecord } from "../../shared/domain/records";
import type { Snapshot } from "./types";

export interface LoanView {
  loan: Snapshot["loans"][number];
  client: Snapshot["clients"][number] | undefined;
  book: LoanBook;
  position: Position;
  delinquency: Delinquency;
  display: DisplayStatus;
  /** Installment loans: every installment's state today. */
  plan: PlanState | null;
  payments: Snapshot["payments"];
  /** Everything owed now to close it. */
  payoff: number;
  interestReceivable: number;
}

export interface ClientView {
  client: Snapshot["clients"][number];
  loans: LoanView[];
  /** Capital still owed on their loans. */
  outstanding: number;
  overdue: number;
  paidTotal: number;
  worst: DisplayStatus | null;
}

export interface Books {
  today: Day;
  book: Book;
  summary: Summary;
  loans: LoanView[];
  loanById: Map<string, LoanView>;
  clients: ClientView[];
  clientById: Map<string, ClientView>;
}

export function computeBooks(snap: Snapshot, today: Day): Books {
  const records = {
    loans: snap.loans as unknown as LoanRecord[],
    payments: snap.payments as unknown as PaymentRecord[],
    lateFees: snap.lateFees as never,
    capital: snap.capital as never,
    entries: snap.entries as never,
  };
  const book = buildBook(records);
  const clientsById = new Map(snap.clients.map((c) => [c._id as string, c]));
  const loanRecords = new Map(snap.loans.map((l) => [l._id as string, l]));
  const loans: LoanView[] = book.loans.map((b) => {
    const loan = loanRecords.get(b.id)!;
    const position = bookPosition(b, today);
    const q = bookDelinquency(b, today);
    return {
      loan,
      client: clientsById.get(loan.clientId),
      book: b,
      position,
      delinquency: q,
      display: displayStatus(b.facts, q, today),
      plan: bookPlanState(b, today),
      payments: snap.payments.filter((p) => p.loanId === loan._id).sort((a, c) => (a.paidOn < c.paidOn ? -1 : a.paidOn > c.paidOn ? 1 : a.recordNo - c.recordNo)),
      payoff: payoff(position),
      interestReceivable: interestReceivable(position, today),
    };
  });
  const loanById = new Map(loans.map((l) => [l.loan._id as string, l]));
  const clients: ClientView[] = snap.clients.map((client) => {
    const own = loans.filter((l) => l.loan.clientId === client._id);
    const worst = own.length ? own.map((l) => l.display).sort((a, b) => DISPLAY_ORDER.indexOf(a) - DISPLAY_ORDER.indexOf(b))[0] : null;
    return {
      client,
      loans: own,
      outstanding: own.filter((l) => l.loan.status !== "defaulted").reduce((a, l) => a + l.position.principalOutstanding, 0),
      overdue: own.reduce((a, l) => a + l.delinquency.overdueAmount, 0),
      paidTotal: own.reduce((a, l) => a + l.position.paidTotal, 0),
      worst,
    };
  });
  return {
    today,
    book,
    summary: summary(book, today),
    loans,
    loanById,
    clients,
    clientById: new Map(clients.map((c) => [c.client._id as string, c])),
  };
}

/** Loans that need a look today: overdue first (most days), then due soon. */
export function needsAttention(b: Books): LoanView[] {
  return b.loans
    .filter((l) => l.display === "overdue" || l.display === "due_soon")
    .sort((x, y) =>
      x.display !== y.display
        ? DISPLAY_ORDER.indexOf(x.display) - DISPLAY_ORDER.indexOf(y.display)
        : y.delinquency.daysOverdue - x.delinquency.daysOverdue || (x.delinquency.nextDue ?? "").localeCompare(y.delinquency.nextDue ?? ""),
    );
}

export type { InstallmentState };
