// Differential test against the desktop app's Rust engine.
//
// `fixtures/oracle-vectors.json` was produced by a small Rust program that
// compiles the desktop's own src/domain/*.rs files unchanged and runs random
// loans, payments (every allocation mode, backdated, too large, in the
// future), edited schedules, waived fees, defaults and whole portfolios
// through them (see docs/ENGINE.md). Every figure the Rust engine produced
// must come out of this TypeScript engine identically.
//
// Set ORACLE_VECTORS=<path> to run a larger generated file.

import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { addDays, maxDay, type Day } from "./dates";
import {
  installmentStatus,
  planDelinquency,
  planPosition,
  run,
  sum,
  type Applied,
  type Instruction,
  type Plan,
  type PlanPayment,
} from "./index";
import {
  delinquency,
  displayStatus,
  owedAtPayment,
  periodStates,
  position,
  reallocate,
  type ContractStatus,
  type LoanFacts,
  type PaymentFact,
} from "./ledger";
import type { Frequency, Method } from "./loans";
import {
  availableFrom,
  balancesOn,
  gain,
  history,
  monthlyCashFlow,
  netInvested,
  shortfall,
  summary,
  type Account,
  type Book,
  type LoanBook,
} from "./portfolio";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

function load(): Json {
  const custom = process.env.ORACLE_VECTORS;
  const path = custom ?? new URL("./fixtures/oracle-vectors.json.gz", import.meta.url);
  if (custom && !existsSync(custom)) throw new Error(`ORACLE_VECTORS not found: ${custom}`);
  const raw = readFileSync(path);
  return JSON.parse((String(path).endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));
}

const vectors = load();
const TODAY: Day = vectors.today;

type Accepted = { paidOn: Day; amount: number; fee: number; instruction: Instruction };

interface Built {
  facts: LoanFacts;
  plan: Plan | null;
  accepted: Accepted[];
  splits: Applied[][];
  paymentFacts: PaymentFact[];
}

function facts(l: Json, status: ContractStatus = "active", closedOn: Day | null = null): LoanFacts {
  return {
    principal: l.principal,
    rate: { rate: l.rate, per: l.interestPeriod as Frequency, every: l.frequency as Frequency },
    frequency: l.frequency,
    startDate: l.startDate,
    status,
    closedOn,
  };
}

/** Mirrors the desktop services: every accepted payment plus the candidate,
 *  re-run from the loan's terms. */
function tryPayments(b: Built, candidate: Accepted[]): { splits: Applied[][]; facts: PaymentFact[] } | { error: Json } {
  if (!b.plan) {
    const r = reallocate(b.facts, candidate.map((p) => ({ paidOn: p.paidOn, amount: p.amount, fee: p.fee })), TODAY);
    if (!r.ok) return { error: r.error };
    return {
      splits: r.value.map((a) => [{ seq: 0, principal: a.principal, interest: a.interest, fee: a.fee }]),
      facts: r.value.map((a, i) => ({ paidOn: candidate[i].paidOn, principal: a.principal, interest: a.interest, fee: a.fee })),
    };
  }
  const pays: PlanPayment[] = candidate.map((p) => ({ paidOn: p.paidOn, amount: p.amount, instruction: p.instruction }));
  const asOf = candidate.length ? maxDay(TODAY, candidate[candidate.length - 1].paidOn) : TODAY;
  const r = run(b.facts, b.plan, pays, asOf, asOf);
  if (!r.ok) return { error: r.error };
  return {
    splits: r.value.payments,
    facts: r.value.payments.map((a, i) => ({
      paidOn: candidate[i].paidOn,
      principal: sum(a.map((x) => x.principal)),
      interest: sum(a.map((x) => x.interest)),
      fee: sum(a.map((x) => x.fee)),
    })),
  };
}

const STATUS: Record<string, string> = {
  Overdue: "overdue", PartlyPaid: "partly_paid", Due: "due", Upcoming: "upcoming", Paid: "paid", Open: "open",
};

function replayScenario(s: Json): Built {
  const l = s.loan;
  const b: Built = {
    facts: facts(l),
    plan: l.schedule
      ? { method: l.method as Method, schedule: l.schedule, edited: l.edited, feeRate: l.lateFeeRate, waived: l.waived }
      : null,
    accepted: [],
    splits: [],
    paymentFacts: [],
  };
  for (const a of s.attempts) {
    const candidate = [...b.accepted];
    const at = candidate.findIndex((p) => p.paidOn > a.paidOn);
    candidate.splice(at < 0 ? candidate.length : at, 0, {
      paidOn: a.paidOn, amount: a.amount, fee: a.fee, instruction: a.instruction,
    });
    const r = tryPayments(b, candidate);
    if ("error" in r) {
      expect({ ok: false, error: r.error }, `scenario ${s.id} attempt`).toEqual(a.outcome);
    } else {
      expect({ ok: true, splits: r.splits }, `scenario ${s.id} attempt`).toEqual(a.outcome);
      b.accepted = candidate;
      b.splits = r.splits;
      b.paymentFacts = r.facts;
    }
  }
  b.facts = facts(l, l.finalStatus, l.closedOn);
  return b;
}

function fixedPayments(b: Built): PlanPayment[] {
  return b.accepted.map((p, i) => ({ paidOn: p.paidOn, amount: p.amount, instruction: { kind: "fixed", applied: b.splits[i] } }));
}

const built = new Map<number, Built>();

describe(`Rust engine oracle (seed ${vectors.seed}, ${vectors.scenarios.length} loans, ${vectors.books.length} portfolios)`, () => {
  it("every payment attempt, split and checkpoint matches", { timeout: 600_000 }, () => {
    for (const s of vectors.scenarios) {
      const b = replayScenario(s);
      built.set(s.id, b);
      for (const cp of s.checkpoints) {
        const where = `scenario ${s.id} as of ${cp.asOf}`;
        if (!b.plan) {
          const pos = position(b.facts, b.paymentFacts, cp.asOf);
          const q = delinquency(b.facts, b.paymentFacts, cp.asOf);
          expect(pos, where).toEqual(cp.position);
          expect(owedAtPayment(b.facts, b.paymentFacts, cp.asOf), where).toEqual(cp.owedAtPayment);
          expect(q, where).toEqual(cp.delinquency);
          expect(displayStatus(b.facts, q, cp.asOf), where).toBe(cp.display);
          expect(
            periodStates(pos, cp.asOf).map((x) => ({ seq: x.period.seq, state: x.state, paid: x.paid })),
            where,
          ).toEqual(cp.periodStates.map((x: Json) => ({ ...x, state: STATUS[x.state] })));
          continue;
        }
        const r = run(b.facts, b.plan, fixedPayments(b), cp.asOf, TODAY);
        if (!r.ok) {
          expect({ asOf: cp.asOf, error: r.error }, where).toEqual(cp);
          continue;
        }
        const st = r.value;
        const q = planDelinquency(st, b.facts.status, cp.asOf);
        expect(
          {
            installments: st.installments.map((x) => ({ ...x, status: installmentStatus(x, cp.asOf) })),
            payments: st.payments,
            paidTotal: st.paidTotal,
            lastPayment: st.lastPayment,
          },
          where,
        ).toEqual({
          ...cp.state,
          installments: cp.state.installments.map((x: Json) => ({ ...x, status: STATUS[x.status] })),
        });
        expect(planPosition(st), where).toEqual(cp.position);
        expect(q, where).toEqual(cp.delinquency);
        expect(displayStatus(b.facts, q, cp.asOf), where).toBe(cp.display);
      }
      if (s.realloc) {
        const e = s.realloc;
        const edited: LoanFacts = {
          ...b.facts,
          principal: e.principal,
          rate: { rate: e.rate, per: e.interestPeriod, every: b.facts.frequency },
          startDate: e.startDate,
        };
        const r = reallocate(edited, b.accepted.map((p) => ({ paidOn: p.paidOn, amount: p.amount, fee: p.fee })), TODAY);
        const got = r.ok ? { ok: true, allocations: r.value } : { ok: false, index: r.error.index, error: r.error.error };
        expect(got, `scenario ${s.id} reallocation`).toEqual(e.result);
      }
    }
  });

  it("every portfolio figure matches", { timeout: 600_000 }, () => {
    for (const bk of vectors.books) {
      const book: Book = {
        loans: bk.loanIds.map((id: number, i: number): LoanBook => {
          const b = built.get(id)!;
          return {
            id: String(i),
            clientId: "c",
            facts: b.facts,
            payments: b.paymentFacts,
            plan: b.plan ? { ...b.plan, payments: fixedPayments(b) } : null,
          };
        }),
        capital: bk.moves.filter((m: Json) => m.type === "capital").map((m: Json) => ({
          kind: m.kind, amount: m.amount, occurredOn: m.occurredOn,
        })),
        entries: bk.moves.filter((m: Json) => m.type === "entry").map((m: Json) => ({
          kind: m.kind, account: m.account as Account, amount: m.amount, occurredOn: m.occurredOn,
        })),
      };
      for (const p of bk.points) {
        const s = summary(book, p.asOf);
        const where = `portfolio ${bk.loanIds} as of ${p.asOf}`;
        expect({ ...s, netInvested: netInvested(s), gain: gain(s) }, where).toEqual(p.summary);
        expect(balancesOn(book, p.asOf), where).toEqual(p.balances);
        expect(availableFrom(book, p.asOf, null), where).toBe(p.availableAll);
        expect(availableFrom(book, p.asOf, "capital"), where).toBe(p.availableCapital);
        expect(availableFrom(book, p.asOf, "interest"), where).toBe(p.availableInterest);
      }
      expect(shortfall(book)).toEqual(bk.shortfall);
      expect(monthlyCashFlow(book, bk.flowsTo)).toEqual(bk.flows);
      if (bk.historyTo) expect(history(book, bk.historyFrom, bk.historyTo)).toEqual(bk.history);
    }
  });

  it("covers the cases that matter", () => {
    const attempts = vectors.scenarios.flatMap((s: Json) => s.attempts);
    const errors = new Set(attempts.filter((a: Json) => !a.outcome.ok).map((a: Json) => a.outcome.error.error.code));
    const kinds = new Set(attempts.filter((a: Json) => a.outcome.ok).map((a: Json) => a.instruction.kind));
    expect([...kinds].sort()).toEqual(["auto", "custom", "installment", "spread"]);
    for (const code of ["overpayment", "in_future", "exceeds_installment", "split_mismatch", "exceeds_part"]) {
      expect(errors.has(code), code).toBe(true);
    }
    expect(addDays(TODAY, 0)).toBe(TODAY);
  });
});
