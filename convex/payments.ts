// Payments. Recording one is allowed for collectors and works offline: the
// device sends a unique operation id (so a retry never records it twice) and
// the loan version it saw. If the loan changed since — usually another
// device recorded a payment on it — the payment is held back as "stale"
// until the person confirms it with the current figures. The split is always
// worked out here, never trusted from the device.

import { v } from "convex/values";
import type { Instruction } from "../shared/domain/installments";
import { hasInstallments } from "../shared/domain/loans";
import { instructionFields } from "../shared/domain/records";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { checkVersion, ownRecord, requireMember } from "./lib/access";
import {
  checkCash,
  Diff,
  logChange,
  nextRecordNo,
  priorOperation,
  reallocate,
  rememberOperation,
  touchLoan,
} from "./lib/books";
import { fail } from "./lib/errors";
import { amount, day, notFuture, text } from "./lib/validate";

export const instruction = v.union(
  v.object({ kind: v.literal("auto") }),
  v.object({ kind: v.literal("installment"), seq: v.number() }),
  v.object({ kind: v.literal("spread"), parts: v.array(v.object({ seq: v.number(), amount: v.number() })) }),
  v.object({ kind: v.literal("custom"), principal: v.number(), interest: v.number(), fee: v.number() }),
);

function checkInstruction(i: Instruction, total: number) {
  if (i.kind === "spread") {
    if (i.parts.length === 0 || i.parts.length > 1000) fail("invalid", { field: "instruction", reason: "spread" });
    for (const p of i.parts) amount("instruction", p.amount);
    if (new Set(i.parts.map((p) => p.seq)).size !== i.parts.length) fail("invalid", { field: "instruction", reason: "spread" });
  }
  if (i.kind === "custom") {
    for (const x of [i.principal, i.interest, i.fee]) amount("instruction", x, { allowZero: true });
    if (i.principal + i.interest + i.fee !== total) fail("invalid", { field: "instruction", reason: "split" });
  }
}

function describe(p: Pick<Doc<"payments">, "mode" | "targetSeq" | "targets" | "custom">): string {
  switch (p.mode) {
    case "installment":
      return `installment ${p.targetSeq}`;
    case "spread":
      return `spread ${(p.targets ?? []).map((t) => `${t.seq}:${t.amount}`).join(",")}`;
    case "custom":
      return `custom ${p.custom?.principal}/${p.custom?.interest}/${p.custom?.fee}`;
    default:
      return "auto";
  }
}

export const record = mutation({
  args: {
    businessId: v.id("businesses"),
    opId: v.string(),
    loanId: v.id("loans"),
    /** The loan version the person saw when they entered the payment. */
    loanVersion: v.number(),
    /** They saw the loan's newer figures and still want it recorded. */
    confirmedStale: v.optional(v.boolean()),
    amount: v.number(),
    /** Extra fee entered with the payment (interest-only loans). */
    fee: v.number(),
    paidOn: v.string(),
    notes: v.string(),
    instruction,
    deviceRecordedAt: v.optional(v.number()),
  },
  handler: async (
    ctx,
    a,
  ): Promise<{ paymentId: Id<"payments">; duplicate: boolean; loanVersionBefore?: number; loanVersionAfter?: number }> => {
    const access = await requireMember(ctx, a.businessId, "record");
    const prior = await priorOperation(ctx, access, a.opId, "payment.record");
    if (prior) {
      return {
        paymentId: prior.resultId as Id<"payments">,
        duplicate: true,
        loanVersionBefore: prior.loanVersionBefore,
        loanVersionAfter: prior.loanVersionAfter,
      };
    }
    amount("amount", a.amount);
    amount("fee", a.fee, { allowZero: true });
    if (a.fee > a.amount) fail("invalid", { field: "fee", reason: "fee_too_large" });
    const paidOn = day("paidOn", a.paidOn);
    notFuture("paidOn", paidOn, access.today);
    const notes = text("notes", a.notes, 2000);
    const loan = await ownRecord(ctx, access, "loans", a.loanId);
    if (loan.status !== "active") fail("loan_closed");
    if (loan.version !== a.loanVersion && !a.confirmedStale) {
      const recent = (
        await ctx.db
          .query("payments")
          .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
          .collect()
      )
        .sort((x, y) => y.createdAt - x.createdAt)
        .slice(0, 3)
        .map((p) => ({ paidOn: p.paidOn, amount: p.amount, createdAt: p.createdAt }));
      fail("stale", { loanVersion: loan.version, seen: a.loanVersion, recent });
    }
    const installments = hasInstallments(loan.method);
    if (installments && a.fee > 0) fail("invalid", { field: "fee", reason: "automatic_late_fees" });
    if (!installments && a.instruction.kind !== "auto") fail("invalid", { field: "instruction", reason: "no_installments" });
    checkInstruction(a.instruction, a.amount);
    const now = Date.now();
    const paymentId = await ctx.db.insert("payments", {
      businessId: a.businessId,
      loanId: loan._id,
      recordNo: await nextRecordNo(ctx, access.business),
      paidOn,
      amount: a.amount,
      notes,
      ...instructionFields(a.instruction),
      feeInput: a.fee,
      // Placeholder split; reallocate() works out the real one below.
      principal: a.amount - a.fee,
      interest: 0,
      fee: a.fee,
      applied: [],
      recordedOffline: a.deviceRecordedAt !== undefined,
      deviceRecordedAt: a.deviceRecordedAt,
      createdAt: now,
      createdBy: access.userId,
      updatedAt: now,
      version: 1,
    });
    await reallocate(ctx, access, loan._id);
    await checkCash(ctx, a.businessId);
    await touchLoan(ctx, loan._id);
    const saved = (await ctx.db.get(paymentId))!;
    const d = new Diff()
      .added("amount", a.amount)
      .added("paid_on", paidOn)
      .added("allocation", describe(saved))
      .added("principal", saved.principal)
      .added("interest", saved.interest)
      .added("fee", saved.fee)
      .added("notes", notes);
    const reason = a.deviceRecordedAt ? (a.confirmedStale ? "Recorded offline; confirmed after the loan changed" : "Recorded offline") : "";
    await logChange(ctx, access, "payment", paymentId, "create", d, reason, { loanId: loan._id, opId: a.opId });
    const versions = { loanVersionBefore: loan.version, loanVersionAfter: loan.version + 1 };
    await rememberOperation(ctx, access, a.opId, "payment.record", paymentId, versions);
    return { paymentId, duplicate: false, ...versions };
  },
});

export const update = mutation({
  args: {
    businessId: v.id("businesses"),
    paymentId: v.id("payments"),
    expectedVersion: v.number(),
    amount: v.number(),
    fee: v.number(),
    paidOn: v.string(),
    notes: v.string(),
    instruction,
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "payments", a.paymentId);
    checkVersion(old, a.expectedVersion);
    amount("amount", a.amount);
    amount("fee", a.fee, { allowZero: true });
    if (a.fee > a.amount) fail("invalid", { field: "fee", reason: "fee_too_large" });
    const paidOn = day("paidOn", a.paidOn);
    notFuture("paidOn", paidOn, access.today);
    const notes = text("notes", a.notes, 2000);
    const loan = await ownRecord(ctx, access, "loans", old.loanId);
    const installments = hasInstallments(loan.method);
    if (installments && a.fee > 0) fail("invalid", { field: "fee", reason: "automatic_late_fees" });
    if (!installments && a.instruction.kind !== "auto") fail("invalid", { field: "instruction", reason: "no_installments" });
    checkInstruction(a.instruction, a.amount);
    const fields = instructionFields(a.instruction);
    const d = new Diff()
      .field("amount", old.amount, a.amount)
      .field("fee", old.feeInput, a.fee)
      .field("paid_on", old.paidOn, paidOn)
      .field("allocation", describe(old), describe(fields))
      .field("notes", old.notes, notes);
    if (d.empty) return;
    await ctx.db.patch(old._id, {
      amount: a.amount,
      feeInput: a.fee,
      paidOn,
      notes,
      ...fields,
      version: old.version + 1,
      updatedAt: Date.now(),
    });
    await reallocate(ctx, access, loan._id);
    await checkCash(ctx, a.businessId);
    await touchLoan(ctx, loan._id);
    await logChange(ctx, access, "payment", old._id, "update", d, text("reason", a.reason, 2000), { loanId: loan._id });
  },
});

export const remove = mutation({
  args: { businessId: v.id("businesses"), paymentId: v.id("payments"), expectedVersion: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "payments", a.paymentId);
    checkVersion(old, a.expectedVersion);
    const d = new Diff()
      .removed("amount", old.amount)
      .removed("interest", old.interest)
      .removed("principal", old.principal)
      .removed("fee", old.fee)
      .removed("paid_on", old.paidOn)
      .removed("notes", old.notes);
    await ctx.db.delete(old._id);
    await reallocate(ctx, access, old.loanId);
    await checkCash(ctx, a.businessId);
    await touchLoan(ctx, old.loanId);
    await logChange(ctx, access, "payment", old._id, "delete", d, text("reason", a.reason, 2000), { loanId: old.loanId });
  },
});
