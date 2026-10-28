// Better Auth client, as in the Convex + Better Auth React SPA guide: auth
// requests go to the Convex deployment's .convex.site URL; crossDomainClient
// keeps the session for this origin and convexClient fetches the short-lived
// Convex token from it.

import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { CONVEX_SITE_URL } from "./env";

export const authClient = createAuthClient({
  baseURL: CONVEX_SITE_URL,
  plugins: [convexClient(), crossDomainClient()],
});

const SESSION_CACHE = "better-auth_session_data";

/** The last signed-in user, as kept by the auth client in this browser —
 *  used only to recognise the user when the app starts offline. */
export function cachedSessionUser(): { id: string; email: string; name: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE);
    if (!raw) return null;
    const data = JSON.parse(raw) as { user?: { id?: string; email?: string; name?: string }; session?: { expiresAt?: string } };
    const u = data?.user;
    if (!u?.id || !u.email) return null;
    if (data.session?.expiresAt && Date.parse(data.session.expiresAt) < Date.now()) return null;
    return { id: u.id, email: u.email, name: u.name ?? u.email };
  } catch {
    return null;
  }
}
