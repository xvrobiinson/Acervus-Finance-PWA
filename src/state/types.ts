import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

/** Everything the app shows for one business (convex/data.ts snapshot). */
export type Snapshot = NonNullable<FunctionReturnType<typeof api.data.snapshot>>;
export type BusinessSummary = FunctionReturnType<typeof api.businesses.mine>[number];
export type Role = "admin" | "collector" | "viewer";

export function can(role: Role | undefined, need: "read" | "record" | "manage"): boolean {
  if (!role) return false;
  if (need === "read") return true;
  if (need === "record") return role === "admin" || role === "collector";
  return role === "admin";
}
