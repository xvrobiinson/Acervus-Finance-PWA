// The loan engine for interest-only loans: a loan's position on any date,
// payment allocation and delinquency, as pure functions over plain data.
// Ported line for line from the desktop app (src/domain/ledger.rs); rules are
// in docs/ACCOUNTING.md.
//
// Each period's interest is the loan's rate times the capital owed when the
// period begins. It is charged at the start of the period and due by its end.
// Payments go to fees (as entered), then to interest owed (oldest first), then
// to capital. A capital payment lowers the interest of the *next* period.

import { daysBetween, MAX_DAY, type Day } from "./dates";
import { dueDate, periodInterest, periodStart, type Frequency, type PeriodRate } from "./loans";
import type { Cents } from "./money";

export type ContractStatus = "active" | "paid_off" | "defaulted" | "restructured";
export const CONTRACT_STATUSES: ContractStatus[] = ["active", "paid_off", "defaulted", "restructured"];

/** What people see: the contract status combined with delinquency. */
export type DisplayStatus = "overdue" | "due_soon" | "active" | "defaulted" | "restructured" | "paid_off";
export const DISPLAY_ORDER: DisplayStatus[] = ["overdue", "due_soon", "active", "defaulted", "restructured", "paid_off"];

/** Days before a due date at which a payment is flagged "Due soon". */
export const DUE_SOON_DAYS = 5;

export interface LoanFacts {
  principal: Cents;
  /** The quoted rate and its conversion to the payment period. */
  rate: PeriodRate;
  /** How often payments fall due (each period's length). */
  frequency: Frequency;
  startDate: Day;
  status: ContractStatus;
  /** Date a loan was defaulted or restructured: no new interest after it. */
  closedOn: Day | null;
}

/** A recorded payment with its stored split. */
export interface PaymentFact {
  paidOn: Day;
  principal: Cents;
  interest: Cents;
  fee: Cents;
}

export function factTotal(p: PaymentFact): Cents {
  return p.principal + p.interest + p.fee;
}

/** One charged period. */
export interface Period {
  seq: number;
  starts: Day;
  due: Day;
  /** Capital owed when the period began. */
  balance: Cents;
  interest: Cents;
}

export interface Position {
  principalOutstanding: Cents;
  /** Interest charged and not yet paid. */
  interestOutstanding: Cents;
  interestChargedTotal: Cents;
  interestPaid: Cents;
  principalPaid: Cents;
  feesPaid: Cents;
  /** Late fees assessed and not yet paid (installment loans). */
  feesOutstanding: Cents;
  paidTotal: Cents;
  lastEvent: Day | null;
  periods: Period[];
}

export function emptyPosition(): Position {
  return {
    principalOutstanding: 0,
    interestOutstanding: 0,
    interestChargedTotal: 0,
    interestPaid: 0,
    principalPaid: 0,
    feesPaid: 0,
    feesOutstanding: 0,
    paidTotal: 0,
    lastEvent: null,
    periods: [],
  };
}

export function payoff(p: Position): Cents {
  return p.principalOutstanding + p.interestOutstanding + p.feesOutstanding;
}

type Cutoff = "end_of_day" | "before_payment";

function chargeLimit(loan: LoanFacts): Day {
  return (loan.status === "defaulted" || loan.status === "restructured") && loan.closedOn ? loan.closedOn : MAX_DAY;
}

function replay(loan: LoanFacts, payments: PaymentFact[], at: Day, cutoff: Cutoff): Position {
  if (at < loan.startDate) return emptyPosition();
  const chargeUntil = chargeLimit(loan);
  const pos = emptyPosition();
  pos.principalOutstanding = loan.principal;
  let nextSeq = 1;

  // Charge every period that has started at `at` (strictly before it when
  // `strict`), on the capital owed at that moment.
  const chargeThrough = (when: Day, strict: boolean) => {
    for (;;) {
      const k = nextSeq;
      const starts = periodStart(loan.frequency, loan.startDate, k);
      const started = k === 1 ? starts <= when : strict ? starts < when : starts <= when;
      if (!started || starts > chargeUntil || pos.principalOutstanding <= 0) break;
      const interest = periodInterest(loan.rate, pos.principalOutstanding);
      pos.periods.push({
        seq: k,
        starts,
        due: dueDate(loan.frequency, loan.startDate, k),
        balance: pos.principalOutstanding,
        interest,
      });
      pos.interestOutstanding += interest;
      pos.interestChargedTotal += interest;
      nextSeq += 1;
    }
  };

  for (const p of payments) {
    if (p.paidOn > at) continue;
    // Payments dated on a due date belong to the period ending then.
    chargeThrough(p.paidOn, true);
    pos.interestOutstanding -= p.interest;
    pos.principalOutstanding -= p.principal;
    pos.interestPaid += p.interest;
    pos.principalPaid += p.principal;
    pos.feesPaid += p.fee;
    pos.paidTotal += factTotal(p);
    pos.lastEvent = p.paidOn;
  }
  chargeThrough(at, cutoff === "before_payment");
  return pos;
}

/** The loan's position at the end of `asOf`. Payments sorted by date, then
 *  by the order they were recorded. */
export function position(loan: LoanFacts, payments: PaymentFact[], asOf: Day): Position {
  return replay(loan, payments, asOf, "end_of_day");
}

/** What a client owes at the moment of a payment on `on`. */
export function owedAtPayment(loan: LoanFacts, payments: PaymentFact[], on: Day): Position {
  return replay(loan, payments, on, "before_payment");
}

export interface Allocation {
  interest: Cents;
  principal: Cents;
  fee: Cents;
  /** Capital owed before this payment. */
  principalBefore: Cents;
  principalAfter: Cents;
  interestAfter: Cents;
}

export function paysOff(a: Allocation): boolean {
  return a.principalAfter === 0 && a.interestAfter === 0;
}

export type PaymentError =
  | { code: "not_positive" }
  | { code: "overpayment"; payoff: Cents }
  | { code: "before_start" }
  | { code: "before_last_payment"; last: Day }
  | { code: "in_future" }
  | { code: "loan_closed" }
  | { code: "fee_too_large" };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Allocates a payment received on `paidOn`: fee as entered, then interest
 *  owed, then capital. Amounts above what is owed are refused. */
export function allocate(
  loan: LoanFacts,
  payments: PaymentFact[],
  amount: Cents,
  fee: Cents,
  paidOn: Day,
  today: Day,
): Result<Allocation, PaymentError> {
  if (amount <= 0) return { ok: false, error: { code: "not_positive" } };
  if (fee < 0 || fee > amount) return { ok: false, error: { code: "fee_too_large" } };
  if (loan.status !== "active") return { ok: false, error: { code: "loan_closed" } };
  if (paidOn < loan.startDate) return { ok: false, error: { code: "before_start" } };
  if (paidOn > today) return { ok: false, error: { code: "in_future" } };
  let last: Day | null = null;
  for (const p of payments) if (last === null || p.paidOn > last) last = p.paidOn;
  if (last !== null && paidOn < last) return { ok: false, error: { code: "before_last_payment", last } };
  const pos = replay(loan, payments, paidOn, "before_payment");
  const available = amount - fee;
  if (available > payoff(pos)) return { ok: false, error: { code: "overpayment", payoff: payoff(pos) + fee } };
  const interest = Math.min(available, Math.max(pos.interestOutstanding, 0));
  const principal = Math.min(available - interest, pos.principalOutstanding);
  return {
    ok: true,
    value: {
      interest,
      principal,
      fee,
      principalBefore: pos.principalOutstanding,
      principalAfter: pos.principalOutstanding - principal,
      interestAfter: pos.interestOutstanding - interest,
    },
  };
}

/** A recorded payment before its split is known. */
export interface PaymentInput {
  paidOn: Day;
  amount: Cents;
  fee: Cents;
}

/** Splits every payment on a loan again, oldest first, from the loan's
 *  current terms. On failure returns the index of the first payment that no
 *  longer fits and why. */
export function reallocate(
  loan: LoanFacts,
  payments: PaymentInput[],
  today: Day,
): Result<Allocation[], { index: number; error: PaymentError }> {
  // Payments are allowed up to a default date; the split itself is the one
  // an active loan would have.
  const open: LoanFacts = { ...loan, status: "active", closedOn: null };
  const limit = (loan.status === "defaulted" || loan.status === "restructured") && loan.closedOn ? loan.closedOn : null;
  const facts: PaymentFact[] = [];
  const out: Allocation[] = [];
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    if (limit !== null && p.paidOn > limit) return { ok: false, error: { index: i, error: { code: "loan_closed" } } };
    // After a payoff nothing is owed, so a later payment is refused as an
    // overpayment.
    const a = allocate(open, facts, p.amount, p.fee, p.paidOn, today);
    if (!a.ok) return { ok: false, error: { index: i, error: a.error } };
    facts.push({ paidOn: p.paidOn, principal: a.value.principal, interest: a.value.interest, fee: a.value.fee });
    out.push(a.value);
  }
  return { ok: true, value: out };
}

export interface Delinquency {
  /** Interest (and, for installment loans, capital and fees) past due and unpaid. */
  overdueAmount: Cents;
  daysOverdue: number;
  /** Due date of the oldest unpaid period that is past due. */
  overdueSince: Day | null;
  /** The next due date, today or later. */
  nextDue: Day | null;
  /** Everything that must be paid by that date to be current. */
  nextDueAmount: Cents;
}

export function emptyDelinquency(): Delinquency {
  return { overdueAmount: 0, daysOverdue: 0, overdueSince: null, nextDue: null, nextDueAmount: 0 };
}

/** Delinquency as of `today`. Interest paid covers periods oldest first; a
 *  period is overdue the day after its due date if its interest is not
 *  covered. */
export function delinquency(loan: LoanFacts, payments: PaymentFact[], today: Day): Delinquency {
  if (loan.status !== "active") return emptyDelinquency();
  const pos = position(loan, payments, today);
  if (payoff(pos) <= 0) return emptyDelinquency();
  const result = emptyDelinquency();
  let cumulative = 0;
  let pastDue = 0;
  for (const p of pos.periods) {
    cumulative += p.interest;
    if (p.due < today) {
      pastDue = cumulative;
      if (result.overdueSince === null && pos.interestPaid < cumulative) {
        result.overdueSince = p.due;
        result.daysOverdue = daysBetween(p.due, today);
      }
    } else if (result.nextDue === null && pos.interestPaid < cumulative) {
      result.nextDue = p.due;
      result.nextDueAmount = cumulative - pos.interestPaid;
    }
  }
  result.overdueAmount = Math.max(pastDue - pos.interestPaid, 0);
  if (result.nextDue === null) {
    // Everything charged by now is paid (or only overdue interest is left):
    // the next payment is the next period's interest plus anything overdue.
    const k = pos.periods.length > 0 ? pos.periods[pos.periods.length - 1].seq + 1 : 1;
    result.nextDue = dueDate(loan.frequency, loan.startDate, k);
    result.nextDueAmount = Math.max(cumulative - pos.interestPaid, 0) + periodInterest(loan.rate, pos.principalOutstanding);
  }
  return result;
}

export function displayStatus(loan: LoanFacts, q: Delinquency, today: Day): DisplayStatus {
  switch (loan.status) {
    case "paid_off":
      return "paid_off";
    case "defaulted":
      return "defaulted";
    case "restructured":
      return "restructured";
    case "active":
      if (q.overdueAmount > 0) return "overdue";
      if (q.nextDueAmount > 0 && q.nextDue !== null && daysBetween(today, q.nextDue) <= DUE_SOON_DAYS) return "due_soon";
      return "active";
  }
}

/** Coverage of a charged period by interest paid so far. */
export type PeriodState = "paid" | "partly_paid" | "overdue" | "open";

/** The state of each charged period, oldest first, with what was paid on it. */
export function periodStates(pos: Position, today: Day): { period: Period; state: PeriodState; paid: Cents }[] {
  let cumulative = 0;
  return pos.periods.map((p) => {
    const before = cumulative;
    cumulative += p.interest;
    const paid = Math.min(Math.max(pos.interestPaid - before, 0), p.interest);
    const state: PeriodState =
      paid >= p.interest ? "paid" : p.due < today ? "overdue" : paid > 0 ? "partly_paid" : "open";
    return { period: p, state, paid };
  });
}
