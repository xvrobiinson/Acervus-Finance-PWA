import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { MIN_DESKTOP_VERSION, versionAtLeast } from "./desktop";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("versionAtLeast", () => {
  it("compares each part as a number", () => {
    expect(versionAtLeast("0.7.0", "0.7.0")).toBe(true);
    expect(versionAtLeast("0.10.0", "0.7.0")).toBe(true);
    expect(versionAtLeast("1.0.0", "0.9.9")).toBe(true);
    expect(versionAtLeast("0.6.9", "0.7.0")).toBe(false);
  });
  it("refuses malformed versions", () => {
    expect(versionAtLeast("", "0.7.0")).toBe(false);
    expect(versionAtLeast("0.7", "0.7.0")).toBe(false);
    expect(versionAtLeast("0.7.0-beta", "0.7.0")).toBe(false);
  });
});

describe("desktop.compat", () => {
  it("lets current builds sync and tells old ones to update, without sign-in", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.desktop.compat, { clientVersion: MIN_DESKTOP_VERSION })).toEqual({
      ok: true,
      minVersion: MIN_DESKTOP_VERSION,
    });
    expect((await t.query(api.desktop.compat, { clientVersion: "0.6.0" })).ok).toBe(false);
  });
});
