// Deleting a business: admins only, with its exact name, and every record and
// file of it goes; other businesses are untouched.

import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const TZ = "America/Santo_Domingo";
const ana = { subject: "user_ana", email: "ana@example.com", emailVerified: true, name: "Ana" };
const ben = { subject: "user_ben", email: "ben@example.com", emailVerified: true, name: "Ben" };

async function errorOf(p: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConvexError) return e.data as Record<string, unknown>;
    throw e;
  }
  throw new Error("expected the call to fail");
}

describe("businesses.remove", () => {
  it("deletes the business, its records and files, and nothing else", async () => {
    const t = convexTest(schema, modules);
    const asAna = t.withIdentity(ana);
    const doomed = await asAna.mutation(api.businesses.create, { name: "Prueba", timezone: TZ, language: "es", currencyCode: "DOP" });
    const kept = await asAna.mutation(api.businesses.create, { name: "Real", timezone: TZ, language: "es", currencyCode: "DOP" });
    for (const businessId of [doomed, kept]) {
      await asAna.mutation(api.clients.create, { businessId, opId: `op-client-${businessId}-abcdef`, fullName: "Luis", phone: "", email: "", idNumber: "", address: "", notes: "" });
    }
    const photo = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
    await t.run(async (ctx) => {
      const client = await ctx.db.query("clients").withIndex("by_business", (q) => q.eq("businessId", doomed)).first();
      await ctx.db.patch(client!._id, { photoId: photo });
    });

    expect(await errorOf(asAna.mutation(api.businesses.remove, { businessId: doomed, name: "prueba" }))).toMatchObject({ code: "invalid", reason: "confirm_name" });
    expect(await errorOf(t.withIdentity(ben).mutation(api.businesses.remove, { businessId: doomed, name: "Prueba" }))).toMatchObject({ code: "forbidden" });

    await asAna.mutation(api.businesses.remove, { businessId: doomed, name: " Prueba " });
    expect((await asAna.query(api.businesses.mine, {})).map((b) => b.name)).toEqual(["Real"]);
    await t.finishAllScheduledFunctions(() => {});

    const left = await t.run(async (ctx) => ({
      members: await ctx.db.query("members").withIndex("by_business", (q) => q.eq("businessId", doomed)).collect(),
      clients: await ctx.db.query("clients").withIndex("by_business", (q) => q.eq("businessId", doomed)).collect(),
      settings: await ctx.db.query("settings").withIndex("by_business", (q) => q.eq("businessId", doomed)).collect(),
      log: await ctx.db.query("changeLog").withIndex("by_business", (q) => q.eq("businessId", doomed)).collect(),
      photo: await ctx.storage.getUrl(photo),
      keptClients: await ctx.db.query("clients").withIndex("by_business", (q) => q.eq("businessId", kept)).collect(),
    }));
    expect([left.members, left.clients, left.settings, left.log]).toEqual([[], [], [], []]);
    expect(left.photo).toBeNull();
    expect(left.keptClients).toHaveLength(1);
    expect(await errorOf(asAna.query(api.data.snapshot, { businessId: doomed }))).toMatchObject({ code: "forbidden" });
  });
});

describe("invites.pending", () => {
  it("lets an invited person join from the app, without the emailed link", async () => {
    process.env.SITE_URL = "https://app.example.com";
    const t = convexTest(schema, modules);
    const asAna = t.withIdentity(ana);
    const asBen = t.withIdentity(ben);
    const businessId = await asAna.mutation(api.businesses.create, { name: "Real", timezone: TZ, language: "es", currencyCode: "DOP" });
    await asAna.action(api.invites.create, { businessId, email: " BEN@example.com ", role: "collector" });

    // Signed in some other way (Google, another browser): the invitation is still there.
    const [invite, ...more] = await asBen.query(api.invites.pending, {});
    expect(more).toEqual([]);
    expect(invite).toMatchObject({ businessName: "Real", role: "collector" });
    expect(await asAna.query(api.invites.pending, {})).toEqual([]);
    expect(await errorOf(asAna.mutation(api.invites.acceptPending, { inviteId: invite.inviteId }))).toMatchObject({ code: "invite_invalid" });

    expect(await asBen.mutation(api.invites.acceptPending, { inviteId: invite.inviteId })).toBe(businessId);
    expect(await asBen.query(api.businesses.mine, {})).toMatchObject([{ name: "Real", role: "collector" }]);
    expect(await asBen.query(api.invites.pending, {})).toEqual([]);
    expect(await errorOf(asBen.mutation(api.invites.acceptPending, { inviteId: invite.inviteId }))).toMatchObject({ code: "invite_invalid" });
  });
});
