// Input checks shared by the mutations. Convex validators check types; these
// check the business rules the desktop's database CHECK constraints and
// service functions enforced.

import { isDay, type Day } from "../../shared/domain/dates";
import { MAX_AMOUNT } from "../../shared/domain/money";
import { fail } from "./errors";

export function text(field: string, value: string, max: number, opts: { required?: boolean; oneLine?: boolean } = {}) {
  const v = value.trim();
  if (opts.required && v === "") fail("invalid", { field, reason: "required" });
  if ([...v].length > max) fail("invalid", { field, reason: "too_long", max });
  // eslint-disable-next-line no-control-regex
  if (opts.oneLine && /[\u0000-\u001f\u007f]/.test(v)) fail("invalid", { field, reason: "one_line" });
  return v;
}

export function amount(field: string, value: number, opts: { allowNegative?: boolean; allowZero?: boolean } = {}) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_AMOUNT) fail("invalid", { field, reason: "amount" });
  if (value === 0 && !opts.allowZero) fail("invalid", { field, reason: "positive" });
  if (value < 0 && !opts.allowNegative) fail("invalid", { field, reason: "positive" });
  return value;
}

export function rate(field: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) fail("invalid", { field, reason: "rate" });
  return value;
}

export function day(field: string, value: string): Day {
  if (!isDay(value) || value < "1900-01-01" || value > "2200-12-31") fail("invalid", { field, reason: "date" });
  return value;
}

export function notFuture(field: string, on: Day, today: Day) {
  if (on > today) fail("invalid", { field, reason: "future" });
}

export function email(field: string, value: string, required = false) {
  const v = value.trim().toLowerCase();
  if (!v) {
    if (required) fail("invalid", { field, reason: "required" });
    return "";
  }
  if (v.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail("invalid", { field, reason: "email" });
  return v;
}

export function phone(field: string, value: string) {
  const v = value.trim();
  if (v.length > 60 || !/^[0-9 +\-().ext]*$/.test(v)) fail("invalid", { field, reason: "phone" });
  return v;
}
