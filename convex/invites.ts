// Invitations: an admin invites an email address with a role; the person
// signs up (or in) with that same, verified address and accepts. The link
// carries a random 256-bit token; only its SHA-256 is stored, it works once
// and expires after 7 days.
//
// Tokens are made in an action, where crypto.getRandomValues is a real
// cryptographic source (queries and mutations run with seeded randomness).

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { requireIdentity, requireMember } from "./lib/access";
import { Diff, logChange } from "./lib/books";
import { actionEmail, emailConfigured, sendEmail } from "./lib/email";
import { fail } from "./lib/errors";
import { email as checkEmail } from "./lib/validate";
import { hitLimit } from "./rateLimit";
import { role } from "./schema";

const WEEK = 7 * 24 * 60 * 60_000;

async function sha256(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const store = internalMutation({
  args: { businessId: v.id("businesses"), email: v.string(), role, tokenHash: v.string() },
  handler: async (ctx, a): Promise<{ businessName: string }> => {
    const access = await requireMember(ctx, a.businessId, "manage");
    if (!(await hitLimit(ctx, `invite:${a.businessId}`, 30, 24 * 60 * 60_000))) fail("rate_limited");
    const email = checkEmail("email", a.email, true);
    const existing = await ctx.db
      .query("members")
      .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
      .collect();
    if (existing.some((m) => m.active && m.email === email)) fail("already_member");
    // One open invitation per address: a new one replaces the old.
    const open = await ctx.db
      .query("invites")
      .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
      .collect();
    const now = Date.now();
    for (const i of open.filter((i) => i.email === email && !i.acceptedAt && !i.revokedAt)) {
      await ctx.db.patch(i._id, { revokedAt: now });
    }
    const id = await ctx.db.insert("invites", {
      businessId: a.businessId,
      email,
      role: a.role,
      tokenHash: a.tokenHash,
      createdBy: access.userId,
      createdAt: now,
      expiresAt: now + WEEK,
    });
    await logChange(ctx, access, "member", id, "create", new Diff().added("invited", email).added("role", a.role), "Invitation");
    return { businessName: access.business.name };
  },
});

/** Creates an invitation and emails it when email is set up. Returns the
 *  link either way, so the admin can also share it another way. */
export const create = action({
  args: { businessId: v.id("businesses"), email: v.string(), role },
  handler: async (ctx, a): Promise<{ url: string; emailed: boolean }> => {
    const token = newToken();
    const { businessName } = await ctx.runMutation(internal.invites.store, {
      businessId: a.businessId,
      email: a.email,
      role: a.role,
      tokenHash: await sha256(token),
    });
    // In the fragment, so the token never reaches a server log.
    const url = `${process.env.SITE_URL}/invite#token=${token}`;
    if (!emailConfigured()) return { url, emailed: false };
    await sendEmail(
      actionEmail({
        to: a.email.trim().toLowerCase(),
        subject: `${businessName}: Acervus Finance`,
        en: `You were invited to ${businessName} on Acervus Finance. Sign up or sign in with this email address, then accept. The link works for 7 days.`,
        es: `Te invitaron a ${businessName} en Acervus Finance. Regístrate o inicia sesión con este correo y acepta. El enlace sirve por 7 días.`,
        button: "Open invitation / Abrir invitación",
        url,
      }),
    );
    return { url, emailed: true };
  },
});

export const list = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    await requireMember(ctx, a.businessId, "manage");
    const now = Date.now();
    const rows = await ctx.db
      .query("invites")
      .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
      .collect();
    return rows
      .filter((i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > now)
      .map((i) => ({ _id: i._id, email: i.email, role: i.role, expiresAt: i.expiresAt }));
  },
});

export const revoke = mutation({
  args: { businessId: v.id("businesses"), inviteId: v.id("invites") },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const i = await ctx.db.get(a.inviteId);
    if (!i || i.businessId !== a.businessId) fail("not_found", { table: "invites" });
    if (i.acceptedAt || i.revokedAt) return;
    await ctx.db.patch(i._id, { revokedAt: Date.now() });
    await logChange(ctx, access, "member", i._id, "delete", new Diff().removed("invited", i.email), "Invitation revoked");
  },
});


/** What an invitation is for, shown before accepting. */
export const preview = query({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(a.token)) return null;
    const tokenHash = await sha256(a.token);
    const i = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!i || i.acceptedAt || i.revokedAt || i.expiresAt < Date.now()) return null;
    const b = await ctx.db.get(i.businessId);
    return b ? { businessName: b.name, role: i.role, email: i.email } : null;
  },
});

export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, a): Promise<Id<"businesses">> => {
    const who = await requireIdentity(ctx);
    if (!(await hitLimit(ctx, `invite:accept:${who.userId}`, 20, 60 * 60_000))) fail("rate_limited");
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(a.token)) fail("invite_invalid");
    const tokenHash = await sha256(a.token);
    const i = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!i || i.acceptedAt || i.revokedAt || i.expiresAt < Date.now()) fail("invite_invalid");
    if (i.email !== who.email) fail("invite_other_email", { email: i.email });
    const now = Date.now();
    const existing = await ctx.db
      .query("members")
      .withIndex("by_business_user", (q) => q.eq("businessId", i.businessId).eq("userId", who.userId))
      .unique();
    let memberId: Id<"members">;
    if (existing) {
      if (existing.active) fail("already_member");
      await ctx.db.patch(existing._id, { active: true, role: i.role, removedAt: undefined, joinedAt: now, email: who.email });
      memberId = existing._id;
    } else {
      memberId = await ctx.db.insert("members", {
        businessId: i.businessId,
        userId: who.userId,
        email: who.email,
        name: who.name,
        role: i.role,
        active: true,
        joinedAt: now,
      });
    }
    await ctx.db.patch(i._id, { acceptedAt: now, acceptedBy: who.userId });
    const business = (await ctx.db.get(i.businessId))!;
    const member = (await ctx.db.get(memberId))!;
    await logChange(
      ctx,
      { ...who, business, member, today: "" },
      "member",
      memberId,
      "create",
      new Diff().added("email", who.email).added("role", i.role),
      "Accepted an invitation",
    );
    return i.businessId;
  },
});
