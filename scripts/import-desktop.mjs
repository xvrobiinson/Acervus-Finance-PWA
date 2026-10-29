// Imports a desktop app database into a new business (docs/DESKTOP-SYNC-PLAN.md,
// phase 2). Every figure is checked on the server before anything is kept
// (convex/imports.ts).
//
// 1. In the desktop repo, on the day of the import:
//      cargo run --example export_for_cloud -- <backup.db> <export-dir>
// 2. Here:
//      node scripts/import-desktop.mjs <export-dir> --url https://<deployment>.convex.cloud
//    It asks for your email and the 6-digit code it sends, imports the book
//    into a new business you own, then uploads the ID photos and the logo.
//
// Options:
//   --timezone <IANA zone>   the business time zone (default America/Santo_Domingo)
//   --origin <url>           the app's address, as the deployment's SITE_URL
//                            (default https://acervus-finance-pwa.vz-labs.workers.dev)
//   --json <file>            write what would be sent, and import nothing
//   --email <address>        skip the email question
//   --code-from-log <file>   local backends only: read the code from a
//                            `convex dev` log instead of asking for it

import { ConvexHttpClient } from "convex/browser";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createInterface } from "node:readline/promises";
import { api } from "../convex/_generated/api.js";

const ms = (s) => (s ? Date.parse(s) : undefined);
const bool = (s) => s === "1" || s === "true";

/** The desktop export as the import mutation's arguments, plus the files
 *  uploaded after it. Read-only. */
export function readExport(dir, timezone) {
  const db = new DatabaseSync(join(dir, "book.db"), { readOnly: true });
  const all = (sql) => db.prepare(sql).all();
  const settings = Object.fromEntries(all("SELECT key, value FROM app_settings").map((r) => [r.key, r.value]));
  const name = (settings.business_name ?? "").trim() || "Mi negocio";
  const receiptText = Object.fromEntries(
    Object.entries(settings).filter(
      ([k, v]) => /^receipt_(rules_|client_sign$|lender_sign$|payment_footer$|loan_footer$)/.test(k) && v.trim() !== "",
    ),
  );

  const byLoan = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(r.loan_id ?? r.payment_id, [...(m.get(r.loan_id ?? r.payment_id) ?? []), r]);
    return m;
  };
  const schedules = byLoan(all("SELECT * FROM loan_installments ORDER BY loan_id, seq"));
  const targets = byLoan(all("SELECT * FROM payment_targets ORDER BY payment_id, seq"));
  const applied = byLoan(all("SELECT * FROM installment_allocations ORDER BY payment_id, seq"));

  const payments = all(
    `SELECT p.*, a.principal, a.interest, a.fee FROM payments p
     JOIN payment_allocations a ON a.payment_id = p.id ORDER BY p.id`,
  );
  const reversed = payments.filter((p) => p.reversed_at !== null).length;

  const book = {
    business: { name, timezone, language: settings.language === "en" ? "en" : "es", currencyCode: settings.currency ?? "DOP" },
    settings: {
      receiptName: name,
      companyAddress: settings.company_address ?? "",
      companyPhone: settings.company_phone ?? "",
      receiptCompany: {
        name: bool(settings.receipt_company_name ?? "1"),
        address: bool(settings.receipt_company_address ?? "1"),
        phone: bool(settings.receipt_company_phone ?? "1"),
      },
      receiptClient: {
        name: bool(settings.receipt_client_name ?? "1"),
        idNumber: bool(settings.receipt_client_id_number ?? "1"),
        phone: bool(settings.receipt_client_phone ?? "1"),
        address: bool(settings.receipt_client_address ?? "1"),
      },
      receiptText,
      numberStyle: settings.number_style ?? "comma_dot",
      dateStyle: settings.date_style ?? "medium",
      defaultRate: Number(settings.default_rate ?? 100000),
      defaultFrequency: settings.default_frequency ?? "monthly",
      lateFeeRate: Number(settings.late_fee_rate ?? 50000),
      receiptAfterPayment: bool(settings.receipt_after_payment ?? "1"),
      receiptAfterLoan: bool(settings.receipt_after_loan ?? "1"),
    },
    clients: all("SELECT * FROM clients ORDER BY id").map((c) => ({
      no: c.id,
      fullName: c.full_name,
      phone: c.phone ?? "",
      email: c.email ?? "",
      idNumber: c.id_number ?? "",
      address: c.address ?? "",
      notes: c.notes,
      createdAt: ms(c.created_at),
      ...(c.archived_at ? { archivedAt: ms(c.archived_at) } : {}),
    })),
    loans: all("SELECT * FROM loans ORDER BY id").map((l) => ({
      no: l.id,
      clientNo: l.client_id,
      principal: l.principal,
      rate: l.period_rate,
      interestPeriod: l.interest_period,
      frequency: l.frequency,
      method: l.method,
      installments: l.installments,
      scheduleEdited: l.schedule_edited === 1,
      schedule: (schedules.get(l.id) ?? []).map((x) => ({ seq: x.seq, due: x.due_date, principal: x.principal, interest: x.interest })),
      lateFeeRate: l.late_fee_rate,
      startDate: l.start_date,
      status: l.status,
      statusDate: l.status_date,
      notes: l.notes,
      createdAt: ms(l.created_at),
    })),
    statusEvents: all("SELECT * FROM loan_status_events ORDER BY id").map((e) => ({
      loanNo: e.loan_id,
      status: e.status,
      occurredOn: e.occurred_on,
      note: e.note,
      createdAt: ms(e.created_at),
    })),
    // Reversed payments (an early desktop feature) no longer count anywhere.
    payments: payments
      .filter((p) => p.reversed_at === null)
      .map((p) => ({
        no: p.id,
        loanNo: p.loan_id,
        paidOn: p.paid_on,
        amount: p.amount,
        notes: p.notes,
        mode: p.allocation_mode,
        ...(p.target_seq !== null ? { targetSeq: p.target_seq } : {}),
        ...(targets.has(p.id) ? { targets: targets.get(p.id).map((t) => ({ seq: t.seq, amount: t.amount })) } : {}),
        principal: p.principal,
        interest: p.interest,
        fee: p.fee,
        applied: (applied.get(p.id) ?? []).map((a) => ({ seq: a.seq, principal: a.principal, interest: a.interest, fee: a.late_fee })),
        createdAt: ms(p.created_at),
      })),
    lateFees: all("SELECT * FROM late_fees ORDER BY loan_id, seq").map((f) => ({
      loanNo: f.loan_id,
      seq: f.seq,
      assessedOn: f.assessed_on,
      baseAmount: f.base_amount,
      rate: f.rate,
      amount: f.amount,
      ...(f.waived_at ? { waivedAt: ms(f.waived_at) } : {}),
      waiveReason: f.waive_reason,
      createdAt: ms(f.created_at),
      updatedAt: ms(f.updated_at),
    })),
    capital: all("SELECT * FROM capital_transactions ORDER BY id").map((c) => ({
      no: c.id,
      kind: c.kind,
      amount: c.amount,
      occurredOn: c.occurred_on,
      notes: c.notes,
      createdAt: ms(c.created_at),
    })),
    entries: all("SELECT * FROM cash_entries ORDER BY id").map((e) => ({
      no: e.id,
      kind: e.kind,
      account: e.account,
      amount: e.amount,
      occurredOn: e.occurred_on,
      description: e.description,
      createdAt: ms(e.created_at),
    })),
    changes: all("SELECT * FROM change_log ORDER BY id").map((c) => ({
      entity: c.entity,
      entityNo: c.entity_id,
      ...(c.loan_id !== null ? { loanNo: c.loan_id } : {}),
      action: c.action,
      changes: c.changes
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [field, old = "", now = ""] = line.split("\t");
          return { field, old, new: now };
        }),
      reason: c.reason,
      createdAt: ms(c.created_at),
    })),
  };
  const photos = all("SELECT client_id, mime, data FROM client_photos").map((p) => ({ clientNo: p.client_id, mime: p.mime, data: p.data }));
  const logo = db.prepare("SELECT mime, data FROM app_assets WHERE key = 'logo'").get() ?? null;
  db.close();
  const expected = JSON.parse(readFileSync(join(dir, "figures.json"), "utf8"));
  return { book, expected, photos, logo, reversed };
}

function option(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function signIn(cloudUrl, origin, args) {
  const site = cloudUrl.replace(/\.convex\.cloud\/?$/, ".convex.site").replace(":3210", ":3211");
  let cookie = "";
  const auth = async (path, body, method = "POST") => {
    const res = await fetch(`${site}/api/auth${path}`, {
      method,
      headers: { "Content-Type": "application/json", Origin: origin, "Better-Auth-Cookie": cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-better-auth-cookie");
    if (set) cookie = set.split(/,(?=\s*[\w.-]+=)/).map((c) => c.split(";")[0].trim()).join("; ");
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${json?.code ?? ""} ${json?.message ?? ""}`.trim());
    return json;
  };
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = (option(args, "--email") ?? (await rl.question("Your email: "))).trim();
  await auth("/email-otp/send-verification-otp", { email, type: "sign-in" });
  let code;
  const log = option(args, "--code-from-log");
  if (log) {
    if (!/127\.0\.0\.1|localhost/.test(site)) throw new Error("--code-from-log is for local backends only");
    await new Promise((r) => setTimeout(r, 1500));
    code = readFileSync(log, "utf8")
      .split(/\r?\n/)
      .reverse()
      .filter((l) => l.includes(email))
      .map((l) => l.match(/CODE: (\d{6})/)?.[1])
      .find(Boolean);
  } else {
    code = (await rl.question("The 6-digit code we emailed you: ")).trim();
  }
  rl.close();
  await auth("/sign-in/email-otp", { email, otp: code });
  const { token } = await auth("/convex/token", null, "GET");
  return token;
}

async function upload(client, uploadUrl, mime, data) {
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": mime }, body: data });
  if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`);
  return (await res.json()).storageId;
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args[0];
  if (!dir || dir.startsWith("--")) throw new Error("usage: node scripts/import-desktop.mjs <export-dir> --url <convex url>");
  const timezone = option(args, "--timezone") ?? "America/Santo_Domingo";
  const { book, expected, photos, logo, reversed } = readExport(dir, timezone);
  console.log(
    `Desktop book: ${book.clients.length} clients, ${book.loans.length} loans, ${book.payments.length} payments` +
      `${reversed ? ` (${reversed} reversed payments left out)` : ""}, ${photos.length} ID photos${logo ? ", a logo" : ""}; figures as of ${expected.asOf}.`,
  );

  const json = option(args, "--json");
  if (json) {
    writeFileSync(json, JSON.stringify({ book, expected }, null, 1));
    console.log(`Wrote ${json}; nothing was imported.`);
    return;
  }
  const url = option(args, "--url");
  if (!url) throw new Error("--url <https://<deployment>.convex.cloud> is required");
  const origin = option(args, "--origin") ?? "https://acervus-finance-pwa.vz-labs.workers.dev";

  const client = new ConvexHttpClient(url);
  client.setAuth(await signIn(url, origin, args));
  let result;
  try {
    result = await client.mutation(api.imports.desktopBook, { book, expected });
  } catch (e) {
    const data = e?.data;
    if (data?.code === "import_mismatch") {
      console.error("Nothing was imported. The cloud works these out differently from the desktop:");
      for (const d of data.differences) console.error(`  ${d}`);
    } else if (data?.code === "import_stale") {
      console.error(`Nothing was imported: the export is from ${data.exportedOn}, but today is ${data.today} there. Export again today.`);
    } else {
      console.error("Nothing was imported:", data ?? e.message);
    }
    process.exitCode = 1;
    return;
  }
  const { businessId, clientIds } = result;
  console.log(`Imported and checked: every split, late fee and figure matches the desktop as of ${result.asOf}.`);

  for (const p of photos) {
    const storageId = await upload(client, await client.mutation(api.clients.photoUploadUrl, { businessId }), p.mime, p.data);
    await client.mutation(api.clients.setPhoto, { businessId, clientId: clientIds[p.clientNo], storageId });
  }
  if (logo) {
    const storageId = await upload(client, await client.mutation(api.settings.logoUploadUrl, { businessId }), logo.mime, logo.data);
    await client.mutation(api.settings.setLogo, { businessId, storageId });
  }
  console.log(`Done: business ${businessId}${photos.length ? `, ${photos.length} ID photos` : ""}${logo ? ", logo" : ""}.`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("import-desktop.mjs")) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  });
}
