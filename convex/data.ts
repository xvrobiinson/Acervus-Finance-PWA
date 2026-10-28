// What the app shows, in one reactive query per business: every record the
// figures are worked out from (on the device, with the same engine the
// server uses). The app also keeps the last copy for offline use. Client ID
// photos are not included — only whether one is on file.

import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireMember } from "./lib/access";
import { loadRecords } from "./lib/books";

export const snapshot = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "read");
    const [records, clients, settings, members, statusEvents] = await Promise.all([
      loadRecords(ctx, a.businessId),
      ctx.db
        .query("clients")
        .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
        .collect(),
      ctx.db
        .query("settings")
        .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
        .unique(),
      ctx.db
        .query("members")
        .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
        .collect(),
      ctx.db
        .query("loanStatusEvents")
        .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
        .collect(),
    ]);
    const logoUrl = settings?.logoId ? await ctx.storage.getUrl(settings.logoId) : null;
    return {
      business: {
        _id: access.business._id,
        name: access.business.name,
        timezone: access.business.timezone,
      },
      me: { userId: access.userId, role: access.member.role, name: access.name },
      today: access.today,
      settings: settings ? { ...settings, logoUrl } : null,
      clients: clients.map(({ photoId, ...c }) => ({ ...c, hasPhoto: photoId !== undefined })),
      loans: records.loans,
      payments: records.payments,
      lateFees: records.lateFees,
      capital: records.capital,
      entries: records.entries,
      statusEvents,
      /** Names for the history ("recorded by"). */
      people: members.map((m) => ({ userId: m.userId, name: m.name, email: m.email })),
    };
  },
});

/** The change history, newest first, a page at a time. */
export const changes = query({
  args: { businessId: v.id("businesses"), loanId: v.optional(v.id("loans")), paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireMember(ctx, a.businessId, "read");
    if (a.loanId) {
      const loanId = a.loanId;
      return await ctx.db
        .query("changeLog")
        .withIndex("by_loan", (q) => q.eq("loanId", loanId))
        .order("desc")
        .filter((q) => q.eq(q.field("businessId"), a.businessId))
        .paginate(a.paginationOpts);
    }
    return await ctx.db
      .query("changeLog")
      .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
      .order("desc")
      .paginate(a.paginationOpts);
  },
});
