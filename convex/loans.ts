// Loans (admins only, online only): creating, editing, deleting, defaults
// and late-fee waivers. Every change re-works every payment on the loan with
// the shared engine and is refused if anything stops adding up.

import { v } from "convex/values";
import type { ScheduleError } from "../shared/domain/installments";
import { validateTerms, type LoanTerms } from "../shared/domain/loans";
import { loanTerms, settleSchedule, type LoanRecord } from "../shared/domain/records";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { checkVersion, ownRecord, requireMember, type Access } from "./lib/access";
import {
  checkCash,
  Diff,
  ensureAvailable,
  loadRecords,
  logChange,
  nextRecordNo,
  reallocate,
  setStatus,
  touchLoan,
} from "./lib/books";
import { fail } from "./lib/errors";
import { day, notFuture, text } from "./lib/validate";
import { frequency, installment, method } from "./schema";

const terms = v.object({
  principal: v.number(),
  rate: v.number(),
  interestPeriod: frequency,
  frequency,
  startDate: v.string(),
  method,
  installments: v.union(v.number(), v.null()),
  lateFeeRate: v.number(),
});

function checkTerms(t: LoanTerms, today: string) {
  day("startDate", t.startDate);
  notFuture("startDate", t.startDate, today);
  const problem = validateTerms(t);
  if (problem) fail("invalid", { field: problem, reason: "terms" });
}

function schedule(t: LoanTerms, given: Doc<"loans">["schedule"] | null) {
  const r = settleSchedule(t, given);
  if (!r.ok) fail("schedule", { error: r.error as ScheduleError });
  return r.value;
}

/** "5|1300000": a schedule's size and total, for the change history. */
function scheduleSummary(s: Doc<"loans">["schedule"]): string {
  if (s.length === 0) return "";
  return `${s.length}|${s.reduce((t, x) => t + x.principal + x.interest, 0)}`;
}

async function activeClient(ctx: MutationCtx, access: Access, clientId: Id<"clients">, allowArchived: boolean) {
  const client = await ownRecord(ctx, access, "clients", clientId);
  if (client.archivedAt && !allowArchived) fail("archived_client");
  return client;
}

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    clientId: v.id("clients"),
    terms,
    schedule: v.union(v.array(installment), v.null()),
    notes: v.string(),
  },
  handler: async (ctx, a): Promise<Id<"loans">> => {
    const access = await requireMember(ctx, a.businessId, "manage");
    checkTerms(a.terms, access.today);
    const notes = text("notes", a.notes, 10_000);
    const s = schedule(a.terms, a.schedule);
    await activeClient(ctx, access, a.clientId, false);
    ensureAvailable(await loadRecords(ctx, a.businessId), a.terms.startDate, null, a.terms.principal);
    const now = Date.now();
    const loanId = await ctx.db.insert("loans", {
      businessId: a.businessId,
      recordNo: await nextRecordNo(ctx, access.business),
      clientId: a.clientId,
      ...a.terms,
      scheduleEdited: s.edited,
      schedule: s.schedule,
      status: "active",
      statusDate: a.terms.startDate,
      notes,
      createdAt: now,
      createdBy: access.userId,
      updatedAt: now,
      version: 1,
    });
    await ctx.db.insert("loanStatusEvents", {
      businessId: a.businessId,
      loanId,
      status: "active",
      occurredOn: a.terms.startDate,
      note: "Loan disbursed",
      createdAt: now,
      createdBy: access.userId,
    });
    await checkCash(ctx, a.businessId);
    const d = new Diff()
      .added("client", a.clientId)
      .added("principal", a.terms.principal)
      .added("rate", a.terms.rate)
      .added("interest_period", a.terms.interestPeriod)
      .added("frequency", a.terms.frequency)
      .added("method", a.terms.method)
      .added("installments", a.terms.installments)
      .added("late_fee_rate", a.terms.lateFeeRate)
      .added("start_date", a.terms.startDate)
      .added("schedule", scheduleSummary(s.schedule))
      .added("schedule_edited", s.edited ? "true" : "")
      .added("notes", notes);
    await logChange(ctx, access, "loan", loanId, "create", d, "", { loanId });
    return loanId;
  },
});

export const update = mutation({
  args: {
    businessId: v.id("businesses"),
    loanId: v.id("loans"),
    expectedVersion: v.number(),
    clientId: v.id("clients"),
    terms,
    /** null: keep the stored schedule when the terms that shape it are
     *  unchanged, otherwise use the proposed one. */
    schedule: v.union(v.array(installment), v.null()),
    notes: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "loans", a.loanId);
    checkVersion(old, a.expectedVersion);
    checkTerms(a.terms, access.today);
    const notes = text("notes", a.notes, 10_000);
    await activeClient(ctx, access, a.clientId, a.clientId === old.clientId);
    const oldTerms = loanTerms(old as unknown as LoanRecord);
    const shaping: (keyof LoanTerms)[] = ["principal", "rate", "interestPeriod", "frequency", "startDate", "method", "installments"];
    const shapingUnchanged = shaping.every((k) => a.terms[k] === oldTerms[k]);
    const s =
      a.schedule === null && shapingUnchanged && a.terms.method !== "interest_only"
        ? { schedule: old.schedule, edited: old.scheduleEdited }
        : schedule(a.terms, a.schedule);
    const d = new Diff()
      .field("client", old.clientId, a.clientId)
      .field("principal", old.principal, a.terms.principal)
      .field("rate", old.rate, a.terms.rate)
      .field("interest_period", old.interestPeriod, a.terms.interestPeriod)
      .field("frequency", old.frequency, a.terms.frequency)
      .field("method", old.method, a.terms.method)
      .field("installments", old.installments, a.terms.installments)
      .field("late_fee_rate", old.lateFeeRate, a.terms.lateFeeRate)
      .field("start_date", old.startDate, a.terms.startDate)
      .field("schedule", scheduleSummary(old.schedule), scheduleSummary(s.schedule))
      .field("schedule_edited", old.scheduleEdited, s.edited)
      .field("notes", old.notes, notes);
    if (d.empty && JSON.stringify(s.schedule) === JSON.stringify(old.schedule)) return;
    await ctx.db.patch(old._id, {
      clientId: a.clientId,
      ...a.terms,
      schedule: s.schedule,
      scheduleEdited: s.edited,
      notes,
    });
    await reallocate(ctx, access, old._id);
    await checkCash(ctx, a.businessId);
    await touchLoan(ctx, old._id);
    await logChange(ctx, access, "loan", old._id, "update", d, text("reason", a.reason, 2000), { loanId: old._id });
  },
});

export const remove = mutation({
  args: { businessId: v.id("businesses"), loanId: v.id("loans"), expectedVersion: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "loans", a.loanId);
    checkVersion(old, a.expectedVersion);
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_loan", (q) => q.eq("loanId", old._id))
      .collect();
    const d = new Diff()
      .removed("client", old.clientId)
      .removed("principal", old.principal)
      .removed("rate", old.rate)
      .removed("interest_period", old.interestPeriod)
      .removed("frequency", old.frequency)
      .removed("method", old.method)
      .removed("schedule", scheduleSummary(old.schedule))
      .removed("start_date", old.startDate)
      .removed("payments", payments.length)
      .removed("received", payments.reduce((t, p) => t + p.amount, 0))
      .removed("notes", old.notes);
    for (const p of payments) await ctx.db.delete(p._id);
    for (const f of await ctx.db
      .query("lateFees")
      .withIndex("by_loan", (q) => q.eq("loanId", old._id))
      .collect()) {
      await ctx.db.delete(f._id);
    }
    for (const e of await ctx.db
      .query("loanStatusEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", old._id))
      .collect()) {
      await ctx.db.delete(e._id);
    }
    await ctx.db.delete(old._id);
    await checkCash(ctx, a.businessId);
    await logChange(ctx, access, "loan", old._id, "delete", d, text("reason", a.reason, 2000), { loanId: old._id });
  },
});

export const markDefaulted = mutation({
  args: { businessId: v.id("businesses"), loanId: v.id("loans"), expectedVersion: v.number(), on: v.string(), note: v.string() },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const loan = await ownRecord(ctx, access, "loans", a.loanId);
    checkVersion(loan, a.expectedVersion);
    const on = day("on", a.on);
    notFuture("on", on, access.today);
    if (loan.status !== "active") fail("loan_not_active");
    if (on < loan.startDate) fail("invalid", { field: "on", reason: "before_start" });
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
      .collect();
    if (payments.some((p) => p.paidOn > on)) fail("invalid", { field: "on", reason: "before_last_payment" });
    const note = text("note", a.note, 2000);
    await setStatus(ctx, access, loan, "defaulted", on, note);
    await reallocate(ctx, access, loan._id);
    await touchLoan(ctx, loan._id);
    await logChange(ctx, access, "loan", loan._id, "update", new Diff().field("status", loan.status, "defaulted").field("status_date", loan.statusDate, on), note, { loanId: loan._id });
  },
});

export const reinstate = mutation({
  args: { businessId: v.id("businesses"), loanId: v.id("loans"), expectedVersion: v.number() },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const loan = await ownRecord(ctx, access, "loans", a.loanId);
    checkVersion(loan, a.expectedVersion);
    if (loan.status !== "defaulted") fail("loan_not_defaulted");
    await setStatus(ctx, access, loan, "active", access.today, "Reinstated");
    await reallocate(ctx, access, loan._id);
    await touchLoan(ctx, loan._id);
    await logChange(ctx, access, "loan", loan._id, "update", new Diff().field("status", "defaulted", "active"), "Reinstated", { loanId: loan._id });
  },
});

/** Waives (or restores) the late fee on one installment; payments on the
 *  loan are worked out again. */
export const setLateFeeWaived = mutation({
  args: {
    businessId: v.id("businesses"),
    loanId: v.id("loans"),
    expectedVersion: v.number(),
    seq: v.number(),
    waived: v.boolean(),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const loan = await ownRecord(ctx, access, "loans", a.loanId);
    checkVersion(loan, a.expectedVersion);
    const reason = text("reason", a.reason, 2000, { required: a.waived });
    const fee = await ctx.db
      .query("lateFees")
      .withIndex("by_loan", (q) => q.eq("loanId", loan._id).eq("seq", a.seq))
      .unique();
    if (!fee) fail("no_late_fee");
    if ((fee.waivedAt !== undefined) === a.waived) return;
    await ctx.db.patch(fee._id, {
      waivedAt: a.waived ? Date.now() : undefined,
      waiveReason: a.waived ? reason : "",
      updatedAt: Date.now(),
    });
    await reallocate(ctx, access, loan._id);
    await checkCash(ctx, a.businessId);
    await touchLoan(ctx, loan._id);
    await logChange(ctx, access, "late_fee", String(a.seq), "update", new Diff().field("waived", !a.waived, a.waived), reason, {
      loanId: loan._id,
    });
  },
});
