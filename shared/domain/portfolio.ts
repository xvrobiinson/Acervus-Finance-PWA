// Portfolio accounting: the two cash accounts, portfolio value, returns,
// history and monthly cash flow, all derived from recorded transactions.
// Ported from the desktop app (src/domain/portfolio.rs).
//
// - Cash is held in two accounts. Available capital receives capital added
//   and the capital part of payments; available interest receives interest
//   and fees. A loan is paid from capital first, then interest.
// - Net capital invested = contributions − withdrawals + capital adjustments
//   + capital income − expenses paid from capital.
// - Portfolio value = both accounts + capital owed on performing loans +
//   interest earned and not yet collected + late fees receivable.
// - Portfolio gain = portfolio value − net capital invested.

import { addDays, addMonths, daysBetween, monthStart, MAX_DAY, type Day } from "./dates";
import {
  delinquency as ledgerDelinquency,
  displayStatus,
  emptyPosition,
  payoff,
  position as ledgerPosition,
  type Delinquency,
  type DisplayStatus,
  type LoanFacts,
  type PaymentFact,
  type Position,
} from "./ledger";
import { planDelinquency, planPosition, run, type Plan, type PlanPayment, type PlanState } from "./installments";
import { convertPerPeriod, periodInterest } from "./loans";
import type { Cents } from "./money";

export type CapitalKind = "contribution" | "withdrawal";
/** The two places cash is kept. */
export type Account = "capital" | "interest";
export const ACCOUNTS: Account[] = ["capital", "interest"];
export const otherAccount = (a: Account): Account => (a === "capital" ? "interest" : "capital");

/** Cash movements that are not loans, payments or capital. */
export type EntryKind = "expense" | "income" | "transfer" | "adjustment";

export interface CapitalFact {
  kind: CapitalKind;
  amount: Cents;
  occurredOn: Day;
}

export interface EntryFact {
  kind: EntryKind;
  /** Expense: the account that paid. Transfer: the account money left.
   *  Adjustment: the account corrected. Income: the account it went into. */
  account: Account;
  /** Positive for expenses, income and transfers; signed for adjustments. */
  amount: Cents;
  occurredOn: Day;
}

/** One loan with everything needed to evaluate it. */
export interface LoanBook {
  id: string;
  clientId: string;
  facts: LoanFacts;
  /** Payment totals (capital, interest, fees) in ledger order. */
  payments: PaymentFact[];
  /** Installment schedule and stored splits; `null` for interest-only loans. */
  plan: (Plan & { payments: PlanPayment[] }) | null;
}

/** The installment loan replayed to the end of `asOf`. */
export function bookPlanState(l: LoanBook, asOf: Day): PlanState | null {
  if (!l.plan) return null;
  const r = run(l.facts, l.plan, l.plan.payments, asOf, MAX_DAY);
  return r.ok ? r.value : null;
}

export function bookPosition(l: LoanBook, asOf: Day): Position {
  if (l.plan) {
    const s = bookPlanState(l, asOf);
    return s ? planPosition(s) : emptyPosition();
  }
  return ledgerPosition(l.facts, l.payments, asOf);
}

export function bookDelinquency(l: LoanBook, today: Day): Delinquency {
  if (l.plan) {
    const s = bookPlanState(l, today);
    return s
      ? planDelinquency(s, l.facts.status, today)
      : { overdueAmount: 0, daysOverdue: 0, overdueSince: null, nextDue: null, nextDueAmount: 0 };
  }
  return ledgerDelinquency(l.facts, l.payments, today);
}

export function bookDisplayStatus(l: LoanBook, today: Day): DisplayStatus {
  return displayStatus(l.facts, bookDelinquency(l, today), today);
}

/** The interest the loan produces per month at its current capital. */
export function monthlyInterest(l: LoanBook, pos: Position): Cents {
  const perPeriod =
    l.plan && l.plan.method === "flat" && pos.principalOutstanding > 0
      ? periodInterest(l.facts.rate, l.facts.principal)
      : periodInterest(l.facts.rate, pos.principalOutstanding);
  return convertPerPeriod(perPeriod, l.facts.frequency, "monthly");
}

/** Status as it was on `asOf`: a loan defaulted later was still performing
 *  before its default date. */
function performingOn(l: LoanBook, asOf: Day): boolean {
  if (l.facts.status === "defaulted") return l.facts.closedOn !== null && asOf < l.facts.closedOn;
  return true;
}

/** Interest earned (periods past their due date) and not yet collected. */
export function interestReceivable(pos: Position, asOf: Day): Cents {
  let earned = 0;
  for (const p of pos.periods) if (p.due <= asOf) earned += p.interest;
  return Math.max(earned - pos.interestPaid, 0);
}

export interface Book {
  loans: LoanBook[];
  capital: CapitalFact[];
  entries: EntryFact[];
}

export interface Balances {
  capital: Cents;
  interest: Cents;
}

export const balanceTotal = (b: Balances) => b.capital + b.interest;

/** The first point at which an account would hold less than nothing. */
export interface Shortfall {
  date: Day;
  /** The account that went below zero, or `null` for a loan larger than both
   *  accounts together. */
  account: Account | null;
  balance: Cents;
}

type Move =
  | { kind: "add"; account: Account; amount: Cents }
  | { kind: "transfer"; from: Account; amount: Cents }
  | { kind: "lend"; amount: Cents };

/** Every cash movement in the order it is applied: date order, and within a
 *  day money in before money out (capital, adjustments and income; payments;
 *  transfers; loans; expenses; withdrawals). Equal keys keep recorded order. */
function moves(book: Book): [Day, number, Move][] {
  const out: [Day, number, Move][] = [];
  for (const c of book.capital) {
    if (c.kind === "contribution") out.push([c.occurredOn, 0, { kind: "add", account: "capital", amount: c.amount }]);
    else out.push([c.occurredOn, 5, { kind: "add", account: "capital", amount: -c.amount }]);
  }
  for (const e of book.entries) {
    switch (e.kind) {
      case "adjustment":
      case "income":
        out.push([e.occurredOn, 0, { kind: "add", account: e.account, amount: e.amount }]);
        break;
      case "transfer":
        out.push([e.occurredOn, 2, { kind: "transfer", from: e.account, amount: e.amount }]);
        break;
      case "expense":
        out.push([e.occurredOn, 4, { kind: "add", account: e.account, amount: -e.amount }]);
        break;
    }
  }
  for (const l of book.loans) {
    out.push([l.facts.startDate, 3, { kind: "lend", amount: l.facts.principal }]);
    for (const p of l.payments) {
      out.push([p.paidOn, 1, { kind: "add", account: "capital", amount: p.principal }]);
      out.push([p.paidOn, 1, { kind: "add", account: "interest", amount: p.interest + p.fee }]);
    }
  }
  // Array.prototype.sort is stable, like Rust's sort_by_key.
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  return out;
}

/** Replays every movement, calling `visit` with the balances after each.
 *  Stops early when `visit` returns false. */
function replayCash(book: Book, visit: (date: Day, m: Move, b: Balances) => boolean) {
  const b: Balances = { capital: 0, interest: 0 };
  for (const [date, , m] of moves(book)) {
    switch (m.kind) {
      case "add":
        b[m.account] += m.amount;
        break;
      case "transfer":
        b[m.from] -= m.amount;
        b[m.from === "capital" ? "interest" : "capital"] += m.amount;
        break;
      case "lend": {
        const fromCapital = Math.min(m.amount, Math.max(b.capital, 0));
        b.capital -= fromCapital;
        b.interest -= m.amount - fromCapital;
        break;
      }
    }
    if (!visit(date, m, { ...b })) return;
  }
}

/** Account balances at the end of `asOf`. */
export function balancesOn(book: Book, asOf: Day): Balances {
  let last: Balances = { capital: 0, interest: 0 };
  replayCash(book, (d, _m, b) => {
    if (d > asOf) return false;
    last = b;
    return true;
  });
  return last;
}

export function cashOn(book: Book, asOf: Day): Cents {
  return balanceTotal(balancesOn(book, asOf));
}

/** The most a new outflow dated `from` could take without leaving `account`
 *  (both accounts together when `null`, as for a loan) below zero then or at
 *  any later point. */
export function availableFrom(book: Book, from: Day, account: Account | null): Cents {
  const pick = (b: Balances) => (account === null ? balanceTotal(b) : b[account]);
  let low = pick(balancesOn(book, from));
  replayCash(book, (d, _m, b) => {
    if (d > from) low = Math.min(low, pick(b));
    return true;
  });
  return low;
}

/** The first point where recorded movements leave an account below zero. */
export function shortfall(book: Book): Shortfall | null {
  let found: Shortfall | null = null;
  replayCash(book, (date, m, b) => {
    if (b.capital >= 0 && b.interest >= 0) return true;
    if (m.kind === "lend") found = { date, account: null, balance: balanceTotal(b) };
    else if (b.capital < 0) found = { date, account: "capital", balance: b.capital };
    else found = { date, account: "interest", balance: b.interest };
    return false;
  });
  return found;
}

export interface Summary {
  contributions: Cents;
  withdrawals: Cents;
  principalDisbursed: Cents;
  principalRepaid: Cents;
  interestCollected: Cents;
  feesCollected: Cents;
  capitalExpenses: Cents;
  interestExpenses: Cents;
  /** Outside income put into available capital (counts as invested). */
  capitalIncome: Cents;
  /** Outside income put into available interest (counts as income). */
  otherIncome: Cents;
  capitalAdjustments: Cents;
  interestAdjustments: Cents;
  availableCapital: Cents;
  availableInterest: Cents;
  availableCash: Cents;
  /** Capital owed on performing (non-defaulted) loans. */
  outstandingPrincipal: Cents;
  interestReceivable: Cents;
  feesReceivable: Cents;
  defaultedPrincipal: Cents;
  defaultedInterest: Cents;
  portfolioValue: Cents;
  activeLoans: number;
  overdueLoans: number;
  dueSoonLoans: number;
  overdueAmount: Cents;
  /** Interest active loans produce per month at their current capital. */
  expectedMonthlyInterest: Cents;
}

export const netInvested = (s: Summary) =>
  s.contributions - s.withdrawals + s.capitalAdjustments + s.capitalIncome - s.capitalExpenses;
export const gain = (s: Summary) => s.portfolioValue - netInvested(s);
export const totalReceived = (s: Summary) => s.principalRepaid + s.interestCollected + s.feesCollected;
export const realizedIncome = (s: Summary) => s.interestCollected + s.feesCollected;
export const totalExpenses = (s: Summary) => s.capitalExpenses + s.interestExpenses;
export const outsideIncome = (s: Summary) => s.capitalIncome + s.otherIncome;
export const totalIncome = (s: Summary) => realizedIncome(s) + s.otherIncome;

function emptySummary(): Summary {
  return {
    contributions: 0, withdrawals: 0, principalDisbursed: 0, principalRepaid: 0, interestCollected: 0,
    feesCollected: 0, capitalExpenses: 0, interestExpenses: 0, capitalIncome: 0, otherIncome: 0,
    capitalAdjustments: 0, interestAdjustments: 0, availableCapital: 0, availableInterest: 0, availableCash: 0,
    outstandingPrincipal: 0, interestReceivable: 0, feesReceivable: 0, defaultedPrincipal: 0, defaultedInterest: 0,
    portfolioValue: 0, activeLoans: 0, overdueLoans: 0, dueSoonLoans: 0, overdueAmount: 0, expectedMonthlyInterest: 0,
  };
}

/** The portfolio at the end of `asOf`, with delinquency judged against
 *  `asOf` as "today". */
export function summary(book: Book, asOf: Day): Summary {
  const s = emptySummary();
  for (const c of book.capital) {
    if (c.occurredOn > asOf) continue;
    if (c.kind === "contribution") s.contributions += c.amount;
    else s.withdrawals += c.amount;
  }
  for (const e of book.entries) {
    if (e.occurredOn > asOf) continue;
    if (e.kind === "expense") {
      if (e.account === "capital") s.capitalExpenses += e.amount;
      else s.interestExpenses += e.amount;
    } else if (e.kind === "income") {
      if (e.account === "capital") s.capitalIncome += e.amount;
      else s.otherIncome += e.amount;
    } else if (e.kind === "adjustment") {
      if (e.account === "capital") s.capitalAdjustments += e.amount;
      else s.interestAdjustments += e.amount;
    }
  }
  for (const loan of book.loans) {
    if (loan.facts.startDate > asOf) continue;
    s.principalDisbursed += loan.facts.principal;
    const pos = bookPosition(loan, asOf);
    s.principalRepaid += pos.principalPaid;
    s.interestCollected += pos.interestPaid;
    s.feesCollected += pos.feesPaid;
    if (performingOn(loan, asOf)) {
      s.outstandingPrincipal += pos.principalOutstanding;
      s.interestReceivable += interestReceivable(pos, asOf);
      s.feesReceivable += pos.feesOutstanding;
    } else {
      s.defaultedPrincipal += pos.principalOutstanding;
      s.defaultedInterest += interestReceivable(pos, asOf);
    }
    if (loan.facts.status === "active" && payoff(pos) > 0) {
      s.activeLoans += 1;
      const q = bookDelinquency(loan, asOf);
      s.overdueAmount += q.overdueAmount;
      const ds = displayStatus(loan.facts, q, asOf);
      if (ds === "overdue") s.overdueLoans += 1;
      else if (ds === "due_soon") s.dueSoonLoans += 1;
      s.expectedMonthlyInterest += monthlyInterest(loan, pos);
    }
  }
  const b = balancesOn(book, asOf);
  s.availableCapital = b.capital;
  s.availableInterest = b.interest;
  s.availableCash = balanceTotal(b);
  s.portfolioValue = s.availableCash + s.outstandingPrincipal + s.interestReceivable + s.feesReceivable;
  return s;
}

export function firstActivity(book: Book): Day | null {
  let first: Day | null = null;
  const see = (d: Day) => {
    if (first === null || d < first) first = d;
  };
  book.capital.forEach((c) => see(c.occurredOn));
  book.loans.forEach((l) => see(l.facts.startDate));
  book.entries.forEach((e) => see(e.occurredOn));
  return first;
}

export interface HistoryPoint {
  date: Day;
  portfolioValue: Cents;
  netInvested: Cents;
  interestCollected: Cents;
}

/** Daily or weekly points between `from` and `to` (inclusive), always
 *  including `to`. Values are real end-of-day positions, never interpolated. */
export function history(book: Book, from: Day, to: Day): HistoryPoint[] {
  if (from > to) return [];
  const days = daysBetween(from, to);
  const step = days <= 120 ? 1 : days <= 400 ? 3 : 7;
  const point = (d: Day): HistoryPoint => {
    const s = summary(book, d);
    return { date: d, portfolioValue: s.portfolioValue, netInvested: netInvested(s), interestCollected: s.interestCollected };
  };
  const out: HistoryPoint[] = [];
  for (let d = from; d < to; d = addDays(d, step)) out.push(point(d));
  out.push(point(to));
  return out;
}

export interface MonthFlow {
  month: Day;
  contributions: Cents;
  withdrawals: Cents;
  disbursed: Cents;
  principalReturned: Cents;
  interestReceived: Cents;
  feesReceived: Cents;
  expenses: Cents;
  /** Outside income, into either account. */
  income: Cents;
  endingCash: Cents;
}

export const monthNet = (f: MonthFlow) =>
  f.contributions - f.withdrawals - f.disbursed + f.principalReturned + f.interestReceived + f.feesReceived + f.income - f.expenses;

/** Cash flow per calendar month from the first activity through `to`. Capital
 *  adjustments count as capital in or out, interest adjustments as interest;
 *  transfers cancel out. */
export function monthlyCashFlow(book: Book, to: Day): MonthFlow[] {
  const first = firstActivity(book);
  if (first === null) return [];
  const months = new Map<Day, MonthFlow>();
  for (let m = monthStart(first); m <= to; m = addMonths(m, 1)) {
    months.set(m, {
      month: m, contributions: 0, withdrawals: 0, disbursed: 0, principalReturned: 0,
      interestReceived: 0, feesReceived: 0, expenses: 0, income: 0, endingCash: 0,
    });
  }
  const at = (d: Day) => months.get(monthStart(d));
  for (const c of book.capital) {
    const f = c.occurredOn <= to ? at(c.occurredOn) : undefined;
    if (!f) continue;
    if (c.kind === "contribution") f.contributions += c.amount;
    else f.withdrawals += c.amount;
  }
  for (const e of book.entries) {
    const f = e.occurredOn <= to ? at(e.occurredOn) : undefined;
    if (!f) continue;
    if (e.kind === "expense") f.expenses += e.amount;
    else if (e.kind === "income") f.income += e.amount;
    else if (e.kind === "adjustment") {
      if (e.account === "capital") {
        if (e.amount > 0) f.contributions += e.amount;
        else f.withdrawals -= e.amount;
      } else f.interestReceived += e.amount;
    }
  }
  for (const l of book.loans) {
    if (l.facts.startDate > to) continue;
    const f = at(l.facts.startDate);
    if (f) f.disbursed += l.facts.principal;
    for (const p of l.payments) {
      const g = p.paidOn <= to ? at(p.paidOn) : undefined;
      if (!g) continue;
      g.principalReturned += p.principal;
      g.interestReceived += p.interest;
      g.feesReceived += p.fee;
    }
  }
  let cash = 0;
  return [...months.values()].map((f) => {
    cash += monthNet(f);
    f.endingCash = cash;
    return f;
  });
}
