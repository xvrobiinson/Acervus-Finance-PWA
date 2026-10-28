// Public build-time settings (Vite). Never secrets: everything here ends up
// in the JavaScript every visitor downloads.

export const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string;

/** The deployment's HTTP actions URL (auth, photos). `npx convex deploy`
 *  only injects VITE_CONVEX_URL, so derive it when not set:
 *  https://x.convex.cloud → https://x.convex.site. */
export const CONVEX_SITE_URL: string =
  (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) || CONVEX_URL.replace(/\.convex\.cloud\/?$/, ".convex.site");
