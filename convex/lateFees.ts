// Late fees are worked out by the engine from each installment loan's
// payments, so the app always shows the right figure. This job also writes
// them down as records (with a change history entry when one changes) once
// they fall due, like the desktop app does at start-up and when the date
// changes. Safe to run any number of times.

import { v } from "convex/values";
import { todayIn } from "../shared/domain/dates";
import { hasInstallments } from "../shared/domain/loans";
import { feeChangesToday, type LoanRecord } from "../shared/domain/records";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { applyFeeChanges, engineRecords, loadRecords } from "./lib/books";

export const refreshAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    for await (const b of ctx.db.query("businesses")) {
      await ctx.scheduler.runAfter(0, internal.lateFees.refreshBusiness, { businessId: b._id });
    }
  },
});

export const refreshBusiness = internalMutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    const business = await ctx.db.get(a.businessId);
    if (!business) return 0;
    const today = todayIn(business.timezone);
    const r = await loadRecords(ctx, a.businessId);
    const e = engineRecords(r);
    // Changes are made in the name of the system, not a person.
    const access = {
      userId: "system",
      email: "",
      name: "Acervus Finance",
      business,
      member: null as never,
      today,
    };
    let n = 0;
    for (const loan of r.loans.filter((l) => hasInstallments(l.method))) {
      const changes = feeChangesToday(loan as unknown as LoanRecord, e.payments, e.lateFees, today);
      if (changes.length === 0) continue;
      await applyFeeChanges(ctx, access, loan, changes);
      n += changes.length;
    }
    return n;
  },
});
