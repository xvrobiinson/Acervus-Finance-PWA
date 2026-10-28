// The offline queue against a simulated server with the same rules as the
// real one (idempotent operation ids, loan versions): nothing is lost,
// nothing is recorded twice, refusals wait for a person.

import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { enqueue, retryOp, syncOnce, type Classifier, type Sender } from "./outbox";
import { discardOp, getOp, journalFor, opsFor, putOp, resetDbForTests } from "./store";

class Refused extends Error {
  constructor(public data: { code: string } & Record<string, unknown>) {
    super(data.code);
  }
}
class Offline extends Error {}
class SignedOut extends Error {}

/** A server that applies each operation id once and tracks loan versions. */
class FakeServer {
  applied = new Map<string, { resultId: string; loanVersionBefore?: number; loanVersionAfter?: number }>();
  payments: { opId: string; loanId: string; amount: number }[] = [];
  loanVersion = new Map<string, number>([["loan1", 3]]);
  online = true;
  signedIn = true;
  /** Applies the next call but loses the reply. */
  dropNextReply = false;

  send: Sender = async (op) => {
    if (!this.online) throw new Offline("network down");
    if (!this.signedIn) throw new SignedOut("unauthenticated");
    const prior = this.applied.get(op.opId);
    if (prior) return prior;
    if (op.kind === "payment.record") {
      const loanId = String(op.args.loanId);
      const current = this.loanVersion.get(loanId)!;
      if (op.args.loanVersion !== current && !op.args.confirmedStale) throw new Refused({ code: "stale", seen: op.args.loanVersion });
      if (Number(op.args.amount) > 1_000_000) throw new Refused({ code: "payment", error: { code: "overpayment" } });
      this.payments.push({ opId: op.opId, loanId, amount: Number(op.args.amount) });
      this.loanVersion.set(loanId, current + 1);
      const result = { resultId: `p${this.payments.length}`, loanVersionBefore: current, loanVersionAfter: current + 1 };
      this.applied.set(op.opId, result);
      if (this.dropNextReply) {
        this.dropNextReply = false;
        throw new Offline("connection lost before the reply");
      }
      return result;
    }
    const result = { resultId: `r${this.applied.size + 1}` };
    this.applied.set(op.opId, result);
    return result;
  };
}

const classify: Classifier = (e) => {
  if (e instanceof Refused) return { disposition: "review", data: e.data };
  if (e instanceof SignedOut) return { disposition: "auth" };
  return { disposition: "retry" };
};

const payment = (amount: number, loanVersion = 3) => ({
  userId: "u1",
  businessId: "b1",
  kind: "payment.record" as const,
  args: { loanId: "loan1", loanVersion, amount, fee: 0, paidOn: "2026-10-27", notes: "", instruction: { kind: "auto" } },
  summary: { title: "Payment", subtitle: "María", amount },
});

beforeEach(async () => {
  await resetDbForTests();
});
afterAll(async () => {
  await resetDbForTests();
});

describe("outbox", () => {
  it("keeps changes made offline and sends them once when back online", async () => {
    const server = new FakeServer();
    server.online = false;
    await enqueue(payment(50_000));
    await enqueue({ ...payment(0), kind: "entry.expense", args: { kind: "expense", amount: 1_000 } });
    expect(await syncOnce("u1", server.send, classify)).toEqual({ sent: 0, refused: 0, blocked: "network" });
    expect((await opsFor("u1")).map((o) => o.status)).toEqual(["pending", "pending"]);

    server.online = true;
    expect(await syncOnce("u1", server.send, classify)).toEqual({ sent: 2, refused: 0, blocked: null });
    expect((await opsFor("u1")).every((o) => o.status === "synced")).toBe(true);
    // Running again sends nothing.
    expect((await syncOnce("u1", server.send, classify)).sent).toBe(0);
    expect(server.payments).toHaveLength(1);
  });

  it("never records a payment twice when the reply is lost", async () => {
    const server = new FakeServer();
    server.dropNextReply = true;
    const op = await enqueue(payment(50_000));
    expect((await syncOnce("u1", server.send, classify)).blocked).toBe("network");
    expect((await getOp(op.opId))!.status).toBe("pending");
    await syncOnce("u1", server.send, classify);
    expect(server.payments).toHaveLength(1);
    expect((await getOp(op.opId))!).toMatchObject({ status: "synced", resultId: "p1" });
  });

  it("does not treat a second payment on the same loan from this device as stale", async () => {
    const server = new FakeServer();
    server.online = false;
    await enqueue(payment(10_000));
    await enqueue(payment(20_000));
    server.online = true;
    expect(await syncOnce("u1", server.send, classify)).toEqual({ sent: 2, refused: 0, blocked: null });
    expect(server.payments.map((p) => p.amount)).toEqual([10_000, 20_000]);
  });

  it("holds a payment for review when another device changed the loan first", async () => {
    const server = new FakeServer();
    const op = await enqueue(payment(10_000));
    server.loanVersion.set("loan1", 4); // someone else recorded a payment
    expect(await syncOnce("u1", server.send, classify)).toEqual({ sent: 0, refused: 1, blocked: null });
    expect((await getOp(op.opId))!).toMatchObject({ status: "needs_review", error: { code: "stale" } });
    // A refused op is never retried on its own…
    await syncOnce("u1", server.send, classify);
    expect(server.payments).toHaveLength(0);
    // …until the person confirms it.
    await retryOp(op.opId, { args: { ...op.args, confirmedStale: true } });
    await syncOnce("u1", server.send, classify);
    expect(server.payments).toHaveLength(1);
  });

  it("carries on with other changes when one is refused", async () => {
    const server = new FakeServer();
    await enqueue(payment(99_000_000));
    await enqueue({ ...payment(0), kind: "client.create", args: { fullName: "Nuevo" } });
    expect(await syncOnce("u1", server.send, classify)).toEqual({ sent: 1, refused: 1, blocked: null });
  });

  it("waits for the person to sign in again when the session expired", async () => {
    const server = new FakeServer();
    server.signedIn = false;
    await enqueue(payment(10_000));
    expect((await syncOnce("u1", server.send, classify)).blocked).toBe("auth");
    expect((await opsFor("u1"))[0].status).toBe("pending");
    server.signedIn = true;
    expect((await syncOnce("u1", server.send, classify)).sent).toBe(1);
  });

  it("sends only the signed-in user's changes", async () => {
    const server = new FakeServer();
    await enqueue({ ...payment(10_000), userId: "someone-else" });
    expect((await syncOnce("u1", server.send, classify)).sent).toBe(0);
    expect(await opsFor("someone-else")).toHaveLength(1);
  });

  it("resends an op interrupted mid-send (the server keeps it to one)", async () => {
    const server = new FakeServer();
    const op = await enqueue(payment(10_000));
    await putOp({ ...op, status: "syncing" });
    expect((await syncOnce("u1", server.send, classify)).sent).toBe(1);
  });

  it("keeps a record of a discarded change", async () => {
    const server = new FakeServer();
    const op = await enqueue(payment(99_000_000));
    await syncOnce("u1", server.send, classify);
    await discardOp((await getOp(op.opId))!);
    expect(await getOp(op.opId)).toBeUndefined();
    const journal = await journalFor("u1");
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ action: "discarded", op: { opId: op.opId, status: "needs_review" } });
  });
});
