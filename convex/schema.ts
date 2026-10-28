// Acervus Finance data model.
//
// Every business record carries `businessId`, and every function checks the
// caller's membership in that business before reading or writing it, so one
// business can never see another's data. Money is whole cents (numbers,
// always integers), rates are parts per million, dates are ISO "YYYY-MM-DD"
// strings in the business's time zone, timestamps are milliseconds (UTC).
//
// The financial rules are the desktop app's (docs/ACCOUNTING.md), run by
// shared/domain on the server inside each mutation; a write that breaks them
// is rejected and nothing is saved.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const role = v.union(v.literal("admin"), v.literal("collector"), v.literal("viewer"));
export const frequency = v.union(v.literal("daily"), v.literal("weekly"), v.literal("biweekly"), v.literal("monthly"));
export const method = v.union(v.literal("declining"), v.literal("flat"), v.literal("interest_only"));
export const contractStatus = v.union(
  v.literal("active"),
  v.literal("paid_off"),
  v.literal("defaulted"),
  v.literal("restructured"),
);
export const account = v.union(v.literal("capital"), v.literal("interest"));
export const installment = v.object({ seq: v.number(), due: v.string(), principal: v.number(), interest: v.number() });
export const applied = v.object({ seq: v.number(), principal: v.number(), interest: v.number(), fee: v.number() });
export const allocationMode = v.union(
  v.literal("auto"),
  v.literal("installment"),
  v.literal("spread"),
  v.literal("custom"),
);

/** Who did something and when, on every financial record. */
const stamps = {
  createdAt: v.number(),
  createdBy: v.string(),
  updatedAt: v.number(),
  /** Increases on every change; edits must name the version they started
   *  from, so a stale screen can never overwrite a newer change. */
  version: v.number(),
};

export default defineSchema({
  businesses: defineTable({
    name: v.string(),
    /** IANA zone; "today" for due dates and late fees is the date here. */
    timezone: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
    /** Next record number: the order records were made, used to break ties
     *  between payments on the same date (like the desktop's row ids). */
    nextRecordNo: v.number(),
  }),

  members: defineTable({
    businessId: v.id("businesses"),
    /** Better Auth user id (the JWT subject). */
    userId: v.string(),
    email: v.string(),
    name: v.string(),
    role,
    active: v.boolean(),
    joinedAt: v.number(),
    removedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_business", ["businessId"])
    .index("by_business_user", ["businessId", "userId"]),

  invites: defineTable({
    businessId: v.id("businesses"),
    email: v.string(),
    role,
    /** SHA-256 of the single-use token; the token itself is never stored. */
    tokenHash: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedBy: v.optional(v.string()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_token", ["tokenHash"])
    .index("by_business", ["businessId"]),

  settings: defineTable({
    businessId: v.id("businesses"),
    receiptName: v.string(),
    companyAddress: v.string(),
    companyPhone: v.string(),
    receiptCompany: v.object({ name: v.boolean(), address: v.boolean(), phone: v.boolean() }),
    receiptClient: v.object({ name: v.boolean(), idNumber: v.boolean(), phone: v.boolean(), address: v.boolean() }),
    /** Changed receipt wording (see shared/receipts/wording.ts); unset keys
     *  print the built-in text. */
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
    logoId: v.optional(v.id("_storage")),
    updatedAt: v.number(),
    version: v.number(),
  }).index("by_business", ["businessId"]),

  clients: defineTable({
    businessId: v.id("businesses"),
    recordNo: v.number(),
    fullName: v.string(),
    phone: v.string(),
    email: v.string(),
    idNumber: v.string(),
    address: v.string(),
    notes: v.string(),
    archivedAt: v.optional(v.number()),
    /** Photo of the client or their ID document. Sensitive: only admins can
     *  fetch it, it is never cached offline and never printed. */
    photoId: v.optional(v.id("_storage")),
    ...stamps,
  }).index("by_business", ["businessId"]),

  loans: defineTable({
    businessId: v.id("businesses"),
    recordNo: v.number(),
    clientId: v.id("clients"),
    principal: v.number(),
    /** Rate per interest period, parts per million. */
    rate: v.number(),
    interestPeriod: frequency,
    frequency,
    method,
    /** Number of installments; null for interest-only loans. */
    installments: v.union(v.number(), v.null()),
    /** The schedule was changed by hand (its interest is used as written). */
    scheduleEdited: v.boolean(),
    schedule: v.array(installment),
    lateFeeRate: v.number(),
    startDate: v.string(),
    status: contractStatus,
    statusDate: v.union(v.string(), v.null()),
    notes: v.string(),
    ...stamps,
  })
    .index("by_business", ["businessId"])
    .index("by_client", ["clientId"]),

  loanStatusEvents: defineTable({
    businessId: v.id("businesses"),
    loanId: v.id("loans"),
    status: contractStatus,
    occurredOn: v.string(),
    note: v.string(),
    createdAt: v.number(),
    createdBy: v.string(),
  })
    .index("by_loan", ["loanId"])
    .index("by_business", ["businessId"]),

  payments: defineTable({
    businessId: v.id("businesses"),
    loanId: v.id("loans"),
    recordNo: v.number(),
    paidOn: v.string(),
    amount: v.number(),
    notes: v.string(),
    /** How it was asked to be applied (installment loans). */
    mode: allocationMode,
    targetSeq: v.optional(v.number()),
    targets: v.optional(v.array(v.object({ seq: v.number(), amount: v.number() }))),
    custom: v.optional(v.object({ principal: v.number(), interest: v.number(), fee: v.number() })),
    /** Entered fee (interest-only loans) — an input, kept as typed. */
    feeInput: v.number(),
    /** The split, worked out by the engine and kept in step on every change. */
    principal: v.number(),
    interest: v.number(),
    fee: v.number(),
    /** Per-installment split (installment loans). */
    applied: v.array(applied),
    /** Recorded on a device while offline, synced later. */
    recordedOffline: v.boolean(),
    deviceRecordedAt: v.optional(v.number()),
    ...stamps,
  })
    .index("by_business", ["businessId"])
    .index("by_loan", ["loanId"]),

  lateFees: defineTable({
    businessId: v.id("businesses"),
    loanId: v.id("loans"),
    seq: v.number(),
    assessedOn: v.string(),
    baseAmount: v.number(),
    rate: v.number(),
    amount: v.number(),
    waivedAt: v.optional(v.number()),
    waiveReason: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_loan", ["loanId", "seq"])
    .index("by_business", ["businessId"]),

  capitalTxs: defineTable({
    businessId: v.id("businesses"),
    recordNo: v.number(),
    kind: v.union(v.literal("contribution"), v.literal("withdrawal")),
    amount: v.number(),
    occurredOn: v.string(),
    notes: v.string(),
    ...stamps,
  }).index("by_business", ["businessId"]),

  cashEntries: defineTable({
    businessId: v.id("businesses"),
    recordNo: v.number(),
    kind: v.union(v.literal("expense"), v.literal("income"), v.literal("transfer"), v.literal("adjustment")),
    account,
    /** Positive for expenses, income and transfers; signed for adjustments. */
    amount: v.number(),
    occurredOn: v.string(),
    description: v.string(),
    recordedOffline: v.boolean(),
    deviceRecordedAt: v.optional(v.number()),
    ...stamps,
  }).index("by_business", ["businessId"]),

  /** What every create, edit and deletion changed, by whom. Never edited. */
  changeLog: defineTable({
    businessId: v.id("businesses"),
    entity: v.union(
      v.literal("client"),
      v.literal("loan"),
      v.literal("payment"),
      v.literal("capital"),
      v.literal("entry"),
      v.literal("late_fee"),
      v.literal("settings"),
      v.literal("member"),
    ),
    entityId: v.string(),
    loanId: v.optional(v.id("loans")),
    action: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
    changes: v.array(v.object({ field: v.string(), old: v.string(), new: v.string() })),
    reason: v.string(),
    userId: v.string(),
    userName: v.string(),
    createdAt: v.number(),
    /** The offline operation that made this change, if any. */
    opId: v.optional(v.string()),
  })
    .index("by_business", ["businessId"])
    .index("by_loan", ["loanId"]),

  /** Offline/online operations already applied, by their device-generated
   *  id: a retried operation returns the first result instead of recording
   *  the payment, expense or income twice. */
  operations: defineTable({
    businessId: v.id("businesses"),
    opId: v.string(),
    kind: v.string(),
    userId: v.string(),
    resultId: v.string(),
    /** Payments: the loan version before and after, returned again on a
     *  retry so the device can carry on with its other queued payments. */
    loanVersionBefore: v.optional(v.number()),
    loanVersionAfter: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_op", ["businessId", "opId"]),

  /** Fixed-window counters for app-level abuse limits. */
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),
});
