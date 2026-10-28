// Money outside loans: capital added or withdrawn, expenses, outside income,
// transfers between the two accounts and balance adjustments. Collectors
// can record expenses and income (also offline); the rest is for admins.
// Every change is checked against the whole ledger: no account may go below
// zero at any point.

import { v } from "convex/values";
import { balancesOn } from "../shared/domain/portfolio";
import { buildBook } from "../shared/domain/records";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { checkVersion, ownRecord, requireMember } from "./lib/access";
import {
  checkCash,
  Diff,
  engineRecords,
  ensureAvailable,
  loadRecords,
  logChange,
  nextRecordNo,
  priorOperation,
  rememberOperation,
} from "./lib/books";
import { fail } from "./lib/errors";
import { amount, day, notFuture, text } from "./lib/validate";
import { account } from "./schema";

const capitalKind = v.union(v.literal("contribution"), v.literal("withdrawal"));

export const addCapital = mutation({
  args: { businessId: v.id("businesses"), kind: capitalKind, amount: v.number(), occurredOn: v.string(), notes: v.string() },
  handler: async (ctx, a): Promise<Id<"capitalTxs">> => {
    const access = await requireMember(ctx, a.businessId, "manage");
    amount("amount", a.amount);
    const on = day("occurredOn", a.occurredOn);
    notFuture("occurredOn", on, access.today);
    const notes = text("notes", a.notes, 2000);
    if (a.kind === "withdrawal") ensureAvailable(await loadRecords(ctx, a.businessId), on, "capital", a.amount);
    const now = Date.now();
    const id = await ctx.db.insert("capitalTxs", {
      businessId: a.businessId,
      recordNo: await nextRecordNo(ctx, access.business),
      kind: a.kind,
      amount: a.amount,
      occurredOn: on,
      notes,
      createdAt: now,
      createdBy: access.userId,
      updatedAt: now,
      version: 1,
    });
    await checkCash(ctx, a.businessId);
    const d = new Diff().added("kind", a.kind).added("amount", a.amount).added("occurred_on", on).added("notes", notes);
    await logChange(ctx, access, "capital", id, "create", d, "");
    return id;
  },
});

export const updateCapital = mutation({
  args: {
    businessId: v.id("businesses"),
    id: v.id("capitalTxs"),
    expectedVersion: v.number(),
    kind: capitalKind,
    amount: v.number(),
    occurredOn: v.string(),
    notes: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "capitalTxs", a.id);
    checkVersion(old, a.expectedVersion);
    amount("amount", a.amount);
    const on = day("occurredOn", a.occurredOn);
    notFuture("occurredOn", on, access.today);
    const notes = text("notes", a.notes, 2000);
    const d = new Diff()
      .field("kind", old.kind, a.kind)
      .field("amount", old.amount, a.amount)
      .field("occurred_on", old.occurredOn, on)
      .field("notes", old.notes, notes);
    if (d.empty) return;
    await ctx.db.patch(old._id, { kind: a.kind, amount: a.amount, occurredOn: on, notes, version: old.version + 1, updatedAt: Date.now() });
    await checkCash(ctx, a.businessId);
    await logChange(ctx, access, "capital", old._id, "update", d, text("reason", a.reason, 2000));
  },
});

export const removeCapital = mutation({
  args: { businessId: v.id("businesses"), id: v.id("capitalTxs"), expectedVersion: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "capitalTxs", a.id);
    checkVersion(old, a.expectedVersion);
    await ctx.db.delete(old._id);
    await checkCash(ctx, a.businessId);
    const d = new Diff()
      .removed("kind", old.kind)
      .removed("amount", old.amount)
      .removed("occurred_on", old.occurredOn)
      .removed("notes", old.notes);
    await logChange(ctx, access, "capital", old._id, "delete", d, text("reason", a.reason, 2000));
  },
});

/** An expense, outside income (both allowed offline, for collectors too) or
 *  a transfer between the accounts (admins). */
export const addEntry = mutation({
  args: {
    businessId: v.id("businesses"),
    opId: v.string(),
    kind: v.union(v.literal("expense"), v.literal("income"), v.literal("transfer")),
    account,
    amount: v.number(),
    occurredOn: v.string(),
    description: v.string(),
    deviceRecordedAt: v.optional(v.number()),
  },
  handler: async (ctx, a): Promise<{ entryId: Id<"cashEntries">; duplicate: boolean }> => {
    const access = await requireMember(ctx, a.businessId, a.kind === "transfer" ? "manage" : "record");
    const prior = await priorOperation(ctx, access, a.opId, `entry.${a.kind}`);
    if (prior) return { entryId: prior.resultId as Id<"cashEntries">, duplicate: true };
    amount("amount", a.amount);
    const on = day("occurredOn", a.occurredOn);
    notFuture("occurredOn", on, access.today);
    const description = text("description", a.description, 2000, { required: a.kind !== "transfer" });
    if (a.kind !== "income") ensureAvailable(await loadRecords(ctx, a.businessId), on, a.account, a.amount);
    const now = Date.now();
    const entryId = await ctx.db.insert("cashEntries", {
      businessId: a.businessId,
      recordNo: await nextRecordNo(ctx, access.business),
      kind: a.kind,
      account: a.account,
      amount: a.amount,
      occurredOn: on,
      description,
      recordedOffline: a.deviceRecordedAt !== undefined,
      deviceRecordedAt: a.deviceRecordedAt,
      createdAt: now,
      createdBy: access.userId,
      updatedAt: now,
      version: 1,
    });
    await checkCash(ctx, a.businessId);
    const d = new Diff()
      .added("kind", a.kind)
      .added("account", a.account)
      .added("amount", a.amount)
      .added("occurred_on", on)
      .added("description", description);
    await logChange(ctx, access, "entry", entryId, "create", d, a.deviceRecordedAt ? "Recorded offline" : "", { opId: a.opId });
    await rememberOperation(ctx, access, a.opId, `entry.${a.kind}`, entryId);
    return { entryId, duplicate: false };
  },
});

/** Sets the two accounts to what is really on hand at the end of `on`,
 *  recording an adjustment for each difference. */
export const adjustBalances = mutation({
  args: { businessId: v.id("businesses"), capital: v.number(), interest: v.number(), occurredOn: v.string(), reason: v.string() },
  handler: async (ctx, a): Promise<number> => {
    const access = await requireMember(ctx, a.businessId, "manage");
    amount("capital", a.capital, { allowZero: true });
    amount("interest", a.interest, { allowZero: true });
    const on = day("occurredOn", a.occurredOn);
    notFuture("occurredOn", on, access.today);
    const reason = text("reason", a.reason, 2000, { required: true });
    const now = balancesOn(buildBook(engineRecords(await loadRecords(ctx, a.businessId))), on);
    let made = 0;
    for (const [acct, target] of [
      ["capital", a.capital],
      ["interest", a.interest],
    ] as const) {
      const diff = target - now[acct];
      if (diff === 0) continue;
      const t = Date.now();
      const id = await ctx.db.insert("cashEntries", {
        businessId: a.businessId,
        recordNo: await nextRecordNo(ctx, access.business),
        kind: "adjustment",
        account: acct,
        amount: diff,
        occurredOn: on,
        description: reason,
        recordedOffline: false,
        createdAt: t,
        createdBy: access.userId,
        updatedAt: t,
        version: 1,
      });
      await logChange(ctx, access, "entry", id, "create", new Diff().added("kind", "adjustment").added("account", acct).added("amount", diff).added("occurred_on", on), reason);
      made += 1;
    }
    if (made === 0) fail("nothing_to_adjust");
    await checkCash(ctx, a.businessId);
    return made;
  },
});

export const updateEntry = mutation({
  args: {
    businessId: v.id("businesses"),
    id: v.id("cashEntries"),
    expectedVersion: v.number(),
    account,
    amount: v.number(),
    occurredOn: v.string(),
    description: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "cashEntries", a.id);
    checkVersion(old, a.expectedVersion);
    amount("amount", a.amount, { allowNegative: old.kind === "adjustment" });
    const on = day("occurredOn", a.occurredOn);
    notFuture("occurredOn", on, access.today);
    const description = text("description", a.description, 2000, {
      required: old.kind === "expense" || old.kind === "income",
    });
    const d = new Diff()
      .field("account", old.account, a.account)
      .field("amount", old.amount, a.amount)
      .field("occurred_on", old.occurredOn, on)
      .field("description", old.description, description);
    if (d.empty) return;
    await ctx.db.patch(old._id, {
      account: a.account,
      amount: a.amount,
      occurredOn: on,
      description,
      version: old.version + 1,
      updatedAt: Date.now(),
    });
    await checkCash(ctx, a.businessId);
    await logChange(ctx, access, "entry", old._id, "update", d, text("reason", a.reason, 2000));
  },
});

export const removeEntry = mutation({
  args: { businessId: v.id("businesses"), id: v.id("cashEntries"), expectedVersion: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "cashEntries", a.id);
    checkVersion(old, a.expectedVersion);
    await ctx.db.delete(old._id);
    await checkCash(ctx, a.businessId);
    const d = new Diff()
      .removed("kind", old.kind)
      .removed("account", old.account)
      .removed("amount", old.amount)
      .removed("occurred_on", old.occurredOn)
      .removed("description", old.description);
    await logChange(ctx, access, "entry", old._id, "delete", d, text("reason", a.reason, 2000));
  },
});
