// Fixed-window counters for abuse limits that Better Auth's per-IP limits
// don't cover (per-account sign-in attempts, business creation, invites).

import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";

/** Counts one hit on `key`; false once `max` hits fall in the window. */
export async function hitLimit(ctx: MutationCtx, key: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row || now - row.windowStart >= windowMs) {
    if (row) await ctx.db.patch(row._id, { windowStart: now, count: 1 });
    else await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
    return true;
  }
  if (row.count >= max) return false;
  await ctx.db.patch(row._id, { count: row.count + 1 });
  return true;
}

export const hit = internalMutation({
  args: { key: v.string(), max: v.number(), windowMs: v.number() },
  handler: (ctx, a) => hitLimit(ctx, a.key, a.max, a.windowMs),
});
