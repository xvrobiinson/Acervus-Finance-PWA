// Businesses and their members. Anyone with a verified account can create a
// business and becomes its first admin; nobody else can see it until an
// admin invites them.

import { v } from "convex/values";
import { isValidTimeZone } from "../shared/domain/dates";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireIdentity, requireMember } from "./lib/access";
import { Diff, logChange } from "./lib/books";
import { fail } from "./lib/errors";
import { text } from "./lib/validate";
import { hitLimit } from "./rateLimit";
import { role } from "./schema";

const CURRENCIES = ["DOP", "USD", "EUR", "MXN", "COP", "GBP", "CAD"];

/** The businesses the signed-in user belongs to. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) return [];
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", id.subject))
      .collect();
    const out = [];
    for (const m of memberships.filter((m) => m.active)) {
      const b = await ctx.db.get(m.businessId);
      if (b) out.push({ businessId: b._id, name: b.name, role: m.role, timezone: b.timezone });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    timezone: v.string(),
    language: v.union(v.literal("en"), v.literal("es")),
    currencyCode: v.string(),
  },
  handler: async (ctx, a): Promise<Id<"businesses">> => {
    const who = await requireIdentity(ctx);
    if (!(await hitLimit(ctx, `business:create:${who.userId}`, 3, 24 * 60 * 60_000))) fail("rate_limited");
    const name = text("name", a.name, 80, { required: true, oneLine: true });
    if (!isValidTimeZone(a.timezone)) fail("invalid", { field: "timezone", reason: "timezone" });
    if (!CURRENCIES.includes(a.currencyCode)) fail("invalid", { field: "currency", reason: "currency" });
    const now = Date.now();
    const businessId = await ctx.db.insert("businesses", {
      name,
      timezone: a.timezone,
      createdBy: who.userId,
      createdAt: now,
      nextRecordNo: 1,
    });
    const memberId = await ctx.db.insert("members", {
      businessId,
      userId: who.userId,
      email: who.email,
      name: who.name,
      role: "admin",
      active: true,
      joinedAt: now,
    });
    await ctx.db.insert("settings", {
      businessId,
      receiptName: name,
      companyAddress: "",
      companyPhone: "",
      receiptCompany: { name: true, address: true, phone: true },
      receiptClient: { name: true, idNumber: true, phone: true, address: true },
      receiptText: {},
      currencyCode: a.currencyCode,
      numberStyle: "comma_dot",
      dateStyle: "medium",
      language: a.language,
      defaultRate: 100_000,
      defaultFrequency: "monthly",
      lateFeeRate: 50_000,
      receiptAfterPayment: true,
      receiptAfterLoan: true,
      updatedAt: now,
      version: 1,
    });
    const business = (await ctx.db.get(businessId))!;
    const member = (await ctx.db.get(memberId))!;
    await logChange(
      ctx,
      { ...who, business, member, today: "" },
      "member",
      memberId,
      "create",
      new Diff().added("role", "admin").added("email", who.email),
      "Created the business",
    );
    return businessId;
  },
});

export const update = mutation({
  args: { businessId: v.id("businesses"), name: v.string(), timezone: v.string() },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const name = text("name", a.name, 80, { required: true, oneLine: true });
    if (!isValidTimeZone(a.timezone)) fail("invalid", { field: "timezone", reason: "timezone" });
    const d = new Diff().field("business_name", access.business.name, name).field("timezone", access.business.timezone, a.timezone);
    if (d.empty) return;
    await ctx.db.patch(a.businessId, { name, timezone: a.timezone });
    await logChange(ctx, access, "settings", a.businessId, "update", d, "");
  },
});

export const members = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    await requireMember(ctx, a.businessId, "read");
    const rows = await ctx.db
      .query("members")
      .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
      .collect();
    return rows.map((m) => ({
      _id: m._id,
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      active: m.active,
      joinedAt: m.joinedAt,
    }));
  },
});

async function activeAdmins(ctx: Parameters<typeof requireMember>[0], businessId: Id<"businesses">) {
  const rows = await ctx.db
    .query("members")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  return rows.filter((m) => m.active && m.role === "admin");
}

export const setRole = mutation({
  args: { businessId: v.id("businesses"), memberId: v.id("members"), role },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const m = await ctx.db.get(a.memberId);
    if (!m || m.businessId !== a.businessId || !m.active) fail("not_found", { table: "members" });
    if (m.role === a.role) return;
    if (m.role === "admin" && (await activeAdmins(ctx, a.businessId)).length <= 1) fail("last_admin");
    await ctx.db.patch(m._id, { role: a.role });
    await logChange(ctx, access, "member", m._id, "update", new Diff().field("role", m.role, a.role).field("email", m.email, m.email), "");
  },
});

export const removeMember = mutation({
  args: { businessId: v.id("businesses"), memberId: v.id("members"), reason: v.string() },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const m = await ctx.db.get(a.memberId);
    if (!m || m.businessId !== a.businessId || !m.active) fail("not_found", { table: "members" });
    if (m.role === "admin" && (await activeAdmins(ctx, a.businessId)).length <= 1) fail("last_admin");
    await ctx.db.patch(m._id, { active: false, removedAt: Date.now() });
    await logChange(
      ctx,
      access,
      "member",
      m._id,
      "delete",
      new Diff().removed("email", m.email).removed("role", m.role),
      text("reason", a.reason, 2000),
    );
  },
});
