// Businesses and their members. Anyone with a verified account can create a
// business and becomes its first admin; nobody else can see it until an
// admin invites them.

import { v } from "convex/values";
import { isValidTimeZone, todayIn } from "../shared/domain/dates";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireIdentity, requireMember, type Access, type Identity } from "./lib/access";
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

export const businessArgs = {
  name: v.string(),
  timezone: v.string(),
  language: v.union(v.literal("en"), v.literal("es")),
  currencyCode: v.string(),
};

export const create = mutation({
  args: businessArgs,
  handler: async (ctx, a): Promise<Id<"businesses">> => {
    const who = await requireIdentity(ctx);
    return (await startBusiness(ctx, who, a)).business._id;
  },
});

type SettingsFields = Omit<Doc<"settings">, "_id" | "_creationTime" | "businessId" | "updatedAt" | "version" | "logoId">;

/** Creates a business with the caller as its first admin and default
 *  settings (or `settings`, from an import), and returns the caller's access
 *  to it. Shared by `create` and the desktop import. */
export async function startBusiness(
  ctx: MutationCtx,
  who: Identity,
  a: { name: string; timezone: string; language: "en" | "es"; currencyCode: string },
  opts: { settings?: Partial<SettingsFields>; nextRecordNo?: number; reason?: string } = {},
): Promise<Access> {
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
    nextRecordNo: opts.nextRecordNo ?? 1,
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
    ...opts.settings,
    updatedAt: now,
    version: 1,
  });
  const business = (await ctx.db.get(businessId))!;
  const member = (await ctx.db.get(memberId))!;
  const access: Access = { ...who, business, member, today: todayIn(business.timezone) };
  await logChange(
    ctx,
    access,
    "member",
    memberId,
    "create",
    new Diff().added("role", "admin").added("email", who.email),
    opts.reason ?? "Created the business",
  );
  return access;
}

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

/** Deletes a business for everyone: admins only, and only when `name` is
 *  the business's name exactly, so it can't happen by accident. The
 *  business disappears at once; its records and files are removed in the
 *  background (`purge`). */
export const remove = mutation({
  args: { businessId: v.id("businesses"), name: v.string() },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    if (a.name.trim() !== access.business.name) fail("invalid", { field: "name", reason: "confirm_name" });
    await ctx.db.delete(a.businessId);
    await ctx.scheduler.runAfter(0, internal.businesses.purge, { businessId: a.businessId });
  },
});

/** Every table that holds a business's records. */
const BUSINESS_TABLES = [
  "members",
  "invites",
  "settings",
  "clients",
  "loans",
  "loanStatusEvents",
  "payments",
  "lateFees",
  "capitalTxs",
  "cashEntries",
  "changeLog",
] as const;
const PURGE_BATCH = 500;

/** Removes a deleted business's records and files, a batch at a time. */
export const purge = internalMutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    let left = PURGE_BATCH;
    for (const table of BUSINESS_TABLES) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
        .take(left);
      for (const row of rows) {
        const file = "photoId" in row ? row.photoId : "logoId" in row ? row.logoId : undefined;
        if (file) await ctx.storage.delete(file);
        await ctx.db.delete(row._id);
      }
      left -= rows.length;
      if (left === 0) break;
    }
    if (left > 0) {
      const ops = await ctx.db
        .query("operations")
        .withIndex("by_op", (q) => q.eq("businessId", a.businessId))
        .take(left);
      for (const op of ops) await ctx.db.delete(op._id);
      left -= ops.length;
    }
    if (left === 0) await ctx.scheduler.runAfter(0, internal.businesses.purge, a);
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
