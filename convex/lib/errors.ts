// Errors the app shows to people. Each carries a code (translated on the
// device, in English or Spanish) and the figures the message needs. Anything
// else that goes wrong is a plain Error and shows as "Something went wrong".

import { ConvexError, type Value } from "convex/values";

export type ErrorData = { code: string } & Record<string, Value>;

export function fail(code: string, data: Record<string, Value> = {}): never {
  throw new ConvexError<ErrorData>({ code, ...data });
}

/** Codes that mean the operation can never succeed as sent (a queued
 *  offline operation with one of these needs a person to look at it). */
export const PERMANENT = new Set([
  "forbidden",
  "not_found",
  "invalid",
  "stale",
  "conflict",
  "insufficient_cash",
  "cash_shortfall",
  "payment",
  "plan",
  "loan_closed",
  "archived_client",
]);
