// Receipt parts switched on or off in Settings are kept with the business,
// and a save from an older app that doesn't know about them keeps them.

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ana = { subject: "user_ana", email: "ana@example.com", emailVerified: true, name: "Ana" };

const parts = { loanNumber: true, amountLent: false, rate: true, cycle: true, installments: true, split: false, lateFees: true, balance: true, history: false };

describe("settings.update receipt parts", () => {
  it("stores the switches, and an older app's save keeps them", async () => {
    const t = convexTest(schema, modules);
    const asAna = t.withIdentity(ana);
    const businessId = await asAna.mutation(api.businesses.create, { name: "Prueba", timezone: "America/Santo_Domingo", language: "es", currencyCode: "DOP" });
    const read = () => t.run((ctx) => ctx.db.query("settings").withIndex("by_business", (q) => q.eq("businessId", businessId)).unique());
    const s = (await read())!;
    // New businesses have no switches stored: every part prints.
    expect(s.receiptShow).toBeUndefined();

    const base = {
      businessId,
      receiptName: s.receiptName,
      companyAddress: s.companyAddress,
      companyPhone: s.companyPhone,
      receiptCompany: s.receiptCompany,
      receiptClient: s.receiptClient,
      receiptText: s.receiptText,
      currencyCode: s.currencyCode,
      numberStyle: s.numberStyle,
      dateStyle: s.dateStyle,
      language: s.language,
      defaultRate: s.defaultRate,
      defaultFrequency: s.defaultFrequency,
      lateFeeRate: s.lateFeeRate,
      receiptAfterPayment: s.receiptAfterPayment,
      receiptAfterLoan: s.receiptAfterLoan,
    };
    await asAna.mutation(api.settings.update, { ...base, expectedVersion: s.version, receiptShow: parts });
    const saved = (await read())!;
    expect(saved.receiptShow).toEqual(parts);

    // An app from before the switches sends none: they stay as they were.
    await asAna.mutation(api.settings.update, { ...base, expectedVersion: saved.version, receiptName: "Otro nombre" });
    const after = (await read())!;
    expect(after.receiptName).toBe("Otro nombre");
    expect(after.receiptShow).toEqual(parts);
  });
});
