// Installment loans: a fixed number of installments, each repaying part of
// the capital plus the period's interest, with a late fee charged once on an
// installment still unpaid after its due date. Ported line for line from the
// desktop app (src/domain/installments.rs).
//
// - Installment k's period runs from the previous due date (or the loan date)
//   to its own due date. Its interest is charged when the period begins: on
//   the capital still owed then (declining), on the original principal
//   (flat), or as written when the schedule was edited. No interest is
//   charged once the capital is repaid.
// - A payment dated on a due date belongs to the period ending that day.
// - The day after its due date, an installment with capital or interest still
//   unpaid is charged a late fee of feeRate × that unpaid amount, once.
// - Payments are applied by one of four instructions: oldest first, to one
//   installment, spread with chosen amounts, or a custom split between
//   capital, interest and late fees (each oldest first).

import { addDays, daysBetween, type Day } from "./dates";
import {
  emptyDelinquency,
  type ContractStatus,
  type Delinquency,
  type LoanFacts,
  type Position,
  type Result,
} from "./ledger";
import { dueDate, periodInterest, type Method } from "./loans";
import { mulDiv, RATE_SCALE, sum, type Cents, type Rate } from "./money";

/** One scheduled installment: due date, the capital it repays and its interest. */
export interface Installment {
  seq: number;
  due: Day;
  principal: Cents;
  interest: Cents;
}

export function installmentTotal(x: Installment): Cents {
  return x.principal + x.interest;
}

/** The schedule for new terms, assuming every installment is paid on time:
 *  equal capital each time (the last takes the rounding remainder), interest
 *  on the capital owed when each period begins (declining) or on the original
 *  principal (flat). */
export function proposedSchedule(facts: LoanFacts, method: Method, count: number): Installment[] {
  const n = Math.max(count, 1);
  const base = Math.trunc(facts.principal / n);
  let balance = facts.principal;
  const out: Installment[] = [];
  for (let k = 1; k <= n; k++) {
    const principal = k === n ? balance : base;
    const interest =
      method === "flat" ? periodInterest(facts.rate, facts.principal) : periodInterest(facts.rate, balance);
    balance -= principal;
    out.push({ seq: k, due: dueDate(facts.frequency, facts.startDate, k), principal, interest });
  }
  return out;
}

export type ScheduleError =
  | { code: "empty" }
  | { code: "unallocated"; allocated: Cents; principal: Cents }
  | { code: "negative"; seq: number }
  | { code: "date_order"; seq: number };

/** Checks an edited schedule: capital adds up to the principal, nothing is
 *  negative and due dates move forward. */
export function checkSchedule(principal: Cents, start: Day, schedule: Installment[]): ScheduleError | null {
  if (schedule.length === 0) return { code: "empty" };
  let prev = start;
  for (const x of schedule) {
    if (!Number.isSafeInteger(x.principal) || !Number.isSafeInteger(x.interest) || x.principal < 0 || x.interest < 0) {
      return { code: "negative", seq: x.seq };
    }
    if (x.due <= prev) return { code: "date_order", seq: x.seq };
    prev = x.due;
  }
  const allocated = sum(schedule.map((x) => x.principal));
  if (allocated !== principal) return { code: "unallocated", allocated, principal };
  return null;
}

export function sameSchedule(a: Installment[], b: Installment[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => x.seq === b[i].seq && x.due === b[i].due && x.principal === b[i].principal && x.interest === b[i].interest)
  );
}

/** One part of what is owed. */
export type Part = "fee" | "interest" | "principal";

/** What part of a payment went to one installment. */
export interface Applied {
  seq: number;
  principal: Cents;
  interest: Cents;
  fee: Cents;
}

export function appliedTotal(a: Applied): Cents {
  return a.principal + a.interest + a.fee;
}

/** How a payment is applied. */
export type Instruction =
  /** Oldest first: late fee, interest, then capital of each installment. */
  | { kind: "auto" }
  /** To one installment only, which may be left partly paid. */
  | { kind: "installment"; seq: number }
  /** Chosen amounts per installment. */
  | { kind: "spread"; parts: { seq: number; amount: Cents }[] }
  /** Chosen amounts to capital, interest and late fees, each oldest first. */
  | { kind: "custom"; principal: Cents; interest: Cents; fee: Cents }
  /** Splits already worked out and stored, replayed as recorded. */
  | { kind: "fixed"; applied: Applied[] };

export interface PlanPayment {
  paidOn: Day;
  amount: Cents;
  instruction: Instruction;
}

/** An installment loan's schedule and recorded payments. */
export interface Plan {
  method: Method;
  schedule: Installment[];
  /** Edited by hand: the scheduled interest is used as written. */
  edited: boolean;
  feeRate: Rate;
  /** Installments whose late fee was waived. */
  waived: number[];
}

export interface InstallmentState {
  seq: number;
  starts: Day;
  due: Day;
  /** Capital this installment repays. */
  principal: Cents;
  /** Interest charged when its period began, or projected before that. */
  interest: Cents;
  charged: boolean;
  /** Capital owed when its period began (once charged). */
  balanceAtStart: Cents;
  fee: Cents;
  /** What was unpaid when the late fee was assessed. */
  feeBase: Cents;
  feeAssessedOn: Day | null;
  feeWaived: boolean;
  paidPrincipal: Cents;
  paidInterest: Cents;
  paidFee: Cents;
}

export type InstallmentStatus = "overdue" | "partly_paid" | "due" | "upcoming" | "paid";

export const unpaidPrincipal = (x: InstallmentState): Cents => x.principal - x.paidPrincipal;
/** Interest owed now (none before the period begins). */
export const unpaidInterest = (x: InstallmentState): Cents => (x.charged ? x.interest - x.paidInterest : 0);
export const unpaidFee = (x: InstallmentState): Cents => x.fee - x.paidFee;
/** Everything owed on it right now. */
export const owed = (x: InstallmentState): Cents => unpaidPrincipal(x) + unpaidInterest(x) + unpaidFee(x);
/** Its full amount: capital, interest (charged or projected) and late fee. */
export const totalDue = (x: InstallmentState): Cents => x.principal + x.interest + x.fee;
export const paidAmount = (x: InstallmentState): Cents => x.paidPrincipal + x.paidInterest + x.paidFee;
/** What remains of its full amount. */
export const remaining = (x: InstallmentState): Cents => totalDue(x) - paidAmount(x);

function unpaid(x: InstallmentState, part: Part): Cents {
  return part === "fee" ? unpaidFee(x) : part === "interest" ? unpaidInterest(x) : unpaidPrincipal(x);
}

function pay(x: InstallmentState, part: Part, amount: Cents) {
  if (part === "fee") x.paidFee += amount;
  else if (part === "interest") x.paidInterest += amount;
  else x.paidPrincipal += amount;
}

export function installmentStatus(x: InstallmentState, today: Day): InstallmentStatus {
  if (remaining(x) <= 0) return "paid";
  if (x.due < today) return "overdue";
  if (paidAmount(x) > 0) return "partly_paid";
  if (x.starts <= today) return "due";
  return "upcoming";
}

export type PlanError =
  | { code: "not_positive" }
  | { code: "in_future" }
  | { code: "before_start" }
  | { code: "loan_closed" }
  /** More than everything owed now. */
  | { code: "overpayment"; payoff: Cents }
  /** More than one installment owes now. */
  | { code: "exceeds_installment"; seq: number; owed: Cents }
  | { code: "no_such_installment"; seq: number }
  /** Chosen amounts don't add up to the payment. */
  | { code: "split_mismatch"; allocated: Cents; amount: Cents }
  /** More of one part than is owed. */
  | { code: "exceeds_part"; part: Part; owed: Cents };

/** The loan after replaying its payments: every installment's state and how
 *  each payment was applied. */
export interface PlanState {
  principal: Cents;
  installments: InstallmentState[];
  payments: Applied[][];
  paidTotal: Cents;
  lastPayment: Day | null;
}

export const principalPaid = (s: PlanState) => sum(s.installments.map((x) => x.paidPrincipal));
export const principalOutstanding = (s: PlanState) => s.principal - principalPaid(s);
export const interestPaid = (s: PlanState) => sum(s.installments.map((x) => x.paidInterest));
export const feesPaid = (s: PlanState) => sum(s.installments.map((x) => x.paidFee));
export const feesAssessed = (s: PlanState) => sum(s.installments.map((x) => x.fee));
/** Scheduled interest: charged so far plus projected. */
export const interestTotal = (s: PlanState) => sum(s.installments.map((x) => x.interest));
/** Everything owed now to close the loan: capital, interest charged and late fees. */
export const planPayoff = (s: PlanState) => sum(s.installments.map(owed));
export const planPaidOff = (s: PlanState) => principalOutstanding(s) <= 0 && planPayoff(s) <= 0;

export function planPosition(s: PlanState): Position {
  const charged = s.installments.filter((x) => x.charged);
  return {
    principalOutstanding: principalOutstanding(s),
    interestOutstanding: sum(charged.map((x) => x.interest - x.paidInterest)),
    interestChargedTotal: sum(charged.map((x) => x.interest)),
    interestPaid: interestPaid(s),
    principalPaid: principalPaid(s),
    feesPaid: feesPaid(s),
    feesOutstanding: sum(s.installments.map(unpaidFee)),
    paidTotal: s.paidTotal,
    lastEvent: s.lastPayment,
    periods: charged.map((x) => ({ seq: x.seq, starts: x.starts, due: x.due, balance: x.balanceAtStart, interest: x.interest })),
  };
}

/** Delinquency as of `today` (the state must be run to `today`). */
export function planDelinquency(s: PlanState, status: ContractStatus, today: Day): Delinquency {
  if (status !== "active" || planPaidOff(s)) return emptyDelinquency();
  const q = emptyDelinquency();
  for (const x of s.installments) {
    if (x.due < today && owed(x) > 0) {
      q.overdueAmount += owed(x);
      if (q.overdueSince === null) {
        q.overdueSince = x.due;
        q.daysOverdue = daysBetween(x.due, today);
      }
    }
  }
  const next = s.installments.find((x) => x.due >= today && remaining(x) > 0);
  if (next) {
    q.nextDue = next.due;
    q.nextDueAmount = q.overdueAmount + remaining(next);
  } else if (q.overdueAmount > 0) {
    // Past the last due date: everything left is overdue now.
    q.nextDue = today;
    q.nextDueAmount = q.overdueAmount;
  }
  return q;
}

class Engine {
  st: InstallmentState[];
  constructor(
    private facts: LoanFacts,
    private plan: Plan,
    st: InstallmentState[],
    /** No interest or fees after a default date. */
    private limit: Day | null,
  ) {
    this.st = st;
  }

  outstanding(): Cents {
    return sum(this.st.map(unpaidPrincipal));
  }

  interestFor(k: number, balance: Cents): Cents {
    if (balance <= 0) return 0;
    if (this.plan.method === "declining" && !this.plan.edited) return periodInterest(this.facts.rate, balance);
    return this.plan.schedule[k].interest;
  }

  /** Charges every period that has begun at `at` (strictly before it when
   *  `strict`) and assesses late fees on installments due before `at`. */
  advance(at: Day, strict: boolean) {
    for (let k = 0; k < this.st.length; k++) {
      if (!this.st[k].charged) {
        const starts = this.st[k].starts;
        const started = k === 0 || !strict ? starts <= at : starts < at;
        if (started && (this.limit === null || starts <= this.limit)) {
          const balance = this.outstanding();
          const interest = this.interestFor(k, balance);
          const s = this.st[k];
          s.interest = interest;
          s.charged = true;
          s.balanceAtStart = balance;
        }
      }
      const s = this.st[k];
      if (s.feeAssessedOn === null && s.charged && s.due < at && (this.limit === null || s.due < this.limit)) {
        const base = unpaidPrincipal(s) + unpaidInterest(s);
        if (base > 0 && this.plan.feeRate > 0) {
          const fee = mulDiv(base, this.plan.feeRate, RATE_SCALE);
          s.feeBase = base;
          s.fee = s.feeWaived ? 0 : fee;
          s.feeAssessedOn = addDays(s.due, 1);
        }
      }
    }
  }

  /** Projected interest of periods not yet begun, assuming the remaining
   *  capital is repaid as scheduled. */
  project() {
    for (let k = 0; k < this.st.length; k++) {
      if (!this.st[k].charged) {
        const balance = sum(this.st.slice(k).map(unpaidPrincipal));
        this.st[k].interest = this.interestFor(k, balance);
      }
    }
  }

  index(seq: number): Result<number, PlanError> {
    const i = this.st.findIndex((x) => x.seq === seq);
    return i < 0 ? { ok: false, error: { code: "no_such_installment", seq } } : { ok: true, value: i };
  }

  /** Takes up to `amount` of `part` from installment `k`; returns what was taken. */
  take(k: number, part: Part, amount: Cents, out: Applied[]): Cents {
    const a = Math.max(Math.min(amount, unpaid(this.st[k], part)), 0);
    if (a > 0) {
      pay(this.st[k], part, a);
      const seq = this.st[k].seq;
      let entry = out.find((x) => x.seq === seq);
      if (!entry) {
        entry = { seq, principal: 0, interest: 0, fee: 0 };
        out.push(entry);
      }
      entry[part] += a;
    }
    return a;
  }

  /** Late fee, interest, then capital of one installment. */
  fill(k: number, amount: Cents, out: Applied[]): Cents {
    for (const part of ["fee", "interest", "principal"] as Part[]) amount -= this.take(k, part, amount, out);
    return amount;
  }

  apply(p: PlanPayment): Result<Applied[], PlanError> {
    const out: Applied[] = [];
    const fail = (error: PlanError): Result<Applied[], PlanError> => ({ ok: false, error });
    const ins = p.instruction;
    switch (ins.kind) {
      case "auto": {
        let left = p.amount;
        for (let k = 0; k < this.st.length; k++) left = this.fill(k, left, out);
        if (left > 0) return fail({ code: "overpayment", payoff: p.amount - left });
        break;
      }
      case "installment": {
        const k = this.index(ins.seq);
        if (!k.ok) return k;
        const left = this.fill(k.value, p.amount, out);
        if (left > 0) return fail({ code: "exceeds_installment", seq: ins.seq, owed: p.amount - left });
        break;
      }
      case "spread": {
        const allocated = sum(ins.parts.map((x) => x.amount));
        if (allocated !== p.amount) return fail({ code: "split_mismatch", allocated, amount: p.amount });
        for (const { seq, amount } of ins.parts) {
          const k = this.index(seq);
          if (!k.ok) return k;
          const left = this.fill(k.value, amount, out);
          if (left > 0) return fail({ code: "exceeds_installment", seq, owed: amount - left });
        }
        break;
      }
      case "custom": {
        const allocated = ins.principal + ins.interest + ins.fee;
        if (allocated !== p.amount) return fail({ code: "split_mismatch", allocated, amount: p.amount });
        for (const [part, amount] of [
          ["fee", ins.fee],
          ["interest", ins.interest],
          ["principal", ins.principal],
        ] as [Part, Cents][]) {
          if (amount < 0) return fail({ code: "not_positive" });
          let left = amount;
          for (let k = 0; k < this.st.length; k++) left -= this.take(k, part, left, out);
          if (left > 0) return fail({ code: "exceeds_part", part, owed: amount - left });
        }
        break;
      }
      case "fixed": {
        const total = sum(ins.applied.map(appliedTotal));
        if (total !== p.amount) return fail({ code: "split_mismatch", allocated: total, amount: p.amount });
        for (const a of ins.applied) {
          const k = this.index(a.seq);
          if (!k.ok) return k;
          for (const [part, amount] of [
            ["fee", a.fee],
            ["interest", a.interest],
            ["principal", a.principal],
          ] as [Part, Cents][]) {
            if (this.take(k.value, part, amount, out) !== amount) {
              return fail({ code: "exceeds_part", part, owed: unpaid(this.st[k.value], part) });
            }
          }
        }
        break;
      }
    }
    out.sort((a, b) => a.seq - b.seq);
    return { ok: true, value: out };
  }
}

/** Replays `payments` (sorted by date, then recorded order) on an installment
 *  loan up to the end of `asOf`. Payments after `asOf` are ignored. On failure
 *  returns the index of the first payment that doesn't fit and why. */
export function run(
  facts: LoanFacts,
  plan: Plan,
  payments: PlanPayment[],
  asOf: Day,
  today: Day,
): Result<PlanState, { index: number; error: PlanError }> {
  const limit = (facts.status === "defaulted" || facts.status === "restructured") && facts.closedOn ? facts.closedOn : null;
  const st: InstallmentState[] = plan.schedule.map((x, i) => ({
    seq: x.seq,
    starts: i === 0 ? facts.startDate : plan.schedule[i - 1].due,
    due: x.due,
    principal: x.principal,
    interest: x.interest,
    charged: false,
    balanceAtStart: 0,
    fee: 0,
    feeBase: 0,
    feeAssessedOn: null,
    feeWaived: plan.waived.includes(x.seq),
    paidPrincipal: 0,
    paidInterest: 0,
    paidFee: 0,
  }));
  const e = new Engine(facts, plan, st, limit);
  const out: PlanState = { principal: facts.principal, installments: [], payments: [], paidTotal: 0, lastPayment: null };
  if (asOf < facts.startDate) {
    e.project();
    out.installments = e.st;
    return { ok: true, value: out };
  }
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    if (p.paidOn > asOf) break;
    const fail = (error: PlanError) => ({ ok: false as const, error: { index: i, error } });
    if (p.amount <= 0) return fail({ code: "not_positive" });
    if (p.paidOn < facts.startDate) return fail({ code: "before_start" });
    if (p.paidOn > today) return fail({ code: "in_future" });
    if (limit !== null && p.paidOn > limit) return fail({ code: "loan_closed" });
    e.advance(p.paidOn, true);
    const applied = e.apply(p);
    if (!applied.ok) return fail(applied.error);
    out.payments.push(applied.value);
    out.paidTotal += p.amount;
    out.lastPayment = p.paidOn;
  }
  e.advance(asOf, false);
  e.project();
  out.installments = e.st;
  return { ok: true, value: out };
}
