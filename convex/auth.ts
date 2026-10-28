// Better Auth on Convex (@convex-dev/better-auth), set up as the official
// React SPA guide describes: auth endpoints run as Convex HTTP actions on the
// deployment's .convex.site URL, and the crossDomain plugin lets the app on
// its own domain (Cloudflare) use them.
//
// Sign-up is open (each new user can create their own business), so email
// addresses must be verified before the account can sign in. Google sign-in
// is available when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set.

import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import { actionEmail, sendEmail } from "./lib/email";

const siteUrl = process.env.SITE_URL!;

export const authComponent = createClient<DataModel>(components.betterAuth);

/** Per-account limits on top of Better Auth's per-IP limits, so password
 *  guessing against one address is slow even from many IPs. */
const ACCOUNT_LIMITS: Record<string, { max: number; windowMs: number }> = {
  "/sign-in/email": { max: 10, windowMs: 15 * 60_000 },
  "/sign-up/email": { max: 3, windowMs: 60 * 60_000 },
  "/request-password-reset": { max: 3, windowMs: 60 * 60_000 },
  "/send-verification-email": { max: 3, windowMs: 60 * 60_000 },
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
  return betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(
          actionEmail({
            to: user.email,
            subject: "Reset your password / Restablece tu contraseña",
            en: "Someone asked to reset the password of your Acervus Finance account. If it was you, use the button below within one hour. If not, ignore this email.",
            es: "Alguien pidió restablecer la contraseña de tu cuenta de Acervus Finance. Si fuiste tú, usa el botón dentro de una hora. Si no, ignora este correo.",
            button: "Reset password / Restablecer",
            url,
          }),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      // Verifying happens on the .convex.site domain, where a session cookie
      // would be useless to the app; people sign in after verifying.
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(
          actionEmail({
            to: user.email,
            subject: "Confirm your email / Confirma tu correo",
            en: "Confirm your email address to finish creating your Acervus Finance account.",
            es: "Confirma tu correo para terminar de crear tu cuenta de Acervus Finance.",
            button: "Confirm email / Confirmar",
            url,
          }),
        );
      },
    },
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
        "/sign-in/email": perIp(60, 5),
        "/sign-up/email": perIp(60 * 60, 5),
        "/request-password-reset": perIp(60 * 60, 5),
        "/send-verification-email": perIp(60 * 60, 5),
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
    },
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  } satisfies BetterAuthOptions);
};

/** The signed-in user (or null), for the app shell. */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    return { id: user._id as string, email: user.email, name: user.name, emailVerified: user.emailVerified };
  },
});
