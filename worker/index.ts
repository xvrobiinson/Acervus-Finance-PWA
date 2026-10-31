// The only server code in front of the PWA: serves the Windows installer at
// /download/windows from this site's own address. Everything else is the
// built app (dist/), answered by Cloudflare's static assets as before.
//
// The installer lives in the desktop app's GitHub releases; every release
// also publishes it as AcervusFinance-Setup.exe, so "latest" always points
// at the newest one. It is streamed through, never stored here.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const INSTALLER = "https://github.com/xvrobiinson/ACERVUS-APP/releases/latest/download/AcervusFinance-Setup.exe";
const FILE_NAME = "AcervusFinance-Setup.exe";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/download/windows") return windowsInstaller(request);
    return env.ASSETS.fetch(request);
  },
};

async function windowsInstaller(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const upstream = await fetch(INSTALLER, { method: request.method, redirect: "follow" });
  if (!upstream.ok) {
    return new Response("The download is not available right now. Please try again in a few minutes.", {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${FILE_NAME}"`,
    // Always ask again, so a new release is picked up at once.
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: 200, headers });
}
