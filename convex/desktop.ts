// The desktop app (Windows, Rust) syncs with the same functions the PWA uses
// (docs/DESKTOP-SYNC-PLAN.md). Before it reads or sends anything it asks
// here whether its build may still sync, so an outdated desktop is told to
// update instead of writing with old rules.

import { v } from "convex/values";
import { query } from "./_generated/server";

/** The oldest desktop build that may sync. Raise it whenever a change to the
 *  schema or to a function's arguments would let an older build misread the
 *  data or send writes the server would apply differently. */
export const MIN_DESKTOP_VERSION = "0.7.0";

/** "1.2.3" → [1, 2, 3]; null when it isn't a plain version number. */
function parseVersion(s: string): number[] | null {
  const m = s.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).map(Number) : null;
}

/** Whether version `a` is at least `b`. Malformed versions never are. */
export function versionAtLeast(a: string, b: string): boolean {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
}

/** No sign-in needed: the desktop asks before signing in, too. */
export const compat = query({
  args: { clientVersion: v.string() },
  handler: async (_ctx, a) => ({
    ok: versionAtLeast(a.clientVersion, MIN_DESKTOP_VERSION),
    minVersion: MIN_DESKTOP_VERSION,
  }),
});
