// Backend tests: authorization and isolation between businesses, the core
// financial workflows (worked out by the shared engine inside mutations),
// idempotent offline operations, stale/conflict detection, late fees and
// invitations. Run against convex-test's in-memory backend.

import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, todayIn } from "../shared/domain/dates";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const TZ = "America/Santo_Domingo";

const ana = { subject: "user_ana", email: "ana@example.com", emailVerified: true, name: "Ana" };
const ben = { subject: "user_ben", email: "ben@example.com", emailVerified: true, name: "Ben" };
const carla = { subject: "user_carla", email: "carla@example.com", emailVerified: true, name: "Carla" };
const dario = { subject: "user_dario", email: "dario@example.com", emailVerified: true, name: "Darío" };

type T = ReturnType<typeof convexTest>;

async function errorOf(p: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConvexError) return e.data as Record<string, unknown>;
    throw e;
  }
  throw new Error("expected the call to fail");
}

let opCounter = 0;
const op = () => `op-${Date.now()}-${++opCounter}-abcdef`;

async function setup(t: T) {
  const asAna = t.withIdentity(ana);
  const businessId = await asAna.mutation(api.businesses.create, {
    name: "Ana Préstamos",
    timezone: TZ,
    language: "es",
    currencyCode: "DOP",
  });
  return { asAna, businessId };
}

const terms = (start: string, method: "declining" | "flat" | "interest_only", n: number | null) => ({
  principal: 1_000_000,
  rate: 100_000,
  interestPeriod: "monthly" as const,
  frequency: "monthly" as const,
  startDate: start,
  method,
  installments: n,
  lateFeeRate: 50_000,
});

describe("authorization and isolation", () => {
  let t: T;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("refuses anyone who isn't signed in or verified", async () => {
    const { businessId } = await setup(t);
    expect(await errorOf(t.query(api.data.snapshot, { businessId }))).toMatchObject({ code: "unauthenticated" });
    const unverified = t.withIdentity({ ...ben, emailVerified: false });
    expect(await errorOf(unverified.mutation(api.businesses.create, { name: "X", timezone: TZ, language: "en", currencyCode: "USD" }))).toMatchObject({
      code: "email_not_verified",
    });
  });

  it("keeps each business's data to its own members", async () => {
    const { asAna, businessId } = await setup(t);
    const asBen = t.withIdentity(ben);
    const bensBusiness = await asBen.mutation(api.businesses.create, { name: "Ben Loans", timezone: TZ, language: "en", currencyCode: "USD" });
    const { clientId } = await asAna.mutation(api.clients.create, {
      businessId, opId: op(), fullName: "Cliente Uno", phone: "", email: "", idNumber: "001-1234567-8", address: "", notes: "",
    });
    // Ben can't read or write Ana's business…
    expect(await errorOf(asBen.query(api.data.snapshot, { businessId }))).toMatchObject({ code: "forbidden" });
    expect(
      await errorOf(asBen.mutation(api.clients.update, {
        businessId, clientId, expectedVersion: 1, fullName: "Hacked", phone: "", email: "", idNumber: "", address: "", notes: "",
      })),
    ).toMatchObject({ code: "forbidden" });
    // …nor reach her records through his own business.
    expect(
      await errorOf(asBen.mutation(api.clients.update, {
        businessId: bensBusiness, clientId, expectedVersion: 1, fullName: "Hacked", phone: "", email: "", idNumber: "", address: "", notes: "",
      })),
    ).toMatchObject({ code: "not_found" });
    expect(await asBen.query(api.businesses.mine, {})).toHaveLength(1);
    const snap = await asAna.query(api.data.snapshot, { businessId });
    expect(snap.clients.map((c) => c.fullName)).toEqual(["Cliente Uno"]);
  });

  it("gives collectors and viewers only what their role allows", async () => {
    process.env.SITE_URL = "https://app.example.com";
    const { asAna, businessId } = await setup(t);
    const today = todayIn(TZ);
    await asAna.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 5_000_000, occurredOn: addMonths(today, -2), notes: "" });
    const { clientId } = await asAna.mutation(api.clients.create, {
      businessId, opId: op(), fullName: "Cliente", phone: "", email: "", idNumber: "", address: "", notes: "",
    });
    const loanId = await asAna.mutation(api.loans.create, {
      businessId, clientId, terms: terms(addMonths(today, -1), "interest_only", null), schedule: null, notes: "",
    });
    // Invite Carla as collector and Darío as viewer.
    for (const [who, role] of [[carla, "collector"], [dario, "viewer"]] as const) {
      const { url } = await asAna.action(api.invites.create, { businessId, email: who.email, role });
      const token = url.split("#token=")[1];
      expect(await t.query(api.invites.preview, { token })).toMatchObject({ businessName: "Ana Préstamos", role });
      await t.withIdentity(who).mutation(api.invites.accept, { token });
    }
    const asCarla = t.withIdentity(carla);
    const asDario = t.withIdentity(dario);
    const loan = (await asCarla.query(api.data.snapshot, { businessId })).loans[0];
    // Collector: can record a payment and an expense…
    await asCarla.mutation(api.payments.record, {
      businessId, opId: op(), loanId, loanVersion: loan.version, amount: 10_000, fee: 0, paidOn: today, notes: "", instruction: { kind: "auto" },
    });
    // …but not lend, edit, delete or change settings.
    expect(
      await errorOf(asCarla.mutation(api.loans.create, { businessId, clientId, terms: terms(today, "interest_only", null), schedule: null, notes: "" })),
    ).toMatchObject({ code: "forbidden" });
    expect(await errorOf(asCarla.mutation(api.loans.remove, { businessId, loanId, expectedVersion: 2, reason: "" }))).toMatchObject({
      code: "forbidden",
    });
    expect(await errorOf(asCarla.mutation(api.money.addCapital, { businessId, kind: "withdrawal", amount: 1, occurredOn: today, notes: "" }))).toMatchObject({
      code: "forbidden",
    });
    // Viewer: read only.
    expect((await asDario.query(api.data.snapshot, { businessId })).payments).toHaveLength(1);
    expect(
      await errorOf(asDario.mutation(api.payments.record, {
        businessId, opId: op(), loanId, loanVersion: 2, amount: 100, fee: 0, paidOn: today, notes: "", instruction: { kind: "auto" },
      })),
    ).toMatchObject({ code: "forbidden" });
    // Only admins can get a client's photo.
    await expect(asCarla.query(internal.clients.photoForAdmin, { businessId, clientId })).rejects.toThrow();
  });

  it("invitations work once, for the invited address only", async () => {
    process.env.SITE_URL = "https://app.example.com";
    const { asAna, businessId } = await setup(t);
    const { url } = await asAna.action(api.invites.create, { businessId, email: "Carla@Example.com", role: "collector" });
    const token = url.split("#token=")[1];
    expect(await errorOf(t.withIdentity(ben).mutation(api.invites.accept, { token }))).toMatchObject({ code: "invite_other_email" });
    await t.withIdentity(carla).mutation(api.invites.accept, { token });
    expect(await errorOf(t.withIdentity(carla).mutation(api.invites.accept, { token }))).toMatchObject({ code: "invite_invalid" });
    expect(await t.query(api.invites.preview, { token })).toBeNull();
    // The token itself is never stored.
    const stored = await t.run((ctx) => ctx.db.query("invites").collect());
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("never leaves a business without an admin", async () => {
    const { asAna, businessId } = await setup(t);
    const members = await asAna.query(api.businesses.members, { businessId });
    expect(await errorOf(asAna.mutation(api.businesses.setRole, { businessId, memberId: members[0]._id, role: "viewer" }))).toMatchObject({
      code: "last_admin",
    });
  });
});

describe("financial workflows", () => {
  let t: T;
  let asAna: ReturnType<T["withIdentity"]>;
  let businessId: Id<"businesses">;
  let clientId: Id<"clients">;
  const today = todayIn(TZ);

  beforeEach(async () => {
    t = convexTest(schema, modules);
    ({ asAna, businessId } = await setup(t));
    ({ clientId } = await asAna.mutation(api.clients.create, {
      businessId, opId: op(), fullName: "María Pérez", phone: "809-555-0101", email: "", idNumber: "", address: "", notes: "",
    }));
  });

  const snapshot = () => asAna.query(api.data.snapshot, { businessId });

  it("refuses a loan larger than the money available", async () => {
    const start = addMonths(today, -1);
    await asAna.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 500_000, occurredOn: start, notes: "" });
    expect(
      await errorOf(asAna.mutation(api.loans.create, { businessId, clientId, terms: terms(start, "interest_only", null), schedule: null, notes: "" })),
    ).toMatchObject({ code: "insufficient_cash", available: 500_000 });
  });

  it("splits an interest-only payment like the desktop (the owner's example)", async () => {
    const start = addMonths(today, -2);
    await asAna.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 2_000_000, occurredOn: start, notes: "" });
    const loanId = await asAna.mutation(api.loans.create, {
      businessId, clientId, terms: { ...terms(start, "interest_only", null), principal: 100_000 }, schedule: null, notes: "",
    });
    const v = (await snapshot()).loans[0].version;
    await asAna.mutation(api.payments.record, {
      businessId, opId: op(), loanId, loanVersion: v, amount: 60_000, fee: 0, paidOn: addMonths(start, 1), notes: "", instruction: { kind: "auto" },
    });
    const s = await snapshot();
    expect(s.payments.map((p) => [p.interest, p.principal])).toEqual([[10_000, 50_000]]);
    // Paying more than is owed is refused and nothing is saved.
    expect(
      await errorOf(asAna.mutation(api.payments.record, {
        businessId, opId: op(), loanId, loanVersion: s.loans[0].version, amount: 99_999_999, fee: 0, paidOn: today, notes: "", instruction: { kind: "auto" },
      })),
    ).toMatchObject({ code: "payment", error: { code: "overpayment" } });
    expect((await snapshot()).payments).toHaveLength(1);
  });

  it("runs an installment loan: schedule, payments, late fees and a waiver", async () => {
    const start = addDays(addMonths(today, -3), -1);
    await asAna.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 2_000_000, occurredOn: start, notes: "" });
    const loanId = await asAna.mutation(api.loans.create, {
      businessId, clientId, terms: terms(start, "declining", 5), schedule: null, notes: "",
    });
    let s = await snapshot();
    expect(s.loans[0].schedule.map((x) => x.principal + x.interest)).toEqual([300_000, 280_000, 260_000, 240_000, 220_000]);

    // First installment paid on its due date.
    await asAna.mutation(api.payments.record, {
      businessId, opId: op(), loanId, loanVersion: s.loans[0].version, amount: 300_000, fee: 0,
      paidOn: s.loans[0].schedule[0].due, notes: "", instruction: { kind: "auto" },
    });
    // The hourly job writes down the fees of installments 2 and 3 (overdue).
    await t.mutation(internal.lateFees.refreshBusiness, { businessId });
    s = await snapshot();
    expect(s.lateFees.map((f) => [f.seq, f.baseAmount, f.amount])).toEqual([
      [2, 280_000, 14_000],
      [3, 280_000, 14_000], // capital of installment 2 was still owed when 3 began
    ]);
    // Running it again changes nothing.
    expect(await t.mutation(internal.lateFees.refreshBusiness, { businessId })).toBe(0);

    // Installment 2 with its fee: fee first, then interest, then capital.
    await asAna.mutation(api.payments.record, {
      businessId, opId: op(), loanId, loanVersion: s.loans[0].version, amount: 294_000, fee: 0, paidOn: today, notes: "",
      instruction: { kind: "installment", seq: 2 },
    });
    s = await snapshot();
    const second = s.payments.find((p) => p.amount === 294_000)!;
    expect(second.applied).toEqual([{ seq: 2, principal: 200_000, interest: 80_000, fee: 14_000 }]);

    // Waiving installment 3's fee keeps the record, with its reason.
    await asAna.mutation(api.loans.setLateFeeWaived, {
      businessId, loanId, expectedVersion: s.loans[0].version, seq: 3, waived: true, reason: "Acuerdo con el cliente",
    });
    s = await snapshot();
    expect(s.lateFees.find((f) => f.seq === 3)).toMatchObject({ waiveReason: "Acuerdo con el cliente" });

    // Two accounts: capital first, repaid capital back to capital.
    const capitalBack = 200_000 + 200_000;
    const interestIn = 100_000 + 80_000 + 14_000;
    const { balancesOn, buildBook } = await import("../shared/domain");
    const b = balancesOn(buildBook(s as never), today);
    expect(b).toEqual({ capital: 2_000_000 - 1_000_000 + capitalBack, interest: interestIn });

    // Every change is in the history, with who made it.
    const log = await asAna.query(api.data.changes, { businessId, paginationOpts: { numItems: 50, cursor: null } });
    expect(log.page.filter((c) => c.entity === "payment" && c.action === "create")).toHaveLength(2);
    expect(log.page.every((c) => c.userId === ana.subject || c.userId === "system")).toBe(true);
    expect(log.page.some((c) => c.entity === "late_fee" && c.reason === "Acuerdo con el cliente")).toBe(true);
  });

  it("records a retried offline payment once", async () => {
    const start = addMonths(today, -1);
    await asAna.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 2_000_000, occurredOn: start, notes: "" });
    const loanId = await asAna.mutation(api.loans.create, {
      businessId, clientId, terms: terms(start, "interest_only", null), schedule: null, notes: "",
    });
    const loanVersion = (await snapshot()).loans[0].version;
    const args = {
      businessId, opId: "0f8b6c1e-2b8f-4c38-9d4a-5f0d7f3c9a11", loanId, loanVersion, amount: 100_000, fee: 0, paidOn: today,
      notes: "", instruction: { kind: "auto" as const }, deviceRecordedAt: Date.now() - 60_000,
    };
    const first = await asAna.mutation(api.payments.record, args);
    const again = await asAna.mutation(api.payments.record, args);
    expect(again).toEqual({ ...first, duplicate: true });
    const s = await snapshot();
    expect(s.payments).toHaveLength(1);
    expect(s.payments[0].recordedOffline).toBe(true);
  });

  it("holds back a payment entered on an out-of-date loan until confirmed", async () => {
    const start = addMonths(today, -1);
    await asAna.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 2_000_000, occurredOn: start, notes: "" });
    const loanId = await asAna.mutation(api.loans.create, {
      businessId, clientId, terms: terms(start, "interest_only", null), schedule: null, notes: "",
    });
    const seen = (await snapshot()).loans[0].version;
    // Another device records a payment first.
    await asAna.mutation(api.payments.record, {
      businessId, opId: op(), loanId, loanVersion: seen, amount: 100_000, fee: 0, paidOn: today, notes: "", instruction: { kind: "auto" },
    });
    const late = {
      businessId, opId: op(), loanId, loanVersion: seen, amount: 100_000, fee: 0, paidOn: today, notes: "", instruction: { kind: "auto" as const },
    };
    const err = await errorOf(asAna.mutation(api.payments.record, late));
    expect(err).toMatchObject({ code: "stale", seen });
    expect((err.recent as unknown[]).length).toBe(1);
    await asAna.mutation(api.payments.record, { ...late, confirmedStale: true });
    expect((await snapshot()).payments).toHaveLength(2);
  });

  it("refuses an edit made from an older copy of the record", async () => {
    await asAna.mutation(api.clients.update, {
      businessId, clientId, expectedVersion: 1, fullName: "María P.", phone: "", email: "", idNumber: "", address: "", notes: "",
    });
    expect(
      await errorOf(asAna.mutation(api.clients.update, {
        businessId, clientId, expectedVersion: 1, fullName: "Otra", phone: "", email: "", idNumber: "", address: "", notes: "",
      })),
    ).toMatchObject({ code: "conflict", current: 2, expected: 1 });
  });

  it("refuses an expense the account can't cover, and never goes below zero", async () => {
    const start = addMonths(today, -1);
    await asAna.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 100_000, occurredOn: start, notes: "" });
    expect(
      await errorOf(asAna.mutation(api.money.addEntry, {
        businessId, opId: op(), kind: "expense", account: "interest", amount: 1, occurredOn: today, description: "Papel",
      })),
    ).toMatchObject({ code: "insufficient_cash", available: 0, account: "interest" });
    await asAna.mutation(api.money.addEntry, {
      businessId, opId: op(), kind: "expense", account: "capital", amount: 60_000, occurredOn: today, description: "Alquiler",
    });
    // Deleting the capital now would leave the account below zero.
    const cap = (await snapshot()).capital[0];
    expect(await errorOf(asAna.mutation(api.money.removeCapital, { businessId, id: cap._id, expectedVersion: cap.version, reason: "" }))).toMatchObject({
      code: "cash_shortfall",
    });
    // Income needs no balance and is recorded once per operation id.
    const id = op();
    await asAna.mutation(api.money.addEntry, { businessId, opId: id, kind: "income", account: "interest", amount: 5_000, occurredOn: today, description: "Venta" });
    await asAna.mutation(api.money.addEntry, { businessId, opId: id, kind: "income", account: "interest", amount: 5_000, occurredOn: today, description: "Venta" });
    expect((await snapshot()).entries.filter((e) => e.kind === "income")).toHaveLength(1);
  });

  it("refuses dates in the business's future", async () => {
    expect(
      await errorOf(asAna.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 1, occurredOn: addDays(today, 1), notes: "" })),
    ).toMatchObject({ code: "invalid", reason: "future" });
  });
});
