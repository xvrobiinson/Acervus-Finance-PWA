// The outbox: new clients, payments, expenses and income are written here
// first (on this device, in IndexedDB) and then sent to Convex, oldest
// first. Each carries a unique operation id, so sending it again after a
// lost reply can never record it twice — the server answers with the first
// result.
//
// Outcomes:
//   applied            → "synced"
//   no connection      → stays "pending", tried again later
//   session expired    → stays "pending" until the person signs in again
//   refused by a rule  → "needs_review": shown to the person, who can fix and
//                        retry, confirm (stale loan), or discard (journaled).
// Nothing is ever dropped without a person deciding.

import { getOp, opsFor, putOp, type OpKind, type QueuedOp } from "./store";

export interface SendResult {
  resultId: string;
  /** Payments: the loan's version before and after this payment, so later
   *  queued payments on the same loan (entered against the same copy) are
   *  not mistaken for stale ones. */
  loanVersionBefore?: number;
  loanVersionAfter?: number;
}

export type Sender = (op: QueuedOp) => Promise<SendResult>;

/** How to treat a failed send. */
export type Disposition = "retry" | "auth" | "review";
export type Classifier = (error: unknown) => { disposition: Disposition; data?: QueuedOp["error"] };

export interface SyncReport {
  sent: number;
  refused: number;
  /** Why the run stopped early, if it did. */
  blocked: null | "network" | "auth";
}

const MAX_UNKNOWN_ATTEMPTS = 8;

let lastSeq = 0;

/** Increasing even for ops made in the same millisecond, and across reloads
 *  (time-based), so ops are always sent in the order they were made. */
function nextSeq(): number {
  lastSeq = Math.max(Date.now() * 1000, lastSeq + 1);
  return lastSeq;
}

export function newOpId(): string {
  return crypto.randomUUID();
}

export async function enqueue(op: {
  userId: string;
  businessId: string;
  kind: OpKind;
  args: Record<string, unknown>;
  summary: QueuedOp["summary"];
  opId?: string;
}): Promise<QueuedOp> {
  const queued: QueuedOp = {
    opId: op.opId ?? newOpId(),
    userId: op.userId,
    businessId: op.businessId,
    kind: op.kind,
    args: op.args,
    summary: op.summary,
    createdAt: Date.now(),
    seq: nextSeq(),
    status: "pending",
    attempts: 0,
  };
  await putOp(queued);
  return queued;
}

/** Puts a refused op back in the queue, optionally with changed arguments
 *  (same operation id: it was never applied). */
export async function retryOp(opId: string, changes?: { args?: Record<string, unknown>; summary?: QueuedOp["summary"] }) {
  const op = await getOp(opId);
  if (!op || op.status === "synced") return;
  await putOp({
    ...op,
    args: changes?.args ?? op.args,
    summary: changes?.summary ?? op.summary,
    status: "pending",
    error: undefined,
    attempts: 0,
  });
}

/** Sends every waiting op of `userId`, oldest first. */
export async function syncOnce(userId: string, send: Sender, classify: Classifier): Promise<SyncReport> {
  const report: SyncReport = { sent: 0, refused: 0, blocked: null };
  const queue = (await opsFor(userId)).filter((o) => o.status === "pending" || o.status === "syncing");
  for (const item of queue) {
    // Re-read: an earlier op in this run may have rebased it.
    const op = await getOp(item.opId);
    if (!op || (op.status !== "pending" && op.status !== "syncing")) continue;
    await putOp({ ...op, status: "syncing", attempts: op.attempts + 1, lastAttemptAt: Date.now() });
    try {
      const r = await send(op);
      await putOp({ ...op, status: "synced", attempts: op.attempts + 1, syncedAt: Date.now(), resultId: r.resultId, error: undefined });
      report.sent += 1;
      if (op.kind === "payment.record" && r.loanVersionBefore !== undefined && r.loanVersionAfter !== undefined) {
        await rebaseLoanVersion(userId, String(op.args.loanId), op.seq, r.loanVersionBefore, r.loanVersionAfter);
      }
    } catch (e) {
      const { disposition, data } = classify(e);
      const attempts = op.attempts + 1;
      if (disposition === "review" || (disposition === "retry" && data && attempts >= MAX_UNKNOWN_ATTEMPTS)) {
        await putOp({ ...op, status: "needs_review", attempts, error: data ?? { code: "unknown" } });
        report.refused += 1;
        continue;
      }
      await putOp({ ...op, status: "pending", attempts });
      report.blocked = disposition === "auth" ? "auth" : "network";
      break;
    }
  }
  return report;
}

/** Later payments queued on the same loan from the same copy of it saw the
 *  version before ours; our own payment doesn't make them stale. */
async function rebaseLoanVersion(userId: string, loanId: string, afterSeq: number, before: number, next: number) {
  for (const op of await opsFor(userId)) {
    if (
      op.kind === "payment.record" &&
      op.status !== "synced" &&
      op.seq > afterSeq &&
      String(op.args.loanId) === loanId &&
      op.args.loanVersion === before
    ) {
      await putOp({ ...op, args: { ...op.args, loanVersion: next } });
    }
  }
}

/** Runs `fn` with this origin's outbox lock, so two open tabs never send the
 *  same queue at once (the server would still record each op once). */
export async function withOutboxLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) return fn();
  return locks.request("acervus-outbox", { ifAvailable: true }, async (lock) => (lock ? fn() : null));
}
