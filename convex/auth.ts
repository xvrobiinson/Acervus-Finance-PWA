// Better Auth on Convex (@convex-dev/better-auth), set up as the official
// React SPA guide describes: auth endpoints run as Convex HTTP actions on the
// deployment's .convex.site URL, and the crossDomain plugin lets the app on
// its own domain (Cloudflare) use them.
//
// Passwordless: people sign in with a one-time code sent to their email, and
// the first sign-in creates the account (each new user can create their own
// business). Proving the code proves the address. Google sign-in is available
// when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set.

import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import { codeEmail, sendEmail } from "./lib/email";

const siteUrl = process.env.SITE_URL!;

export const authComponent = createClient<DataModel>(components.betterAuth);

const SEND_CODE_PATH = "/email-otp/send-verification-otp";
const SIGN_IN_CODE_PATH = "/sign-in/email-otp";
const CODE_LIFETIME_MINUTES = 10;

/** Per-account limits on top of Better Auth's per-IP limits, so code
 *  guessing or email flooding against one address is slow even from many IPs. */
const ACCOUNT_LIMITS: Record<string, { max: number; windowMs: number }> = {
  [SEND_CODE_PATH]: { max: 10, windowMs: 60 * 60_000 },
  [SIGN_IN_CODE_PATH]: { max: 10, windowMs: 15 * 60_000 },
};

const IP_HEADERS = ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"];

/** A per-IP limit, applied only when the request says which IP it came
 *  from. Convex HTTP actions may not pass one on (checked on the local
 *  backend), and without it Better Auth would put everyone in ONE shared
 *  bucket per path — letting a stranger lock every user out. The per-account
 *  limits above apply either way. */
const perIp = (window: number, max: number) => (req: Request) =>
  IP_HEADERS.some((h) => req.headers.get(h)) ? { window, max } : false;

function googleProvider(): BetterAuthOptions["socialProviders"] {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { google: { clientId, clientSecret, prompt: "select_account" } } : {};
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  // Better Auth logs and swallows errors from sendVerificationOTP and still
  // answers "sent". This flag (one per request, as createAuth runs per
  // request) lets the after hook turn a failed send into a visible error.
  let codeNotSent = false;
  return betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    socialProviders: googleProvider(),
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        [SEND_CODE_PATH]: perIp(60 * 60, 20),
        [SIGN_IN_CODE_PATH]: perIp(60, 5),
        // Everything else (sessions, tokens): generous, per IP only.
        "/**": perIp(60, 300),
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: IP_HEADERS },
    },
    hooks: {
      before: createAuthMiddleware(async (mw) => {
        const limit = ACCOUNT_LIMITS[mw.path];
        const email = typeof mw.body?.email === "string" ? mw.body.email.trim().toLowerCase() : "";
        if (!limit || !email || !("runMutation" in ctx)) return;
        const allowed = await ctx.runMutation(internal.rateLimit.hit, {
          key: `auth:${mw.path}:${email}`,
          max: limit.max,
          windowMs: limit.windowMs,
        });
        if (!allowed) {
          throw new APIError("TOO_MANY_REQUESTS", { message: "Too many attempts. Wait a few minutes and try again." });
        }
      }),
      after: createAuthMiddleware(async (mw) => {
        if (mw.path === SEND_CODE_PATH && codeNotSent) {
          throw new APIError("SERVICE_UNAVAILABLE", {
            code: "EMAIL_NOT_SENT",
            message: "The code could not be emailed. Try again later.",
          });
        }
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: CODE_LIFETIME_MINUTES * 60,
        allowedAttempts: 3,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "sign-in") return;
          try {
            await sendEmail(codeEmail({ to: email, code: otp, minutes: CODE_LIFETIME_MINUTES }));
          } catch (e) {
            codeNotSent = true;
            throw e;
          }
        },
      }),
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
  } satisfies BetterAuthOptions);
};

/** The signed-in user (or null), for the app shell. */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    return { id: user._id as string, email: user.email, name: user.name || user.email, emailVerified: user.emailVerified };
  },
});
