// The desktop engine's unit tests (src/domain/*.rs), ported with the same
// hand-checked figures. If one of these fails, the PWA and the desktop app
// would disagree about money.

import { describe, expect, it } from "vitest";
import { addMonths, MAX_DAY, todayIn } from "./dates";
import {
  checkSchedule,
  feesAssessed,
  installmentStatus,
  installmentTotal,
  interestPaid,
  planDelinquency,
  planPaidOff,
  planPosition,
  principalOutstanding,
  proposedSchedule,
  remaining,
  run,
  type Instruction,
  type Plan,
  type PlanPayment,
} from "./installments";
import {
  allocate,
  delinquency,
  displayStatus,
  emptyDelinquency,
  paysOff,
  periodStates,
  position,
  reallocate,
  type LoanFacts,
  type PaymentFact,
} from "./ledger";
import { dueDate, effectiveRate, frequencyDays, periodInterest, periodStart, validateTerms, type Frequency, type LoanTerms } from "./loans";
import { formatCompact, formatMoney, formatSigned, formatWhole, parseMoney, parseRate, ratePercentLabel, ratioLabel } from "./money";
import {
  availableFrom,
  balancesOn,
  cashOn,
  gain,
  history,
  monthlyCashFlow,
  netInvested,
  realizedIncome,
  shortfall,
  summary,
  totalIncome,
  type Book,
  type LoanBook,
} from "./portfolio";

const d = (y: number, m: number, day: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

describe("money", () => {
  it("parses money", () => {
    expect(parseMoney("1,250.5")).toEqual({ ok: true, value: 125_050 });
    expect(parseMoney("$300")).toEqual({ ok: true, value: 30_000 });
    expect(parseMoney(" 0.07 ")).toEqual({ ok: true, value: 7 });
    expect(parseMoney(".5")).toEqual({ ok: true, value: 50 });
    expect(parseMoney("12.345")).toEqual({ ok: false, error: { code: "too_many_decimals", decimals: 2 } });
    expect(parseMoney("-5")).toEqual({ ok: false, error: { code: "negative" } });
    expect(parseMoney("abc")).toEqual({ ok: false, error: { code: "empty" } });
    expect(parseMoney("1.2.3")).toEqual({ ok: false, error: { code: "invalid" } });
    expect(parseMoney("")).toEqual({ ok: false, error: { code: "empty" } });
    expect(parseMoney("10000000000.01")).toEqual({ ok: false, error: { code: "too_large" } });
  });

  it("parses rates", () => {
    expect(parseRate("12.5")).toEqual({ ok: true, value: 125_000 });
    expect(parseRate("12.5%")).toEqual({ ok: true, value: 125_000 });
    expect(parseRate("0")).toEqual({ ok: true, value: 0 });
    expect(parseRate("7.1234")).toEqual({ ok: true, value: 71_234 });
    expect(parseRate("7.12345")).toEqual({ ok: false, error: { code: "too_many_decimals", decimals: 4 } });
    expect(parseRate("101")).toEqual({ ok: false, error: { code: "too_large" } });
    expect(ratePercentLabel(125_000)).toBe("12.5%");
    expect(ratePercentLabel(100_000)).toBe("10%");
    expect(ratePercentLabel(71_234)).toBe("7.1234%");
  });

  it("formats money", () => {
    const f = { symbol: "$", style: "comma_dot" as const };
    expect(formatMoney(f, 123_456_789)).toBe("$1,234,567.89");
    expect(formatMoney(f, 5)).toBe("$0.05");
    expect(formatMoney(f, -1_000)).toBe("−$10.00");
    expect(formatSigned(f, 1_000)).toBe("+$10.00");
    expect(formatSigned(f, 0)).toBe("$0.00");
    expect(formatCompact(f, 1_250_000)).toBe("$12.5k");
    expect(formatWhole(f, 1_250_049)).toBe("$12,500");
    expect(formatMoney({ symbol: "€", style: "dot_comma" }, 123_456_789)).toBe("€1.234.567,89");
    expect(ratioLabel(1_234, 10_000)).toBe("12.3%");
    expect(ratioLabel(1, 0)).toBeNull();
  });
});

describe("dates", () => {
  it("month math clamps", () => {
    expect(addMonths(d(2026, 1, 31), 1)).toBe(d(2026, 2, 28));
    expect(addMonths(d(2028, 1, 31), 1)).toBe(d(2028, 2, 29));
    expect(addMonths(d(2026, 1, 31), 3)).toBe(d(2026, 4, 30));
    expect(addMonths(d(2026, 11, 15), 2)).toBe(d(2027, 1, 15));
  });

  it("works out today in the business's time zone", () => {
    const now = new Date("2026-10-28T02:30:00Z");
    expect(todayIn("America/Santo_Domingo", now)).toBe("2026-10-27");
    expect(todayIn("Europe/Madrid", now)).toBe("2026-10-28");
  });
});

describe("loans", () => {
  const pr = (rate: number, per: Frequency, every: Frequency) => ({ rate, per, every });

  it("ten percent of a thousand is a hundred", () => {
    const monthly = (b: number, r: number) => periodInterest(pr(r, "monthly", "monthly"), b);
    expect(monthly(100_000, 100_000)).toBe(10_000);
    expect(monthly(100_000, 50_000)).toBe(5_000);
    expect(monthly(100_000, 150_000)).toBe(15_000);
    expect(monthly(5, 100_000)).toBe(1); // half a cent rounds up
    expect(monthly(0, 100_000)).toBe(0);
  });

  it("rates convert on a thirty-day month", () => {
    const monthly = (every: Frequency) => pr(100_000, "monthly", every);
    expect(periodInterest(monthly("monthly"), 1_000_000)).toBe(100_000);
    expect(periodInterest(monthly("biweekly"), 1_000_000)).toBe(50_000);
    expect(periodInterest(monthly("weekly"), 1_000_000)).toBe(23_333);
    expect(periodInterest(monthly("daily"), 1_000_000)).toBe(3_333);
    expect(effectiveRate(monthly("weekly"))).toBe(23_333);
    expect(periodInterest(pr(10_000, "daily", "monthly"), 100_000)).toBe(30_000);
    expect(frequencyDays("biweekly")).toBe(15);
  });

  it("due dates", () => {
    let s = d(2026, 1, 31);
    expect(dueDate("monthly", s, 1)).toBe(d(2026, 2, 28));
    expect(dueDate("monthly", s, 2)).toBe(d(2026, 3, 31));
    expect(dueDate("monthly", d(2028, 1, 31), 1)).toBe(d(2028, 2, 29));
    s = d(2026, 1, 5);
    expect(dueDate("biweekly", s, 1)).toBe(d(2026, 1, 20));
    expect(dueDate("biweekly", s, 2)).toBe(d(2026, 2, 5));
    expect(dueDate("biweekly", s, 3)).toBe(d(2026, 2, 20));
    expect(periodStart("biweekly", s, 1)).toBe(s);
    expect(periodStart("biweekly", s, 3)).toBe(d(2026, 2, 5));
    expect(dueDate("weekly", d(2026, 12, 29), 1)).toBe(d(2027, 1, 5));
    expect(dueDate("daily", d(2028, 2, 28), 1)).toBe(d(2028, 2, 29));
  });

  it("validates terms", () => {
    const t: LoanTerms = {
      principal: 100_000, rate: 100_000, interestPeriod: "monthly", frequency: "monthly",
      startDate: d(2026, 1, 1), method: "interest_only", installments: null, lateFeeRate: 0,
    };
    expect(validateTerms(t)).toBeNull();
    expect(validateTerms({ ...t, rate: 1_000_001 })).toBe("rate");
    expect(validateTerms({ ...t, principal: 0 })).toBe("principal");
    expect(validateTerms({ ...t, method: "declining" })).toBe("installments");
    expect(validateTerms({ ...t, method: "declining", installments: 5 })).toBeNull();
    expect(validateTerms({ ...t, method: "declining", installments: 0 })).toBe("installments");
    expect(validateTerms({ ...t, principal: 1.5 })).toBe("principal");
  });
});

describe("ledger (interest only)", () => {
  const loan = (principal: number, pct: number, frequency: Frequency, start: string): LoanFacts => ({
    principal,
    rate: { rate: pct * 10_000, per: frequency, every: frequency },
    frequency,
    startDate: start,
    status: "active",
    closedOn: null,
  });
  const pay = (l: LoanFacts, h: PaymentFact[], amount: number, on: string) => {
    const a = allocate(l, h, amount, 0, on, d(2030, 1, 1));
    if (!a.ok) throw new Error(JSON.stringify(a.error));
    h.push({ paidOn: on, principal: a.value.principal, interest: a.value.interest, fee: 0 });
    return a.value;
  };

  it("weekly payments on a monthly rate", () => {
    const l = loan(1_000_000, 10, "weekly", d(2026, 1, 1));
    l.rate = { rate: 100_000, per: "monthly", every: "weekly" };
    const pos = position(l, [], d(2026, 1, 8));
    expect(pos.periods.length).toBe(2);
    expect(pos.periods[0].interest).toBe(23_333);
    expect(pos.periods[1].due).toBe(d(2026, 1, 15));
  });

  it("the owner's example", () => {
    const l = loan(100_000, 10, "monthly", d(2026, 1, 1));
    const h: PaymentFact[] = [];
    expect(position(l, h, d(2026, 1, 15)).interestOutstanding).toBe(10_000);
    let a = pay(l, h, 60_000, d(2026, 2, 1));
    expect([a.interest, a.principal]).toEqual([10_000, 50_000]);
    expect(a.principalBefore).toBe(100_000);
    expect(a.principalAfter).toBe(50_000);
    const q = delinquency(l, h, d(2026, 2, 2));
    expect(q.nextDue).toBe(d(2026, 3, 1));
    expect(q.nextDueAmount).toBe(5_000);
    a = pay(l, h, 5_000, d(2026, 3, 1));
    expect([a.interest, a.principal]).toEqual([5_000, 0]);
    expect(position(l, h, d(2026, 3, 2)).interestOutstanding).toBe(5_000);
  });

  it("early payment in the period still covers its interest first", () => {
    const l = loan(100_000, 10, "monthly", d(2026, 1, 1));
    const h: PaymentFact[] = [];
    const a = pay(l, h, 60_000, d(2026, 1, 20));
    expect([a.interest, a.principal]).toEqual([10_000, 50_000]);
    const q = delinquency(l, h, d(2026, 1, 25));
    expect(q.overdueAmount).toBe(0);
    expect(q.nextDue).toBe(d(2026, 3, 1));
    expect(q.nextDueAmount).toBe(5_000);
  });

  it("biweekly periods", () => {
    const l = loan(200_000, 5, "biweekly", d(2026, 1, 5));
    const h: PaymentFact[] = [];
    expect(pay(l, h, 10_000, d(2026, 1, 20)).interest).toBe(10_000);
    const pos = position(l, h, d(2026, 1, 20));
    expect(pos.periods.length).toBe(2);
    expect(pos.periods[1].due).toBe(d(2026, 2, 5));
  });

  it("partial interest carries over without compounding", () => {
    const l = loan(100_000, 10, "monthly", d(2026, 1, 1));
    const h: PaymentFact[] = [];
    pay(l, h, 4_000, d(2026, 2, 1));
    const pos = position(l, h, d(2026, 2, 1));
    expect(pos.interestOutstanding).toBe(16_000);
    expect(pos.principalOutstanding).toBe(100_000);
    const q = delinquency(l, h, d(2026, 2, 2));
    expect(q.overdueAmount).toBe(6_000);
    expect(q.daysOverdue).toBe(1);
    expect(q.overdueSince).toBe(d(2026, 2, 1));
    expect([q.nextDue, q.nextDueAmount]).toEqual([d(2026, 3, 1), 16_000]);
    expect(displayStatus(l, q, d(2026, 2, 2))).toBe("overdue");
    const a = pay(l, h, 20_000, d(2026, 2, 10));
    expect([a.interest, a.principal]).toEqual([16_000, 4_000]);
  });

  it("the due date is not overdue, the day after is", () => {
    const l = loan(100_000, 10, "monthly", d(2026, 1, 1));
    let q = delinquency(l, [], d(2026, 2, 1));
    expect(q.overdueAmount).toBe(0);
    expect(displayStatus(l, q, d(2026, 2, 1))).toBe("due_soon");
    q = delinquency(l, [], d(2026, 2, 2));
    expect(q.overdueAmount).toBe(10_000);
  });

  it("payoff closes and overpayment is refused", () => {
    const l = loan(100_000, 10, "monthly", d(2026, 1, 1));
    const h: PaymentFact[] = [];
    expect(allocate(l, h, 200_000, 0, d(2026, 1, 10), d(2030, 1, 1))).toEqual({
      ok: false,
      error: { code: "overpayment", payoff: 110_000 },
    });
    const a = pay(l, h, 110_000, d(2026, 1, 10));
    expect(paysOff(a)).toBe(true);
    const pos = position(l, h, d(2026, 6, 1));
    expect(pos.principalOutstanding + pos.interestOutstanding).toBe(0);
    expect(pos.periods.length).toBe(1);
  });

  it("validation", () => {
    const l = loan(100_000, 10, "monthly", d(2026, 1, 1));
    const h: PaymentFact[] = [];
    pay(l, h, 1_000, d(2026, 3, 1));
    const today = d(2026, 4, 1);
    const err = (r: ReturnType<typeof allocate>) => (r.ok ? null : r.error);
    expect(err(allocate(l, h, 100, 0, d(2026, 2, 1), today))).toEqual({ code: "before_last_payment", last: d(2026, 3, 1) });
    expect(err(allocate(l, h, 100, 0, d(2026, 4, 2), today))).toEqual({ code: "in_future" });
    expect(err(allocate(l, h, 100, 0, d(2025, 12, 31), today))).toEqual({ code: "before_start" });
    expect(err(allocate(l, h, 0, 0, today, today))).toEqual({ code: "not_positive" });
    expect(err(allocate(l, h, 100, 200, today, today))).toEqual({ code: "fee_too_large" });
    expect(err(allocate({ ...l, status: "paid_off" }, h, 100, 0, today, today))).toEqual({ code: "loan_closed" });
  });

  it("the fee comes first", () => {
    const l = loan(100_000, 10, "monthly", d(2026, 1, 1));
    const a = allocate(l, [], 15_000, 2_500, d(2026, 1, 10), d(2030, 1, 1));
    expect(a.ok && [a.value.fee, a.value.interest, a.value.principal]).toEqual([2_500, 10_000, 2_500]);
  });

  it("a default stops new interest", () => {
    const l = { ...loan(100_000, 10, "monthly", d(2026, 1, 1)), status: "defaulted" as const, closedOn: d(2026, 2, 15) };
    expect(position(l, [], d(2026, 12, 1)).interestOutstanding).toBe(20_000);
    expect(delinquency(l, [], d(2026, 12, 1))).toEqual(emptyDelinquency());
  });

  it("reallocation follows edited terms", () => {
    const payments = [
      { paidOn: d(2026, 2, 1), amount: 60_000, fee: 0 },
      { paidOn: d(2026, 3, 1), amount: 5_000, fee: 0 },
    ];
    const today = d(2026, 6, 1);
    let r = reallocate(loan(100_000, 10, "monthly", d(2026, 1, 1)), payments, today);
    expect(r.ok && r.value.map((a) => [a.interest, a.principal])).toEqual([[10_000, 50_000], [5_000, 0]]);
    r = reallocate(loan(200_000, 10, "monthly", d(2026, 1, 1)), payments, today);
    expect(r.ok && r.value.map((a) => [a.interest, a.principal])).toEqual([[20_000, 40_000], [5_000, 0]]);
    expect(r.ok && r.value[1].interestAfter).toBe(11_000);
    r = reallocate(loan(40_000, 10, "monthly", d(2026, 1, 1)), payments, today);
    expect(r).toEqual({ ok: false, error: { index: 0, error: { code: "overpayment", payoff: 44_000 } } });
    r = reallocate(loan(100_000, 10, "monthly", d(2026, 2, 15)), payments, today);
    expect(r).toEqual({ ok: false, error: { index: 0, error: { code: "before_start" } } });
  });

  it("nothing is owed after a payoff", () => {
    const l = loan(100_000, 10, "monthly", d(2026, 1, 1));
    const r = reallocate(
      l,
      [
        { paidOn: d(2026, 1, 10), amount: 110_000, fee: 0 },
        { paidOn: d(2026, 2, 1), amount: 1_000, fee: 0 },
      ],
      d(2026, 6, 1),
    );
    expect(r).toEqual({ ok: false, error: { index: 1, error: { code: "overpayment", payoff: 0 } } });
  });

  it("period states cover oldest first", () => {
    const l = loan(100_000, 10, "monthly", d(2026, 1, 1));
    const h: PaymentFact[] = [];
    pay(l, h, 15_000, d(2026, 2, 1));
    const pos = position(l, h, d(2026, 3, 5));
    const s = periodStates(pos, d(2026, 3, 5));
    expect(s.length).toBe(3);
    expect(pos.periods[1].balance).toBe(95_000);
    expect(s.map((x) => x.state)).toEqual(["paid", "overdue", "open"]);
  });
});

describe("installments", () => {
  const facts = (principal: number, pct: number): LoanFacts => ({
    principal,
    rate: { rate: pct * 10_000, per: "monthly", every: "monthly" },
    frequency: "monthly",
    startDate: d(2026, 1, 1),
    status: "active",
    closedOn: null,
  });
  const plan = (f: LoanFacts, method: "declining" | "flat", n: number): Plan => ({
    method,
    schedule: proposedSchedule(f, method, n),
    edited: false,
    feeRate: 50_000,
    waived: [],
  });
  const pay = (on: string, amount: number, instruction: Instruction): PlanPayment => ({ paidOn: on, amount, instruction });
  const ok = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value;
  };
  const AUTO: Instruction = { kind: "auto" };
  const FAR = MAX_DAY;

  it("the declining example", () => {
    const f = facts(1_000_000, 10);
    const s = proposedSchedule(f, "declining", 5);
    expect(s.map((x) => [x.principal, x.interest, installmentTotal(x)])).toEqual([
      [200_000, 100_000, 300_000],
      [200_000, 80_000, 280_000],
      [200_000, 60_000, 260_000],
      [200_000, 40_000, 240_000],
      [200_000, 20_000, 220_000],
    ]);
    expect(s[0].due).toBe(d(2026, 2, 1));
    expect(checkSchedule(f.principal, f.startDate, s)).toBeNull();
    const st = ok(run(f, plan(f, "declining", 5), s.map((x) => pay(x.due, installmentTotal(x), AUTO)), FAR, FAR));
    expect(planPaidOff(st)).toBe(true);
    expect(interestPaid(st)).toBe(300_000);
    expect(feesAssessed(st)).toBe(0);
  });

  it("flat interest is on the original amount", () => {
    const s = proposedSchedule(facts(1_000_000, 10), "flat", 5);
    expect(s.every((x) => x.interest === 100_000 && x.principal === 200_000)).toBe(true);
  });

  it("rounding goes to the last installment", () => {
    const s = proposedSchedule(facts(1_000_000, 10), "declining", 3);
    expect(s.map((x) => x.principal)).toEqual([333_333, 333_333, 333_334]);
    expect(s[1].interest).toBe(66_667);
  });

  it("a partial payment leaves the rest outstanding and a fee once", () => {
    const f = facts(1_000_000, 10);
    const p = plan(f, "declining", 5);
    const pays = [pay(d(2026, 2, 1), 100_000, { kind: "installment", seq: 1 })];
    let st = ok(run(f, p, pays, d(2026, 2, 1), FAR));
    let first = st.installments[0];
    expect([first.paidInterest, first.paidPrincipal]).toEqual([100_000, 0]);
    expect(installmentStatus(first, d(2026, 2, 1))).toBe("partly_paid");
    expect(first.fee).toBe(0);
    st = ok(run(f, p, pays, d(2026, 2, 2), FAR));
    first = st.installments[0];
    expect([first.feeBase, first.fee, first.feeAssessedOn]).toEqual([200_000, 10_000, d(2026, 2, 2)]);
    expect(installmentStatus(first, d(2026, 2, 2))).toBe("overdue");
    expect(ok(run(f, p, pays, d(2026, 2, 20), FAR)).installments[0].fee).toBe(10_000);
    const later = [...pays, pay(d(2026, 2, 10), 50_000, { kind: "installment", seq: 1 })];
    first = ok(run(f, p, later, d(2026, 2, 10), FAR)).installments[0];
    expect(first.fee).toBe(10_000);
    expect([first.paidFee, first.paidPrincipal]).toEqual([10_000, 40_000]);
  });

  it("late capital keeps the next interest higher", () => {
    const f = facts(1_000_000, 10);
    const st = ok(run(f, plan(f, "declining", 5), [pay(d(2026, 2, 1), 100_000, AUTO)], d(2026, 2, 2), FAR));
    expect(st.installments[1].interest).toBe(100_000);
    expect(st.installments[0].fee).toBe(10_000);
  });

  it("auto payment fills oldest first and refuses too much", () => {
    const f = facts(1_000_000, 10);
    const p = plan(f, "declining", 5);
    const st = ok(run(f, p, [pay(d(2026, 2, 1), 400_000, AUTO)], FAR, FAR));
    expect(st.payments[0]).toEqual([
      { seq: 1, principal: 200_000, interest: 100_000, fee: 0 },
      { seq: 2, principal: 100_000, interest: 0, fee: 0 },
    ]);
    expect(st.installments[1].interest).toBe(70_000);
    expect(run(f, p, [pay(d(2026, 2, 1), 2_000_000, AUTO)], FAR, FAR)).toEqual({
      ok: false,
      error: { index: 0, error: { code: "overpayment", payoff: 1_100_000 } },
    });
  });

  it("spread and custom splits", () => {
    const f = facts(1_000_000, 10);
    const p = plan(f, "flat", 5);
    const spread: Instruction = { kind: "spread", parts: [{ seq: 1, amount: 315_000 }, { seq: 2, amount: 100_000 }] };
    let st = ok(run(f, p, [pay(d(2026, 3, 5), 415_000, spread)], FAR, FAR));
    expect(remaining(st.installments[0])).toBe(0);
    expect([st.installments[1].paidFee, st.installments[1].paidInterest]).toEqual([15_000, 85_000]);
    const bad: Instruction = { kind: "spread", parts: [{ seq: 1, amount: 100_000 }] };
    const e = run(f, p, [pay(d(2026, 3, 5), 200_000, bad)], FAR, FAR);
    expect(!e.ok && e.error.error).toEqual({ code: "split_mismatch", allocated: 100_000, amount: 200_000 });
    st = ok(run(f, p, [pay(d(2026, 1, 10), 500_000, { kind: "custom", principal: 500_000, interest: 0, fee: 0 })], FAR, FAR));
    expect(principalOutstanding(st)).toBe(500_000);
    expect(st.installments[0].paidPrincipal).toBe(200_000);
    expect(st.installments[2].paidPrincipal).toBe(100_000);
    const tooMuch = run(f, p, [pay(d(2026, 1, 10), 200_000, { kind: "custom", principal: 0, interest: 200_000, fee: 0 })], FAR, FAR);
    expect(!tooMuch.ok && tooMuch.error.error).toEqual({ code: "exceeds_part", part: "interest", owed: 100_000 });
  });

  it("stored splits replay exactly", () => {
    const f = facts(1_000_000, 10);
    const p = plan(f, "declining", 5);
    const pays = [pay(d(2026, 2, 1), 300_000, AUTO), pay(d(2026, 3, 9), 100_000, { kind: "installment", seq: 2 })];
    const live = ok(run(f, p, pays, FAR, FAR));
    const fixed = pays.map((x, i) => ({ ...x, instruction: { kind: "fixed" as const, applied: live.payments[i] } }));
    expect(ok(run(f, p, fixed, FAR, FAR))).toEqual(live);
  });

  it("a waived fee and delinquency", () => {
    const f = facts(1_000_000, 10);
    const p = plan(f, "declining", 5);
    const today = d(2026, 2, 10);
    let st = ok(run(f, p, [], today, today));
    const q = planDelinquency(st, "active", today);
    expect([q.overdueAmount, q.overdueSince, q.daysOverdue]).toEqual([315_000, d(2026, 2, 1), 9]);
    expect(q.nextDue).toBe(d(2026, 3, 1));
    expect(q.nextDueAmount).toBe(315_000 + 300_000);
    st = ok(run(f, { ...p, waived: [1] }, [], today, today));
    expect([st.installments[0].fee, st.installments[0].feeBase]).toEqual([0, 300_000]);
    expect(planPosition(st).feesOutstanding).toBe(0);
  });

  it("an edited schedule keeps its interest", () => {
    const f = facts(1_000_000, 10);
    const p = plan(f, "declining", 2);
    p.schedule[0].interest = 50_000;
    p.schedule[1].interest = 50_000;
    p.edited = true;
    expect(ok(run(f, p, [pay(d(2026, 2, 1), 100_000, AUTO)], FAR, FAR)).installments[1].interest).toBe(50_000);
    const bad = p.schedule.map((x) => ({ ...x }));
    bad[1].principal = 400_000;
    expect(checkSchedule(f.principal, f.startDate, bad)).toEqual({ code: "unallocated", allocated: 900_000, principal: 1_000_000 });
    bad[1].principal = 500_000;
    bad[1].due = bad[0].due;
    expect(checkSchedule(f.principal, f.startDate, bad)).toEqual({ code: "date_order", seq: 2 });
  });

  it("weekly installments on a monthly rate", () => {
    let f: LoanFacts = { ...facts(1_000_000, 10), frequency: "weekly", rate: { rate: 100_000, per: "monthly", every: "weekly" } };
    let s = proposedSchedule(f, "declining", 4);
    expect(s[0].interest).toBe(23_333);
    expect(s[1].due).toBe(d(2026, 1, 15));
    f = { ...facts(1_000_000, 1), frequency: "daily", rate: { rate: 10_000, per: "daily", every: "daily" } };
    s = proposedSchedule(f, "flat", 10);
    expect([s[0].interest, s[9].due]).toEqual([10_000, d(2026, 1, 11)]);
  });
});

describe("portfolio", () => {
  const loan = (id: string, principal: number, start: string): LoanBook => ({
    id,
    clientId: "c1",
    facts: {
      principal,
      rate: { rate: 100_000, per: "monthly", every: "monthly" },
      frequency: "monthly",
      startDate: start,
      status: "active",
      closedOn: null,
    },
    payments: [],
    plan: null,
  });
  const pay = (l: LoanBook, amount: number, on: string) => {
    const a = allocate(l.facts, l.payments, amount, 0, on, d(2030, 1, 1));
    if (!a.ok) throw new Error(JSON.stringify(a.error));
    l.payments.push({ paidOn: on, principal: a.value.principal, interest: a.value.interest, fee: 0 });
    if (paysOff(a.value)) l.facts.status = "paid_off";
  };
  // Jan 1: add 20,000 of capital; lend 10,000 at 10% a month.
  // Feb 1: 3,000 paid = 1,000 interest + 2,000 capital. Mar 1: 800 interest.
  // Apr 15: withdraw 1,000 (April's 800 is left unpaid).
  const fixture = (): Book => {
    const l = loan("l1", 1_000_000, d(2026, 1, 1));
    pay(l, 300_000, d(2026, 2, 1));
    pay(l, 80_000, d(2026, 3, 1));
    return {
      loans: [l],
      capital: [
        { kind: "contribution", amount: 2_000_000, occurredOn: d(2026, 1, 1) },
        { kind: "withdrawal", amount: 100_000, occurredOn: d(2026, 4, 15) },
      ],
      entries: [],
    };
  };

  it("lending is not a loss and capital back is not income", () => {
    const book = fixture();
    let s = summary(book, d(2026, 1, 1));
    expect(s.availableCash).toBe(1_000_000);
    expect(s.outstandingPrincipal).toBe(1_000_000);
    expect(s.interestReceivable).toBe(0);
    expect(s.portfolioValue).toBe(2_000_000);
    expect(gain(s)).toBe(0);
    s = summary(book, d(2026, 2, 1));
    expect(s.interestCollected).toBe(100_000);
    expect(s.principalRepaid).toBe(200_000);
    expect(s.outstandingPrincipal).toBe(800_000);
    expect(realizedIncome(s)).toBe(100_000);
    expect(gain(s)).toBe(100_000);
  });

  it("payments fill the two accounts", () => {
    const book = fixture();
    let s = summary(book, d(2026, 3, 1));
    expect([s.availableCapital, s.availableInterest]).toEqual([1_200_000, 180_000]);
    s = summary(book, d(2026, 4, 15));
    expect([s.availableCapital, s.availableInterest]).toEqual([1_100_000, 180_000]);
  });

  it("loans use capital first, then interest", () => {
    const book = fixture();
    book.loans.push(loan("l2", 1_250_000, d(2026, 3, 2)));
    let b = balancesOn(book, d(2026, 3, 2));
    expect([b.capital, b.interest]).toEqual([0, 130_000]);
    pay(book.loans[1], 1_250_000 + 125_000, d(2026, 4, 2));
    b = balancesOn(book, d(2026, 4, 2));
    expect([b.capital, b.interest]).toEqual([1_250_000, 255_000]);
  });

  it("expenses and transfers move only their account", () => {
    const book = fixture();
    book.entries.push({ kind: "expense", account: "interest", amount: 50_000, occurredOn: d(2026, 3, 5) });
    book.entries.push({ kind: "transfer", account: "interest", amount: 100_000, occurredOn: d(2026, 3, 6) });
    book.entries.push({ kind: "expense", account: "capital", amount: 20_000, occurredOn: d(2026, 3, 7) });
    const before = summary(book, d(2026, 3, 1));
    const s = summary(book, d(2026, 3, 7));
    expect(s.availableInterest).toBe(180_000 - 50_000 - 100_000);
    expect(s.availableCapital).toBe(1_200_000 + 100_000 - 20_000);
    expect(s.interestCollected).toBe(before.interestCollected);
    expect(netInvested(s)).toBe(netInvested(before) - 20_000);
    expect(gain(s)).toBe(gain(before) - 50_000);
  });

  it("adjustments correct an account", () => {
    const book = fixture();
    book.entries.push({ kind: "adjustment", account: "capital", amount: -30_000, occurredOn: d(2026, 3, 10) });
    book.entries.push({ kind: "adjustment", account: "interest", amount: 5_000, occurredOn: d(2026, 3, 10) });
    const s = summary(book, d(2026, 3, 10));
    expect([s.availableCapital, s.availableInterest]).toEqual([1_170_000, 185_000]);
    expect(netInvested(s)).toBe(2_000_000 - 30_000);
  });

  it("shortfall finds the first negative account", () => {
    const book = fixture();
    expect(shortfall(book)).toBeNull();
    book.entries.push({ kind: "expense", account: "interest", amount: 200_000, occurredOn: d(2026, 3, 5) });
    expect(shortfall(book)).toEqual({ date: d(2026, 3, 5), account: "interest", balance: -20_000 });
    book.entries = [];
    book.loans.push(loan("l2", 2_000_000, d(2026, 3, 2)));
    expect(shortfall(book)).toEqual({ date: d(2026, 3, 2), account: null, balance: 1_380_000 - 2_000_000 });
  });

  it("availability looks ahead", () => {
    const book = fixture();
    expect(availableFrom(book, d(2026, 1, 1), null)).toBe(1_000_000);
    expect(availableFrom(book, d(2026, 3, 15), null)).toBe(1_280_000);
    expect(availableFrom(book, d(2026, 3, 15), "capital")).toBe(1_100_000);
    expect(availableFrom(book, d(2026, 3, 15), "interest")).toBe(180_000);
  });

  it("unpaid interest is receivable once due", () => {
    const book = fixture();
    expect(summary(book, d(2026, 3, 31)).interestReceivable).toBe(0);
    const s = summary(book, d(2026, 4, 1));
    expect(s.interestReceivable).toBe(80_000);
    expect(gain(s)).toBe(100_000 + 80_000 + 80_000);
    expect(s.expectedMonthlyInterest).toBe(80_000);
  });

  it("a withdrawal is not a loss", () => {
    const book = fixture();
    const before = summary(book, d(2026, 4, 14));
    const after = summary(book, d(2026, 4, 15));
    expect(netInvested(after)).toBe(1_900_000);
    expect(gain(after)).toBe(gain(before));
  });

  it("ledger invariants hold every day", () => {
    const book = fixture();
    book.entries.push({ kind: "expense", account: "interest", amount: 30_000, occurredOn: d(2026, 3, 5) });
    book.entries.push({ kind: "transfer", account: "interest", amount: 50_000, occurredOn: d(2026, 3, 9) });
    book.entries.push({ kind: "adjustment", account: "capital", amount: 7_000, occurredOn: d(2026, 5, 1) });
    book.entries.push({ kind: "income", account: "interest", amount: 12_000, occurredOn: d(2026, 6, 2) });
    book.entries.push({ kind: "income", account: "capital", amount: 40_000, occurredOn: d(2026, 7, 3) });
    for (let day = d(2025, 12, 30); day <= d(2026, 12, 31); day = nextDay(day)) {
      const s = summary(book, day);
      expect(s.availableCash + s.outstandingPrincipal + s.defaultedPrincipal).toBe(
        netInvested(s) + s.interestCollected + s.feesCollected + s.interestAdjustments + s.otherIncome - s.interestExpenses,
      );
      expect(gain(s)).toBe(
        totalIncome(s) + s.interestAdjustments - s.interestExpenses + s.interestReceivable - s.defaultedPrincipal,
      );
      expect(cashOn(book, day)).toBe(s.availableCash);
    }
  });

  it("a default writes down the balance", () => {
    const book = fixture();
    book.loans[0].facts.status = "defaulted";
    book.loans[0].facts.closedOn = d(2026, 5, 10);
    expect(summary(book, d(2026, 5, 9)).defaultedPrincipal).toBe(0);
    const s = summary(book, d(2026, 6, 1));
    expect(s.outstandingPrincipal).toBe(0);
    expect(s.defaultedPrincipal).toBe(800_000);
    expect(s.activeLoans).toBe(0);
    expect(s.portfolioValue).toBe(s.availableCash);
  });

  it("overdue totals roll up", () => {
    const s = summary(fixture(), d(2026, 4, 10));
    expect(s.overdueLoans).toBe(1);
    expect(s.overdueAmount).toBe(80_000);
  });

  it("history uses real end-of-day values", () => {
    const book = fixture();
    const h = history(book, d(2026, 1, 1), d(2026, 3, 1));
    expect(h[0].date).toBe(d(2026, 1, 1));
    expect(h[h.length - 1].date).toBe(d(2026, 3, 1));
    expect(h.length).toBe(60);
    for (const p of h) expect(p.portfolioValue).toBe(summary(book, p.date).portfolioValue);
    for (let i = 1; i < h.length; i++) expect(h[i].portfolioValue).toBeGreaterThanOrEqual(h[i - 1].portfolioValue);
  });

  it("monthly cash flow reconciles to cash", () => {
    const book = fixture();
    book.entries.push({ kind: "expense", account: "interest", amount: 30_000, occurredOn: d(2026, 4, 3) });
    const flows = monthlyCashFlow(book, d(2026, 4, 20));
    expect(flows.length).toBe(4);
    expect(flows[0].contributions).toBe(2_000_000);
    expect(flows[0].disbursed).toBe(1_000_000);
    expect([flows[1].interestReceived, flows[1].principalReturned]).toEqual([100_000, 200_000]);
    expect(flows[2].interestReceived).toBe(80_000);
    expect([flows[3].withdrawals, flows[3].expenses]).toEqual([100_000, 30_000]);
    expect(flows[flows.length - 1].endingCash).toBe(cashOn(book, d(2026, 4, 20)));
  });
});

function nextDay(day: string): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
