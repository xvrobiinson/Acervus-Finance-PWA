// Business settings: receipt name, company and client details on receipts,
// receipt wording, currency and formats, defaults for new loans, and the
// logo. Admins only.

import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { checkVersion, requireMember } from "./lib/access";
import { Diff, logChange } from "./lib/books";
import { fail } from "./lib/errors";
import { rate, text } from "./lib/validate";
import { frequency, receiptShow } from "./schema";

const CURRENCIES = ["DOP", "USD", "EUR", "MXN", "COP", "GBP", "CAD"];

export const update = mutation({
  args: {
    businessId: v.id("businesses"),
    expectedVersion: v.number(),
    receiptName: v.string(),
    companyAddress: v.string(),
    companyPhone: v.string(),
    receiptCompany: v.object({ name: v.boolean(), address: v.boolean(), phone: v.boolean() }),
    receiptClient: v.object({ name: v.boolean(), idNumber: v.boolean(), phone: v.boolean(), address: v.boolean() }),
    /** Older apps don't send it; their saves then keep what is stored. */
    receiptShow: v.optional(receiptShow),
    receiptText: v.record(v.string(), v.string()),
    currencyCode: v.string(),
    numberStyle: v.union(v.literal("comma_dot"), v.literal("dot_comma"), v.literal("space_comma")),
    dateStyle: v.union(v.literal("medium"), v.literal("iso"), v.literal("dmy"), v.literal("mdy")),
    language: v.union(v.literal("en"), v.literal("es")),
    defaultRate: v.number(),
    defaultFrequency: frequency,
    lateFeeRate: v.number(),
    receiptAfterPayment: v.boolean(),
    receiptAfterLoan: v.boolean(),
  },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ctx.db
      .query("settings")
      .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
      .unique();
    if (!old) fail("not_found", { table: "settings" });
    checkVersion(old, a.expectedVersion);
    if (!CURRENCIES.includes(a.currencyCode)) fail("invalid", { field: "currency", reason: "currency" });
    const keys = Object.keys(a.receiptText);
    if (keys.length > 40 || keys.some((k) => !/^[a-z_]{1,40}$/.test(k))) fail("invalid", { field: "receiptText", reason: "keys" });
    const receiptText: Record<string, string> = {};
    for (const k of keys) receiptText[k] = text("receiptText", a.receiptText[k], 4000);
    const next = {
      receiptName: text("receiptName", a.receiptName, 60, { oneLine: true }),
      companyAddress: text("companyAddress", a.companyAddress, 200, { oneLine: true }),
      companyPhone: text("companyPhone", a.companyPhone, 40, { oneLine: true }),
      receiptCompany: a.receiptCompany,
      receiptClient: a.receiptClient,
      ...(a.receiptShow ? { receiptShow: a.receiptShow } : {}),
      receiptText,
      currencyCode: a.currencyCode,
      numberStyle: a.numberStyle,
      dateStyle: a.dateStyle,
      language: a.language,
      defaultRate: rate("defaultRate", a.defaultRate),
      defaultFrequency: a.defaultFrequency,
      lateFeeRate: rate("lateFeeRate", a.lateFeeRate),
      receiptAfterPayment: a.receiptAfterPayment,
      receiptAfterLoan: a.receiptAfterLoan,
    };
    const d = new Diff();
    for (const k of Object.keys(next) as (keyof typeof next)[]) d.field(k, old[k], next[k]);
    if (d.empty) return;
    await ctx.db.patch(old._id, { ...next, version: old.version + 1, updatedAt: Date.now() });
    await logChange(ctx, access, "settings", old._id, "update", d, "");
  },
});

export const logoUploadUrl = mutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    await requireMember(ctx, a.businessId, "manage");
    return await ctx.storage.generateUploadUrl();
  },
});

export const setLogo = mutation({
  args: { businessId: v.id("businesses"), storageId: v.union(v.id("_storage"), v.null()) },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const s = await ctx.db
      .query("settings")
      .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
      .unique();
    if (!s) fail("not_found", { table: "settings" });
    if (a.storageId) {
      const meta = await ctx.db.system.get(a.storageId);
      if (!meta || !["image/png", "image/jpeg", "image/webp"].includes(meta.contentType ?? "") || meta.size > 1024 * 1024) {
        if (meta) await ctx.storage.delete(a.storageId);
        fail("invalid", { field: "logo", reason: "logo" });
      }
    }
    if (s.logoId) await ctx.storage.delete(s.logoId);
    await ctx.db.patch(s._id, { logoId: a.storageId ?? undefined, version: s.version + 1, updatedAt: Date.now() });
    await logChange(ctx, access, "settings", s._id, "update", new Diff().field("logo", s.logoId ? "on_file" : "", a.storageId ? "on_file" : ""), "");
  },
});
