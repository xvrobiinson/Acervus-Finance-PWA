// Loan contracts, ported from the desktop app (src/domain/loans.rs).
//
// A loan is a principal lent at a percentage per **interest period** (for
// example 10% a month) and repaid on a separate **payment frequency** (daily,
// weekly, every 15 days or monthly). When the two differ, the rate is
// converted in proportion to their lengths on a 30-day month (10% a month
// paid weekly is 10% × 7/30 each week).

import { addDays, addMonths, type Day } from "./dates";
import { mulDiv, mulMulDiv, RATE_SCALE, type Cents, type Rate } from "./money";

export type Frequency = "daily" | "weekly" | "biweekly" | "monthly";
export const FREQUENCIES: Frequency[] = ["daily", "weekly", "biweekly", "monthly"];

/** Length in days for converting rates, on a 30-day month. */
export function frequencyDays(f: Frequency): number {
  switch (f) {
    case "daily":
      return 1;
    case "weekly":
      return 7;
    case "biweekly":
      return 15;
    case "monthly":
      return 30;
  }
}

/** End (due date) of period `k`, 1-based. Always counted from the start date
 *  so month-end dates never drift. Every 15 days: 15 days after the start day,
 *  then the start day of the next month, and so on. */
export function dueDate(f: Frequency, start: Day, k: number): Day {
  switch (f) {
    case "daily":
      return addDays(start, k);
    case "weekly":
      return addDays(start, 7 * k);
    case "biweekly": {
      const base = addMonths(start, Math.floor(k / 2));
      return k % 2 === 1 ? addDays(base, 15) : base;
    }
    case "monthly":
      return addMonths(start, k);
  }
}

/** Start of period `k` (the previous period's due date, or the loan start). */
export function periodStart(f: Frequency, start: Day, k: number): Day {
  return k <= 1 ? start : dueDate(f, start, k - 1);
}

/** An amount per period `per` turned into an amount per period `every`, on a
 *  30-day month, rounded half-up to the cent. */
export function convertPerPeriod(amount: Cents, per: Frequency, every: Frequency): Cents {
  return mulDiv(amount, frequencyDays(every), frequencyDays(per));
}

export type Method = "declining" | "flat" | "interest_only";
export const METHODS: Method[] = ["declining", "flat", "interest_only"];

export function hasInstallments(m: Method): boolean {
  return m !== "interest_only";
}

/** A rate quoted per interest period `per`, charged on a payment period `every`. */
export interface PeriodRate {
  rate: Rate;
  per: Frequency;
  every: Frequency;
}

/** One payment period's interest on `balance`, rounded half-up. */
export function periodInterest(r: PeriodRate, balance: Cents): Cents {
  if (balance <= 0 || r.rate <= 0) return 0;
  return mulMulDiv(balance, r.rate, frequencyDays(r.every), RATE_SCALE * frequencyDays(r.per));
}

/** The rate per payment period (rounded to 0.0001%). */
export function effectiveRate(r: PeriodRate): Rate {
  return mulDiv(r.rate, frequencyDays(r.every), frequencyDays(r.per));
}

export function rateConverts(r: PeriodRate): boolean {
  return r.per !== r.every;
}

/** Common rates offered as one-tap choices: 5%, 10%, 15%. */
export const RATE_PRESETS: Rate[] = [50_000, 100_000, 150_000];
/** Highest rate accepted per period: 100%. */
export const MAX_PERIOD_RATE: Rate = RATE_SCALE;
/** Most installments a loan may have. */
export const MAX_INSTALLMENTS = 1000;

export interface LoanTerms {
  principal: Cents;
  /** Percentage charged per interest period. */
  rate: Rate;
  interestPeriod: Frequency;
  /** How often payments fall due. */
  frequency: Frequency;
  startDate: Day;
  method: Method;
  /** Number of installments; `null` for interest-only loans. */
  installments: number | null;
  /** Charged once on what is unpaid when an installment becomes overdue. */
  lateFeeRate: Rate;
}

export type TermsError = "principal" | "rate" | "installments" | "late_fee";

export function validateTerms(t: LoanTerms): TermsError | null {
  if (!Number.isSafeInteger(t.principal) || t.principal <= 0 || t.principal > 1_000_000_000_000) return "principal";
  if (!Number.isSafeInteger(t.rate) || t.rate < 0 || t.rate > MAX_PERIOD_RATE) return "rate";
  if (!Number.isSafeInteger(t.lateFeeRate) || t.lateFeeRate < 0 || t.lateFeeRate > MAX_PERIOD_RATE) return "late_fee";
  if (hasInstallments(t.method)) {
    const n = t.installments;
    if (n === null || !Number.isInteger(n) || n < 1 || n > MAX_INSTALLMENTS) return "installments";
  } else if (t.installments !== null) {
    return "installments";
  }
  return null;
}

export function termsPeriodRate(t: LoanTerms): PeriodRate {
  return { rate: t.rate, per: t.interestPeriod, every: t.frequency };
}

/** Interest of the first period, on the full principal. */
export function interestPerPeriod(t: LoanTerms): Cents {
  return periodInterest(termsPeriodRate(t), t.principal);
}
