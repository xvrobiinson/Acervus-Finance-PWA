// Server side of the ledger: loads a business's records, works out splits
// with the shared engine, keeps late fees and paid-off status in step, and
// refuses any write that would leave an account below zero at some point.
// Everything runs inside the calling mutation's transaction, so a refused
// change saves nothing.

import type { Day } from "../../shared/domain/dates";
import { availableFrom, shortfall, type Account } from "../../shared/domain/portfolio";
import {
  buildBook,
  reallocateLoan,
  type CapitalRecord,
  type EntryRecord,
  type FeeChange,
  type LateFeeRecord,
  type LoanRecord,
  type PaymentRecord,
} from "../../shared/domain/records";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Access } from "./access";
import { fail } from "./errors";

export interface Records {
  loans: Doc<"loans">[];
  payments: Doc<"payments">[];
  lateFees: Doc<"lateFees">[];
  capital: Doc<"capitalTxs">[];
  entries: Doc<"cashEntries">[];
}

export async function loadRecords(ctx: QueryCtx | MutationCtx, businessId: Id<"businesses">): Promise<Records> {
  const [loans, payments, lateFees, capital, entries] = await Promise.all([
    ctx.db.query("loans").withIndex("by_business", (q) => q.eq("businessId", businessId)).collect(),
    ctx.db.query("payments").withIndex("by_business", (q) => q.eq("businessId", businessId)).collect(),
    ctx.db.query("lateFees").withIndex("by_business", (q) => q.eq("businessId", businessId)).collect(),
    ctx.db.query("capitalTxs").withIndex("by_business", (q) => q.eq("businessId", businessId)).collect(),
    ctx.db.query("cashEntries").withIndex("by_business", (q) => q.eq("businessId", businessId)).collect(),
  ]);
  return { loans, payments, lateFees, capital, entries };
}

/** Plain engine records (ids as strings). */
export function engineRecords(r: Records) {
  return {
    loans: r.loans as unknown as LoanRecord[],
    payments: r.payments as unknown as PaymentRecord[],
    lateFees: r.lateFees as unknown as LateFeeRecord[],
    capital: r.capital as unknown as CapitalRecord[],
    entries: r.entries as unknown as EntryRecord[],
  };
}

/** Refuses a new outflow larger than what `account` (both accounts for a
 *  loan) can spare on `on` and after. */
export function ensureAvailable(r: Records, on: Day, account: Account | null, amount: number) {
  const available = availableFrom(buildBook(engineRecords(r)), on, account);
  if (amount > available) fail("insufficient_cash", { available: Math.max(available, 0), account });
}

/** Refuses a write that leaves an account below zero at any point. */
export async function checkCash(ctx: MutationCtx, businessId: Id<"businesses">) {
  const s = shortfall(buildBook(engineRecords(await loadRecords(ctx, businessId))));
  if (s) fail("cash_shortfall", { date: s.date, account: s.account, balance: s.balance });
}

export async function nextRecordNo(ctx: MutationCtx, business: Doc<"businesses">): Promise<number> {
  const fresh = (await ctx.db.get(business._id))!;
  await ctx.db.patch(business._id, { nextRecordNo: fresh.nextRecordNo + 1 });
  return fresh.nextRecordNo;
}

type Entity = Doc<"changeLog">["entity"];
type FieldChange = { field: string; old: string; new: string };

/** Field-by-field record of a change, for the change history. */
export class Diff {
  readonly changes: FieldChange[] = [];
  field(name: string, old: unknown, next: unknown): this {
    const [a, b] = [str(old), str(next)];
    if (a !== b) this.changes.push({ field: name, old: a, new: b });
    return this;
  }
  /** A deleted record's values. */
  removed(name: string, old: unknown): this {
    this.changes.push({ field: name, old: str(old), new: "" });
    return this;
  }
  /** A new record's values. */
  added(name: string, next: unknown): this {
    const b = str(next);
    if (b !== "") this.changes.push({ field: name, old: "", new: b });
    return this;
  }
  get empty() {
    return this.changes.length === 0;
  }
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export async function logChange(
  ctx: MutationCtx,
  access: Access,
  entity: Entity,
  entityId: string,
  action: "create" | "update" | "delete",
  diff: Diff,
  reason: string,
  extra: { loanId?: Id<"loans">; opId?: string } = {},
) {
  await ctx.db.insert("changeLog", {
    businessId: access.business._id,
    entity,
    entityId,
    loanId: extra.loanId,
    action,
    changes: diff.changes,
    reason: reason.trim().slice(0, 2000),
    userId: access.userId,
    userName: access.name,
    createdAt: Date.now(),
    opId: extra.opId,
  });
}

/** Applies the late fee record changes a loan's payments call for. */
export async function applyFeeChanges(ctx: MutationCtx, access: Access, loan: Doc<"loans">, changes: FeeChange[]) {
  const now = Date.now();
  for (const ch of changes) {
    if (ch.kind === "add") {
      await ctx.db.insert("lateFees", {
        businessId: loan.businessId,
        loanId: loan._id,
        seq: ch.seq,
        assessedOn: ch.on,
        baseAmount: ch.base,
        rate: loan.lateFeeRate,
        amount: ch.amount,
        waiveReason: "",
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }
    const old = ch.old as LateFeeRecord & { _id: Id<"lateFees"> };
    if (ch.kind === "update") {
      await ctx.db.patch(old._id, { assessedOn: ch.on, baseAmount: ch.base, rate: loan.lateFeeRate, amount: ch.amount, updatedAt: now });
      const d = new Diff().field("amount", old.amount, ch.amount).field("fee_base", old.baseAmount, ch.base);
      await logChange(ctx, access, "late_fee", String(old.seq), "update", d, "Recalculated after a change", { loanId: loan._id });
    } else {
      await ctx.db.delete(old._id);
      const d = new Diff().removed("amount", old.amount).removed("fee_base", old.baseAmount);
      await logChange(ctx, access, "late_fee", String(old.seq), "delete", d, "No longer overdue after a change", {
        loanId: loan._id,
      });
    }
  }
}

async function setStatus(
  ctx: MutationCtx,
  access: Access,
  loan: Doc<"loans">,
  status: Doc<"loans">["status"],
  on: Day,
  note: string,
) {
  await ctx.db.patch(loan._id, { status, statusDate: on });
  await ctx.db.insert("loanStatusEvents", {
    businessId: loan.businessId,
    loanId: loan._id,
    status,
    occurredOn: on,
    note,
    createdAt: Date.now(),
    createdBy: access.userId,
  });
}

export { setStatus };

/** Works out every payment on a loan again and stores the splits, late fees
 *  and paid-off status (the desktop's reallocate_loan). Fails with the first
 *  payment that no longer fits. */
export async function reallocate(ctx: MutationCtx, access: Access, loanId: Id<"loans">) {
  const loan = (await ctx.db.get(loanId))!;
  const r = await loadRecords(ctx, access.business._id);
  const e = engineRecords(r);
  const result = reallocateLoan(loan as unknown as LoanRecord, e.payments, e.lateFees, access.today);
  if (!result.ok) {
    const p = r.payments.find((x) => x._id === result.error.paymentId)!;
    fail(result.error.kind, { paidOn: p.paidOn, amount: p.amount, error: result.error.error });
  }
  for (const u of result.value.updates) {
    await ctx.db.patch(u.paymentId as Id<"payments">, {
      principal: u.principal,
      interest: u.interest,
      fee: u.fee,
      applied: u.applied,
    });
  }
  await applyFeeChanges(ctx, access, loan, result.value.feeChanges);
  const paidOffOn = result.value.paidOffOn;
  if (loan.status === "active" && paidOffOn) await setStatus(ctx, access, loan, "paid_off", paidOffOn, "Paid in full");
  else if (loan.status === "paid_off" && paidOffOn && loan.statusDate !== paidOffOn) {
    await setStatus(ctx, access, loan, "paid_off", paidOffOn, "Paid in full");
  } else if (loan.status === "paid_off" && !paidOffOn) {
    await setStatus(ctx, access, loan, "active", access.today, "Reopened after a change");
  }
}

/** Marks the loan as changed, for edits on other devices to notice. */
export async function touchLoan(ctx: MutationCtx, loanId: Id<"loans">) {
  const loan = (await ctx.db.get(loanId))!;
  await ctx.db.patch(loanId, { version: loan.version + 1, updatedAt: Date.now() });
}

/** The result of an operation already applied under this id, if any. */
export async function priorOperation(
  ctx: MutationCtx,
  access: Access,
  opId: string,
  kind: string,
): Promise<Doc<"operations"> | null> {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(opId)) fail("invalid", { field: "opId" });
  const op = await ctx.db
    .query("operations")
    .withIndex("by_op", (q) => q.eq("businessId", access.business._id).eq("opId", opId))
    .unique();
  if (!op) return null;
  if (op.kind !== kind) fail("invalid", { field: "opId" });
  return op;
}

export async function rememberOperation(
  ctx: MutationCtx,
  access: Access,
  opId: string,
  kind: string,
  resultId: string,
  versions: { loanVersionBefore?: number; loanVersionAfter?: number } = {},
) {
  await ctx.db.insert("operations", {
    businessId: access.business._id,
    opId,
    kind,
    userId: access.userId,
    resultId,
    ...versions,
    createdAt: Date.now(),
  });
}
