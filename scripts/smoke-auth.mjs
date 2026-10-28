// End-to-end smoke test against a running *local* Convex deployment
// (`CONVEX_AGENT_MODE=anonymous npx convex dev` with SITE_URL set and no
// RESEND_API_KEY, so sign-in codes go to the log): code request, wrong code,
// sign-in with the code, the Convex token, and a lending workflow through the
// real functions.
//
// Usage: node scripts/smoke-auth.mjs <convex-dev-log-file>
// Never run it against a production deployment.

import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "node:fs";
import { api } from "../convex/_generated/api.js";

const SITE = "http://127.0.0.1:3211";
const CLOUD = "http://127.0.0.1:3210";
const ORIGIN = "http://localhost:5173";
const log = process.argv[2];
if (!SITE.includes("127.0.0.1")) throw new Error("local only");

const email = `smoke-${Date.now()}@example.com`;
let cookie = "";
async function auth(path, body, method = "POST") {
  const res = await fetch(`${SITE}/api/auth${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "Better-Auth-Cookie": cookie },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const set = res.headers.get("set-better-auth-cookie");
  if (set) cookie = set.split(/,(?=\s*[\w.-]+=)/).map((c) => c.split(";")[0].trim()).join("; ");
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, location: res.headers.get("location") };
}

const step = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) process.exitCode = 1;
};

const sent = await auth("/email-otp/send-verification-otp", { email, type: "sign-in" });
step("code requested", sent.status === 200, `HTTP ${sent.status}`);

await new Promise((r) => setTimeout(r, 1500));
const code = readFileSync(log, "utf8")
  .split(/\r?\n/)
  .reverse()
  .filter((l) => l.includes(email))
  .map((l) => l.match(/CODE: (\d{6})/)?.[1])
  .find(Boolean);
step("code written to the Convex log", !!code);

const wrongCode = code === "000000" ? "111111" : "000000";
const wrong = await auth("/sign-in/email-otp", { email, otp: wrongCode });
step("wrong code refused", wrong.status === 400 && wrong.json?.code === "INVALID_OTP", `HTTP ${wrong.status} ${wrong.json?.code ?? ""}`);

const signIn = await auth("/sign-in/email-otp", { email, otp: code, name: "Smoke Tester" });
step("sign in with the code creates the account", signIn.status === 200 && !!cookie && signIn.json?.user?.name === "Smoke Tester", `HTTP ${signIn.status}`);

const reused = await auth("/sign-in/email-otp", { email, otp: code });
step("a used code is refused", reused.status === 400, `HTTP ${reused.status} ${reused.json?.code ?? ""}`);

const tok = await auth("/convex/token", null, "GET");
const token = tok.json?.token;
step("Convex token issued", !!token);

const anon = new ConvexHttpClient(CLOUD);
let refused = false;
try {
  await anon.mutation(api.businesses.create, { name: "X", timezone: "America/Santo_Domingo", language: "es", currencyCode: "DOP" });
} catch {
  refused = true;
}
step("anonymous calls refused", refused);

const c = new ConvexHttpClient(CLOUD);
c.setAuth(token);
const me = await c.query(api.auth.getCurrentUser, {});
step("server knows the user", me?.email === email);
const businessId = await c.mutation(api.businesses.create, { name: "Smoke Préstamos", timezone: "America/Santo_Domingo", language: "es", currencyCode: "DOP" });
let snap = await c.query(api.data.snapshot, { businessId });
const today = snap.today;
const start = new Date(`${today}T00:00:00Z`);
start.setUTCMonth(start.getUTCMonth() - 1);
const startDay = start.toISOString().slice(0, 10);
await c.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 2_000_000, occurredOn: startDay, notes: "" });
const { clientId } = await c.mutation(api.clients.create, { businessId, opId: crypto.randomUUID(), fullName: "Cliente Prueba", phone: "", email: "", idNumber: "", address: "", notes: "" });
const loanId = await c.mutation(api.loans.create, {
  businessId, clientId, schedule: null, notes: "",
  terms: { principal: 1_000_000, rate: 100_000, interestPeriod: "monthly", frequency: "monthly", startDate: startDay, method: "declining", installments: 5, lateFeeRate: 50_000 },
});
snap = await c.query(api.data.snapshot, { businessId });
const loan = snap.loans.find((l) => l._id === loanId);
const opId = crypto.randomUUID();
const pay = { businessId, opId, loanId, loanVersion: loan.version, amount: 300_000, fee: 0, paidOn: today, notes: "", instruction: { kind: "auto" } };
const first = await c.mutation(api.payments.record, pay);
const again = await c.mutation(api.payments.record, pay);
snap = await c.query(api.data.snapshot, { businessId });
const a = snap.payments[0].applied;
step("payment split by the engine on the server", a.length === 1 && a[0].seq === 1 && a[0].principal === 200_000 && a[0].interest === 100_000 && a[0].fee === 0, JSON.stringify(a));
step("retried operation recorded once", again.duplicate && again.paymentId === first.paymentId && snap.payments.length === 1);

const out = await auth("/sign-out", {});
step("sign out", out.status === 200, `HTTP ${out.status}`);
const after = await auth("/convex/token", null, "GET");
step("no token after sign-out", !after.json?.token, `HTTP ${after.status}`);
