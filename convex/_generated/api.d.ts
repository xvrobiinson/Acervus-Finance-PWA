/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as businesses from "../businesses.js";
import type * as clients from "../clients.js";
import type * as crons from "../crons.js";
import type * as data from "../data.js";
import type * as desktop from "../desktop.js";
import type * as http from "../http.js";
import type * as imports from "../imports.js";
import type * as invites from "../invites.js";
import type * as lateFees from "../lateFees.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_books from "../lib/books.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_validate from "../lib/validate.js";
import type * as loans from "../loans.js";
import type * as money from "../money.js";
import type * as payments from "../payments.js";
import type * as rateLimit from "../rateLimit.js";
import type * as settings from "../settings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  businesses: typeof businesses;
  clients: typeof clients;
  crons: typeof crons;
  data: typeof data;
  desktop: typeof desktop;
  http: typeof http;
  imports: typeof imports;
  invites: typeof invites;
  lateFees: typeof lateFees;
  "lib/access": typeof lib_access;
  "lib/books": typeof lib_books;
  "lib/email": typeof lib_email;
  "lib/errors": typeof lib_errors;
  "lib/validate": typeof lib_validate;
  loans: typeof loans;
  money: typeof money;
  payments: typeof payments;
  rateLimit: typeof rateLimit;
  settings: typeof settings;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
