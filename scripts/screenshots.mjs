// Seeds a demo business with SYNTHETIC data on a *local* Convex deployment and
// captures phone-size screenshots of the app with a headless Edge (its own
// throw-away profile; nothing is shown on screen and no input reaches other
// programs). Requires the local backend (`npx convex dev`, anonymous) with no
// RESEND_API_KEY, so sign-in codes go to the log, and the Vite dev server on :5173.
//
// Usage: node scripts/screenshots.mjs <convex-dev-log> <out-dir> [edge.exe]

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const [log, outDir, edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"] = process.argv.slice(2);
const SITE = "http://127.0.0.1:3211";
const APP = "http://localhost:5173";
mkdirSync(outDir, { recursive: true });

// ----- account and session -------------------------------------------------
const email = `demo-${Date.now()}@example.com`;
let stored = {};
async function auth(path, body, method = "POST") {
  const cookie = Object.entries(stored).map(([k, v]) => `${k}=${v.value}`).join("; ");
  const res = await fetch(`${SITE}/api/auth${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: APP, "Better-Auth-Cookie": cookie },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const set = res.headers.get("set-better-auth-cookie");
  if (set) {
    for (const part of set.split(/,(?=\s*[\w.-]+=)/)) {
      const [pair, ...attrs] = part.split(";").map((s) => s.trim());
      const [name, ...rest] = pair.split("=");
      const maxAge = attrs.find((a) => a.toLowerCase().startsWith("max-age="));
      stored[name] = { value: rest.join("="), expires: maxAge ? new Date(Date.now() + Number(maxAge.split("=")[1]) * 1000).toISOString() : null };
    }
  }
  return res.json().catch(() => null);
}
await auth("/email-otp/send-verification-otp", { email, type: "sign-in" });
await new Promise((r) => setTimeout(r, 1200));
const code = readFileSync(log, "utf8")
  .split(/\r?\n/)
  .reverse()
  .filter((l) => l.includes(email))
  .map((l) => l.match(/CODE: (\d{6})/)?.[1])
  .find(Boolean);
await auth("/sign-in/email-otp", { email, otp: code, name: "Rosa Demo" });
const { token } = await auth("/convex/token", null, "GET");
const session = await auth("/get-session", null, "GET");

// ----- synthetic demo data -------------------------------------------------
const c = new ConvexHttpClient("http://127.0.0.1:3210");
c.setAuth(token);
const businessId = await c.mutation(api.businesses.create, { name: "Préstamos Demo", timezone: "America/Santo_Domingo", language: "es", currencyCode: "DOP" });
const today = (await c.query(api.data.snapshot, { businessId })).today;
const day = (months, days = 0) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
await c.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 50_000_000, occurredOn: day(-5), notes: "Capital inicial" });
const people = ["María Pérez", "José Rodríguez", "Ana Martínez", "Luis Gómez"];
const ids = [];
for (const fullName of people) {
  ids.push((await c.mutation(api.clients.create, { businessId, opId: crypto.randomUUID(), fullName, phone: "809-555-0100", email: "", idNumber: "001-0000000-1", address: "Santo Domingo", notes: "" })).clientId);
}
const terms = (o) => ({ principal: 1_000_000, rate: 100_000, interestPeriod: "monthly", frequency: "monthly", method: "declining", installments: 5, lateFeeRate: 50_000, ...o });
const loans = [
  await c.mutation(api.loans.create, { businessId, clientId: ids[0], schedule: null, notes: "", terms: terms({ startDate: day(-4, -2) }) }),
  await c.mutation(api.loans.create, { businessId, clientId: ids[1], schedule: null, notes: "", terms: terms({ principal: 2_500_000, method: "flat", installments: 10, startDate: day(-2) }) }),
  await c.mutation(api.loans.create, { businessId, clientId: ids[2], schedule: null, notes: "", terms: terms({ principal: 5_000_000, method: "interest_only", installments: null, lateFeeRate: 0, startDate: day(-3) }) }),
  await c.mutation(api.loans.create, { businessId, clientId: ids[3], schedule: null, notes: "", terms: terms({ principal: 800_000, frequency: "weekly", installments: 12, startDate: day(0, -20) }) }),
];
const pay = async (i, amount, paidOn, instruction = { kind: "auto" }) => {
  const s = await c.query(api.data.snapshot, { businessId });
  const loan = s.loans.find((l) => l._id === loans[i]);
  await c.mutation(api.payments.record, { businessId, opId: crypto.randomUUID(), loanId: loan._id, loanVersion: loan.version, amount, fee: 0, paidOn, notes: "", instruction });
};
await pay(0, 300_000, day(-3, -2));
await pay(0, 280_000, day(-2, -2));
await pay(0, 100_000, day(-1, 3), { kind: "installment", seq: 3 });
await pay(1, 350_000, day(-1));
await pay(2, 500_000, day(-2));
await pay(2, 1_500_000, day(-1));
await pay(3, 85_000, day(0, -13));
await c.mutation(api.money.addEntry, { businessId, opId: crypto.randomUUID(), kind: "expense", account: "interest", amount: 150_000, occurredOn: day(0, -5), description: "Transporte y papelería" });
await c.mutation(api.money.addEntry, { businessId, opId: crypto.randomUUID(), kind: "income", account: "interest", amount: 60_000, occurredOn: day(0, -3), description: "Comisión" });
console.log(`seeded business ${businessId} for ${email}`);

// ----- headless Edge over the DevTools protocol ----------------------------
const port = 9333;
const profile = join(outDir, "edge-profile");
const browser = spawn(edge, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-extensions", "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {
    /* not up yet */
  }
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const waiting = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) {
    waiting.get(m.id)(m.result ?? m);
    waiting.delete(m.id);
  }
});
const cdp = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = (expression) => cdp("Runtime.evaluate", { expression, awaitPromise: true });
async function shot(name, path, before) {
  if (path) {
    await cdp("Page.navigate", { url: `${APP}${path}` });
    await wait(3500);
  }
  if (before) {
    await evalJs(before);
    await wait(900);
  }
  const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
  console.log(`saved ${name}.png`);
}

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await shot("01-sign-in", "/sign-in");
await evalJs(
  `localStorage.setItem("better-auth_cookie", ${JSON.stringify(JSON.stringify(stored))});
   localStorage.setItem("better-auth_session_data", ${JSON.stringify(JSON.stringify(session))});
   localStorage.setItem("acervus.lang", "es");`,
);
await shot("02-overview", "/");
await shot("03-loans", "/loans");
const loanPath = `/loans/${loans[0]}`;
await shot("04-loan-detail", loanPath);
await shot("05-record-payment", loanPath, `[...document.querySelectorAll("button")].find(b => /Registrar pago/.test(b.textContent)).click()`);
await shot("06-clients", "/clients");
await shot("07-money", "/money");
await shot("08-new-loan", "/loans", `[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Préstamo").click()`);
await shot("09-receipt", `/loans/${loans[1]}`, `document.querySelector('[aria-label="Recibo"]').click()`);
await shot("10-reports", "/reports");
// Offline: the copy kept on the device, and a payment queued for later.
await cdp("Network.enable");
await cdp("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await evalJs(`window.dispatchEvent(new Event("offline"))`);
await wait(2500);
await shot("11-offline-overview", null, `document.querySelector('a[href="/"]')?.click()`);
await shot(
  "12-offline-payment-form",
  null,
  `document.querySelector(".fab").click(); setTimeout(() => [...document.querySelectorAll(".sheet button")].find(b => /Registrar pago/.test(b.textContent)).click(), 300);`,
);
// Record a payment while offline, as a person would in the form.
const setValue = (selector, value, proto = "HTMLInputElement", event = "input") => `
  (() => { const el = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(${proto}.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`;
await evalJs(setValue(".sheet select", loans[0], "HTMLSelectElement", "change"));
await wait(300);
await evalJs(setValue(".sheet input.money", "1500"));
await wait(300);
await shot("13-offline-payment-filled", null);
await shot("14-offline-saved", null, `[...document.querySelectorAll(".sheet button")].find(b => /Guardar pago/.test(b.textContent)).click()`);
await shot("15-sync-center-offline", null, `document.querySelector('a[href="/sync"]').click()`);

// Back online: the outbox sends it on its own.
await cdp("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await evalJs(`window.dispatchEvent(new Event("online"))`);
await wait(8000);
await shot("16-sync-center-online", null);
const after = await c.query(api.data.snapshot, { businessId });
const synced = after.payments.filter((p) => p.loanId === loans[0] && p.amount === 150_000);
console.log(
  synced.length === 1 && synced[0].recordedOffline
    ? "PASS  payment recorded offline reached the server once, marked as recorded offline"
    : `FAIL  offline payment on server: ${JSON.stringify(synced.map((p) => ({ amount: p.amount, offline: p.recordedOffline })))}`,
);
ws.close();
browser.kill();
