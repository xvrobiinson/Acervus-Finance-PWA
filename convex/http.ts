import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Better Auth endpoints (/api/auth/*), with CORS for the app's origin.
authComponent.registerRoutes(http, createAuth, { cors: true });

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": process.env.SITE_URL ?? "",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
});

/** A client's ID photo, for admins of the client's business only. Served
 *  through this endpoint (never as a public storage URL) and never cached. */
http.route({
  path: "/client-photo",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const businessId = url.searchParams.get("businessId");
    const clientId = url.searchParams.get("clientId");
    const denied = () => new Response("Not found", { status: 404, headers: corsHeaders() });
    if (!businessId || !clientId || !(await ctx.auth.getUserIdentity())) return denied();
    let photoId: Id<"_storage"> | null = null;
    try {
      photoId = await ctx.runQuery(internal.clients.photoForAdmin, {
        businessId: businessId as Id<"businesses">,
        clientId: clientId as Id<"clients">,
      });
    } catch {
      return denied();
    }
    const blob = photoId ? await ctx.storage.get(photoId) : null;
    if (!blob) return denied();
    return new Response(blob, {
      headers: {
        ...corsHeaders(),
        "Content-Type": blob.type || "application/octet-stream",
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }),
});

http.route({
  path: "/client-photo",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
});

export default http;
