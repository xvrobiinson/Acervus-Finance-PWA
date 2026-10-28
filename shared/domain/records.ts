// From stored records to the engine and back: the desktop's services layer
// (src/services/mod.rs and lending.rs) without the database. The Convex
// mutations use it to work out and store every split; the app uses the same
// functions for previews and to show the books offline.

import { MAX_DAY, maxDay, type Day } from "./dates";
import {

  run,
  sameSchedule,
  type Applied,
  type Installment,
  type Instruction,
  type Plan,
  type PlanError,
  type PlanPayment,
  type PlanState,
  planPaidOff,
  proposedSchedule,
  checkSchedule,
  type ScheduleError,
} from "./installments";
import {
  allocate,
  paysOff,
  reallocate,
  type Allocation,
  type ContractStatus,
  type LoanFacts,
  type PaymentError,
  type PaymentFact,
  type Result,
} from "./ledger";
import { hasInstallments, type Frequency, type LoanTerms, type Method } from "./loans";
import { mulDiv, RATE_SCALE, sum, type Cents, type Rate } from "./money";
import type { Account, Book, CapitalKind, EntryKind, LoanBook } from "./portfolio";

export interface LoanRecord {
  _id: string;
  recordNo: number;
  clientId: string;
  principal: Cents;
  rate: Rate;
  interestPeriod: Frequency;
  frequency: Frequency;
  method: Method;
  installments: number | null;
  scheduleEdited: boolean;
  schedule: Installment[];
  lateFeeRate: Rate;
  startDate: Day;
  status: ContractStatus;
  statusDate: Day | null;
  notes?: string;
}

export type AllocationMode = "auto" | "installment" | "spread" | "custom";

export interface PaymentRecord {
  _id: string;
  loanId: string;
  recordNo: number;
  paidOn: Day;
  amount: Cents;
  mode: AllocationMode;
  targetSeq?: number;
  targets?: { seq: number; amount: Cents }[];
  custom?: { principal: Cents; interest: Cents; fee: Cents };
  feeInput: Cents;
  principal: Cents;
  interest: Cents;
  fee: Cents;
  applied: Applied[];
  notes?: string;
}

export interface LateFeeRecord {
  _id?: string;
  loanId: string;
  seq: number;
  assessedOn: Day;
  baseAmount: Cents;
  rate: Rate;
  amount: Cents;
  waivedAt?: number;
}

export interface CapitalRecord {
  _id: string;
  recordNo: number;
  kind: CapitalKind;
  amount: Cents;
  occurredOn: Day;
}

export interface EntryRecord {
  _id: string;
  recordNo: number;
  kind: EntryKind;
  account: Account;
  amount: Cents;
  occurredOn: Day;
}

export function loanTerms(l: LoanRecord): LoanTerms {
  return {
    principal: l.principal,
    rate: l.rate,
    interestPeriod: l.interestPeriod,
    frequency: l.frequency,
    startDate: l.startDate,
    method: l.method,
    installments: l.installments,
    lateFeeRate: l.lateFeeRate,
  };
}

export function termsFacts(t: LoanTerms): LoanFacts {
  return {
    principal: t.principal,
    rate: { rate: t.rate, per: t.interestPeriod, every: t.frequency },
    frequency: t.frequency,
    startDate: t.startDate,
    status: "active",
    closedOn: null,
  };
}

export function loanFacts(l: LoanRecord): LoanFacts {
  return {
    ...termsFacts(loanTerms(l)),
    status: l.status,
    closedOn: l.status === "defaulted" || l.status === "restructured" ? l.statusDate : null,
  };
}

export function planFor(l: LoanRecord, fees: LateFeeRecord[]): Plan | null {
  if (!hasInstallments(l.method)) return null;
  return {
    method: l.method,
    schedule: l.schedule,
    edited: l.scheduleEdited,
    feeRate: l.lateFeeRate,
    waived: fees.filter((f) => f.loanId === l._id && f.waivedAt !== undefined).map((f) => f.seq),
  };
}

/** Ledger order: by date, then by the order they were recorded. */
export function byLedgerOrder<T extends { paidOn: Day; recordNo: number }>(a: T, b: T): number {
  return a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : a.recordNo - b.recordNo;
}

export function paymentsOf(loanId: string, payments: PaymentRecord[]): PaymentRecord[] {
  return payments.filter((p) => p.loanId === loanId).sort(byLedgerOrder);
}

export function instructionOf(p: Pick<PaymentRecord, "mode" | "targetSeq" | "targets" | "custom">): Instruction {
  switch (p.mode) {
    case "installment":
      return { kind: "installment", seq: p.targetSeq ?? 0 };
    case "spread":
      return { kind: "spread", parts: p.targets ?? [] };
    case "custom":
      return { kind: "custom", ...(p.custom ?? { principal: 0, interest: 0, fee: 0 }) };
    default:
      return { kind: "auto" };
  }
}

/** The stored instruction fields for an instruction. */
export function instructionFields(i: Instruction): Pick<PaymentRecord, "mode" | "targetSeq" | "targets" | "custom"> {
  switch (i.kind) {
    case "installment":
      return { mode: "installment", targetSeq: i.seq, targets: undefined, custom: undefined };
    case "spread":
      return { mode: "spread", targetSeq: undefined, targets: i.parts, custom: undefined };
    case "custom":
      return {
        mode: "custom",
        targetSeq: undefined,
        targets: undefined,
        custom: { principal: i.principal, interest: i.interest, fee: i.fee },
      };
    default:
      return { mode: "auto", targetSeq: undefined, targets: undefined, custom: undefined };
  }
}

export function paymentFact(p: PaymentRecord): PaymentFact {
  return { paidOn: p.paidOn, principal: p.principal, interest: p.interest, fee: p.fee };
}

function storedPlanPayments(payments: PaymentRecord[]): PlanPayment[] {
  return payments.map((p) => ({ paidOn: p.paidOn, amount: p.amount, instruction: { kind: "fixed", applied: p.applied } }));
}

export function loanBook(l: LoanRecord, payments: PaymentRecord[], fees: LateFeeRecord[]): LoanBook {
  const own = paymentsOf(l._id, payments);
  const plan = planFor(l, fees);
  return {
    id: l._id,
    clientId: l.clientId,
    facts: loanFacts(l),
    payments: own.map(paymentFact),
    plan: plan ? { ...plan, payments: storedPlanPayments(own) } : null,
  };
}

const byRecordNo = <T extends { recordNo: number }>(a: T, b: T) => a.recordNo - b.recordNo;

export function buildBook(r: {
  loans: LoanRecord[];
  payments: PaymentRecord[];
  lateFees: LateFeeRecord[];
  capital: CapitalRecord[];
  entries: EntryRecord[];
}): Book {
  return {
    loans: [...r.loans].sort(byRecordNo).map((l) => loanBook(l, r.payments, r.lateFees)),
    capital: [...r.capital].sort(byRecordNo).map((c) => ({ kind: c.kind, amount: c.amount, occurredOn: c.occurredOn })),
    entries: [...r.entries]
      .sort(byRecordNo)
      .map((e) => ({ kind: e.kind, account: e.account, amount: e.amount, occurredOn: e.occurredOn })),
  };
}

/** The schedule to store for new or changed terms: the one given (checked)
 *  or the proposed one, and whether it differs from the proposed one. */
export function settleSchedule(
  terms: LoanTerms,
  given: Installment[] | null,
): Result<{ schedule: Installment[]; edited: boolean }, ScheduleError> {
  if (!hasInstallments(terms.method)) return { ok: true, value: { schedule: [], edited: false } };
  const proposed = proposedSchedule(termsFacts(terms), terms.method, terms.installments ?? 1);
  if (!given) return { ok: true, value: { schedule: proposed, edited: false } };
  const problem = checkSchedule(terms.principal, terms.startDate, given);
  if (problem) return { ok: false, error: problem };
  return { ok: true, value: { schedule: given, edited: !sameSchedule(given, proposed) } };
}

/** A late fee record that differs from what the loan's payments say. */
export type FeeChange =
  | { kind: "add"; seq: number; on: Day; base: Cents; amount: Cents }
  | { kind: "update"; old: LateFeeRecord; on: Day; base: Cents; amount: Cents }
  | { kind: "remove"; old: LateFeeRecord };

export function feeChangesFor(stored: LateFeeRecord[], loan: LoanRecord, state: PlanState): FeeChange[] {
  const rate = loan.lateFeeRate;
  const mine = stored.filter((f) => f.loanId === loan._id);
  const out: FeeChange[] = [];
  for (const x of state.installments) {
    const on = x.feeAssessedOn;
    if (on === null) continue;
    // The fee as assessed, before any waiver.
    const amount = mulDiv(x.feeBase, rate, RATE_SCALE);
    const f = mine.find((f) => f.seq === x.seq);
    if (!f) out.push({ kind: "add", seq: x.seq, on, base: x.feeBase, amount });
    else if (f.assessedOn !== on || f.baseAmount !== x.feeBase || f.rate !== rate || f.amount !== amount) {
      out.push({ kind: "update", old: f, on, base: x.feeBase, amount });
    }
  }
  for (const f of mine) {
    if (!state.installments.some((x) => x.seq === f.seq && x.feeAssessedOn !== null)) out.push({ kind: "remove", old: f });
  }
  return out;
}

/** Late fee changes due on `today` for a loan, with its stored splits. */
export function feeChangesToday(
  loan: LoanRecord,
  payments: PaymentRecord[],
  fees: LateFeeRecord[],
  today: Day,
): FeeChange[] {
  const plan = planFor(loan, fees);
  if (!plan) return [];
  const r = run(loanFacts(loan), plan, storedPlanPayments(paymentsOf(loan._id, payments)), today, today);
  return r.ok ? feeChangesFor(fees, loan, r.value) : [];
}

export interface SplitUpdate {
  paymentId: string;
  principal: Cents;
  interest: Cents;
  fee: Cents;
  applied: Applied[];
}

export type ReallocateError =
  | { kind: "payment"; paymentId: string; error: PaymentError }
  | { kind: "plan"; paymentId: string; error: PlanError };

export interface Reallocation {
  /** Payments whose stored split changes. */
  updates: SplitUpdate[];
  feeChanges: FeeChange[];
  /** The date the loan was paid off, or null when something is still owed. */
  paidOffOn: Day | null;
}

/** Works out every payment on a loan again from the loan as it is now (the
 *  desktop's reallocate_loan): the splits to store, the late fee records to
 *  bring in line and whether the loan is paid off. */
export function reallocateLoan(
  loan: LoanRecord,
  allPayments: PaymentRecord[],
  fees: LateFeeRecord[],
  today: Day,
): Result<Reallocation, ReallocateError> {
  const live = paymentsOf(loan._id, allPayments);
  if (!hasInstallments(loan.method)) {
    const r = reallocate(
      loanFacts(loan),
      live.map((p) => ({ paidOn: p.paidOn, amount: p.amount, fee: p.feeInput })),
      today,
    );
    if (!r.ok) return { ok: false, error: { kind: "payment", paymentId: live[r.error.index]._id, error: r.error.error } };
    const updates: SplitUpdate[] = [];
    live.forEach((p, i) => {
      const a = r.value[i];
      if (p.principal !== a.principal || p.interest !== a.interest || p.fee !== a.fee || p.applied.length > 0) {
        updates.push({ paymentId: p._id, principal: a.principal, interest: a.interest, fee: a.fee, applied: [] });
      }
    });
    const feeChanges: FeeChange[] = fees.filter((f) => f.loanId === loan._id).map((old) => ({ kind: "remove", old }));
    const last = r.value[r.value.length - 1];
    const paidOffOn = last && paysOff(last) ? live[live.length - 1].paidOn : null;
    return { ok: true, value: { updates, feeChanges, paidOffOn } };
  }
  const plan = planFor(loan, fees)!;
  const pays: PlanPayment[] = live.map((p) => ({ paidOn: p.paidOn, amount: p.amount, instruction: instructionOf(p) }));
  const asOf = live.length ? maxDay(today, live[live.length - 1].paidOn) : today;
  const r = run(loanFacts(loan), plan, pays, asOf, asOf);
  if (!r.ok) return { ok: false, error: { kind: "plan", paymentId: live[r.error.index]._id, error: r.error.error } };
  const state = r.value;
  const updates: SplitUpdate[] = [];
  live.forEach((p, i) => {
    const applied = state.payments[i];
    const totals = (k: "principal" | "interest" | "fee") => sum(applied.map((a) => a[k]));
    const next = { principal: totals("principal"), interest: totals("interest"), fee: totals("fee") };
    if (
      !sameApplied(p.applied, applied) ||
      p.principal !== next.principal ||
      p.interest !== next.interest ||
      p.fee !== next.fee
    ) {
      updates.push({ paymentId: p._id, ...next, applied });
    }
  });
  const paidOffOn = planPaidOff(state) && live.length ? live[live.length - 1].paidOn : null;
  return { ok: true, value: { updates, feeChanges: feeChangesFor(fees, loan, state), paidOffOn } };
}

function sameApplied(a: Applied[], b: Applied[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => x.seq === b[i].seq && x.principal === b[i].principal && x.interest === b[i].interest && x.fee === b[i].fee)
  );
}

/** The payments before a new one dated `on` (or before payment `editing`
 *  moved to `on`), in ledger order. */
function paymentsBefore(loanId: string, payments: PaymentRecord[], editing: string | null, on: Day): PaymentRecord[] {
  const editedNo = editing ? (payments.find((p) => p._id === editing)?.recordNo ?? Infinity) : Infinity;
  return paymentsOf(loanId, payments).filter(
    (p) => p._id !== editing && (p.paidOn < on || (p.paidOn === on && p.recordNo < editedNo)),
  );
}

/** How a payment on an interest-only loan would be split if recorded now
 *  (or, when `editing`, if that payment were changed). */
export function previewPayment(
  loan: LoanRecord,
  payments: PaymentRecord[],
  editing: string | null,
  amount: Cents,
  fee: Cents,
  on: Day,
  today: Day,
): Result<Allocation, PaymentError> {
  const facts = loanFacts(loan);
  const f = editing ? { ...facts, status: "active" as const, closedOn: null } : facts;
  return allocate(f, paymentsBefore(loan._id, payments, editing, on).map(paymentFact), amount, fee, on, today);
}

/** An installment loan as it stands right before a payment dated `on`. */
export function installmentStateBefore(
  loan: LoanRecord,
  payments: PaymentRecord[],
  fees: LateFeeRecord[],
  editing: string | null,
  on: Day,
  today: Day,
): PlanState | null {
  const plan = planFor(loan, fees);
  if (!plan) return null;
  const facts = editing ? { ...loanFacts(loan), status: "active" as const } : loanFacts(loan);
  const r = run(facts, plan, storedPlanPayments(paymentsBefore(loan._id, payments, editing, on)), on, maxDay(today, on));
  if (!r.ok) return null;
  // Interest of a period that begins on the payment date is charged after it.
  for (const x of r.value.installments) if (x.seq > 1 && x.starts === on && x.paidPrincipal + x.paidInterest + x.paidFee === 0) x.charged = false;
  return r.value;
}

/** How a payment on an installment loan would be applied, and the loan right
 *  after it. */
export function previewInstallmentPayment(
  loan: LoanRecord,
  payments: PaymentRecord[],
  fees: LateFeeRecord[],
  editing: string | null,
  amount: Cents,
  on: Day,
  instruction: Instruction,
  today: Day,
): Result<{ applied: Applied[]; state: PlanState }, PlanError> | null {
  const plan = planFor(loan, fees);
  if (!plan) return null;
  const facts = editing ? { ...loanFacts(loan), status: "active" as const } : loanFacts(loan);
  const pays = [...storedPlanPayments(paymentsBefore(loan._id, payments, editing, on)), { paidOn: on, amount, instruction }];
  const r = run(facts, plan, pays, on, today);
  if (!r.ok) return { ok: false, error: r.error.error };
  return { ok: true, value: { applied: r.value.payments[r.value.payments.length - 1] ?? [], state: r.value } };
}

/** The loan replayed with its stored splits up to `asOf` (installment loans). */
export function loanState(loan: LoanRecord, payments: PaymentRecord[], fees: LateFeeRecord[], asOf: Day): PlanState | null {
  const plan = planFor(loan, fees);
  if (!plan) return null;
  const r = run(loanFacts(loan), plan, storedPlanPayments(paymentsOf(loan._id, payments)), asOf, MAX_DAY);
  return r.ok ? r.value : null;
}

