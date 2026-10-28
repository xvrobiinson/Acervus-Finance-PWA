// IndexedDB on the device, per signed-in user:
//   snapshots  the last copy of each business's records (for offline viewing)
//   businesses the user's business list (to start offline)
//   outbox     changes made on this device that the server hasn't confirmed
//   journal    what happened to outbox entries a person discarded (audit)
// Nothing here is the source of truth; Convex is. The outbox is the one
// thing that must never be lost silently, so it is only ever deleted by an
// explicit action (synced long ago, or discarded by the person, journaled).

import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";

export type OpKind = "client.create" | "payment.record" | "entry.expense" | "entry.income";

export type OpStatus =
  /** Waiting to be sent (or to be sent again). */
  | "pending"
  /** Being sent right now. */
  | "syncing"
  /** The server refused it: a person must review, fix, confirm or discard. */
  | "needs_review"
  /** Applied by the server. */
  | "synced";

export interface QueuedOp {
  opId: string;
  userId: string;
  businessId: string;
  kind: OpKind;
  /** The mutation's arguments, without businessId and opId. */
  args: Record<string, unknown>;
  /** What to show in lists ("Payment · María Pérez · RD$1,500.00"). */
  summary: { title: string; subtitle: string; amount?: number; loanId?: string; clientId?: string; on?: string };
  createdAt: number;
  /** Strictly increasing on this device: the order ops are sent in. */
  seq: number;
  status: OpStatus;
  attempts: number;
  lastAttemptAt?: number;
  /** The server's refusal, as sent (code + figures). */
  error?: { code: string } & Record<string, unknown>;
  syncedAt?: number;
  resultId?: string;
}

export interface JournalEntry {
  id: string;
  userId: string;
  businessId: string;
  at: number;
  action: "discarded";
  op: QueuedOp;
}

interface Schema extends DBSchema {
  snapshots: { key: string; value: { key: string; userId: string; businessId: string; savedAt: number; data: unknown } };
  businesses: { key: string; value: { userId: string; savedAt: number; list: unknown[] } };
  outbox: { key: string; value: QueuedOp; indexes: { by_user: string } };
  journal: { key: string; value: JournalEntry; indexes: { by_user: string } };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>("acervus-finance", 1, {
    upgrade(d) {
      d.createObjectStore("snapshots", { keyPath: "key" });
      d.createObjectStore("businesses", { keyPath: "userId" });
      d.createObjectStore("outbox", { keyPath: "opId" }).createIndex("by_user", "userId");
      d.createObjectStore("journal", { keyPath: "id" }).createIndex("by_user", "userId");
    },
  });
  return dbPromise;
}

/** For tests: close the connection and start from an empty database. */
export async function resetDbForTests() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  await deleteDB("acervus-finance");
}

export async function saveSnapshot(userId: string, businessId: string, data: unknown) {
  await (await db()).put("snapshots", { key: `${userId}:${businessId}`, userId, businessId, savedAt: Date.now(), data });
}

export async function loadSnapshot<T>(userId: string, businessId: string): Promise<{ savedAt: number; data: T } | null> {
  const row = await (await db()).get("snapshots", `${userId}:${businessId}`);
  return row ? { savedAt: row.savedAt, data: row.data as T } : null;
}

export async function saveBusinesses(userId: string, list: unknown[]) {
  await (await db()).put("businesses", { userId, savedAt: Date.now(), list });
}

export async function loadBusinesses<T>(userId: string): Promise<T[] | null> {
  return ((await (await db()).get("businesses", userId))?.list as T[] | undefined) ?? null;
}

/** Removes cached financial data for a user (on sign-out). The outbox is
 *  kept: those changes still belong to the user and sync at next sign-in. */
export async function clearCachedData(userId: string) {
  const d = await db();
  const tx = d.transaction(["snapshots", "businesses"], "readwrite");
  for (const key of await tx.objectStore("snapshots").getAllKeys()) if (String(key).startsWith(`${userId}:`)) await tx.objectStore("snapshots").delete(key);
  await tx.objectStore("businesses").delete(userId);
  await tx.done;
}

export async function putOp(op: QueuedOp) {
  await (await db()).put("outbox", op);
}

export async function getOp(opId: string): Promise<QueuedOp | undefined> {
  return (await db()).get("outbox", opId);
}

export async function opsFor(userId: string): Promise<QueuedOp[]> {
  const all = await (await db()).getAllFromIndex("outbox", "by_user", userId);
  return all.sort((a, b) => a.seq - b.seq);
}

/** Discards an op the server refused, keeping a record of it. */
export async function discardOp(op: QueuedOp) {
  const d = await db();
  const tx = d.transaction(["outbox", "journal"], "readwrite");
  await tx.objectStore("journal").put({
    id: `${op.opId}:${Date.now()}`,
    userId: op.userId,
    businessId: op.businessId,
    at: Date.now(),
    action: "discarded",
    op,
  });
  await tx.objectStore("outbox").delete(op.opId);
  await tx.done;
}

export async function journalFor(userId: string): Promise<JournalEntry[]> {
  return (await (await db()).getAllFromIndex("journal", "by_user", userId)).sort((a, b) => b.at - a.at);
}

/** Synced ops are kept a while as a visible receipt of what synced; then
 *  they are pruned. Pending or refused ops are never pruned. */
export async function pruneSynced(olderThanMs = 14 * 24 * 60 * 60_000) {
  const d = await db();
  const cutoff = Date.now() - olderThanMs;
  for (const op of await d.getAll("outbox")) {
    if (op.status === "synced" && (op.syncedAt ?? 0) < cutoff) await d.delete("outbox", op.opId);
  }
}
