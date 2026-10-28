// Who may do what. Every query and mutation that touches business data calls
// `requireMember` first; hiding buttons in the app is only a convenience.
//
//   viewer     reads everything except client ID photos
//   collector  + adds clients, records payments, expenses and income,
//              prints receipts
//   admin      + loans, capital, transfers, adjustments, every edit and
//              deletion, late-fee waivers, defaults, settings, members,
//              client ID photos

import type { Day } from "../../shared/domain/dates";
import { todayIn } from "../../shared/domain/dates";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";

export type Role = "admin" | "collector" | "viewer";
export type Need = "read" | "record" | "manage";

const ALLOWED: Record<Need, Role[]> = {
  read: ["admin", "collector", "viewer"],
  record: ["admin", "collector"],
  manage: ["admin"],
};

export function roleAllows(role: Role, need: Need): boolean {
  return ALLOWED[need].includes(role);
}

export interface Identity {
  userId: string;
  email: string;
  name: string;
}

/** The signed-in, verified user. */
export async function requireIdentity(ctx: QueryCtx | MutationCtx): Promise<Identity> {
  const id = await ctx.auth.getUserIdentity();
  if (!id) fail("unauthenticated");
  if (id.emailVerified === false) fail("email_not_verified");
  const email = (id.email ?? "").toLowerCase();
  return { userId: id.subject, email, name: id.name || email };
}

export interface Access extends Identity {
  business: Doc<"businesses">;
  member: Doc<"members">;
  /** Today in the business's time zone. */
  today: Day;
}

export async function requireMember(
  ctx: QueryCtx | MutationCtx,
  businessId: Id<"businesses">,
  need: Need,
): Promise<Access> {
  const who = await requireIdentity(ctx);
  // Same message whether the business doesn't exist or isn't theirs, so ids
  // can't be probed.
  const business = await ctx.db.get(businessId);
  const member = business
    ? await ctx.db
        .query("members")
        .withIndex("by_business_user", (q) => q.eq("businessId", businessId).eq("userId", who.userId))
        .unique()
    : null;
  if (!business || !member || !member.active) fail("forbidden");
  if (!roleAllows(member.role, need)) fail("forbidden", { need });
  return { ...who, name: member.name || who.name, business, member, today: todayIn(business.timezone) };
}

/** A record of `table` that belongs to the caller's business. */
export async function ownRecord<T extends "clients" | "loans" | "payments" | "capitalTxs" | "cashEntries">(
  ctx: QueryCtx | MutationCtx,
  access: Access,
  table: T,
  id: Id<T>,
): Promise<Doc<T>> {
  const doc = (await ctx.db.get(id)) as Doc<T> | null;
  if (!doc || doc.businessId !== access.business._id) fail("not_found", { table });
  return doc;
}

/** Edits name the version they started from; a newer change wins and the
 *  person is shown it instead of silently overwriting it. */
export function checkVersion(doc: { version: number }, expected: number) {
  if (doc.version !== expected) fail("conflict", { current: doc.version, expected });
}
