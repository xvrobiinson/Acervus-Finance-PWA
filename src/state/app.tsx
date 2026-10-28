// The app's state: who is signed in (also when the app starts offline), the
// chosen business, its records (live from Convex, or the last copy kept on
// this device), the figures worked out from them, and the outbox of changes
// waiting to reach the server.

import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { todayIn, type Day } from "../../shared/domain/dates";
import { authClient, cachedSessionUser } from "../lib/auth-client";
import { errorData, isNetworkError } from "../lib/errors";
import { makeFmt, type Fmt } from "../lib/format";
import { useLang } from "../lib/i18n";
import { enqueue, retryOp, syncOnce, withOutboxLock, type Classifier, type Sender, type SyncReport } from "../offline/outbox";
import {
  clearCachedData,
  discardOp,
  getOp,
  loadBusinesses,
  loadSnapshot,
  opsFor,
  pruneSynced,
  saveBusinesses,
  saveSnapshot,
  type OpKind,
  type QueuedOp,
} from "../offline/store";
import { computeBooks, type Books } from "./books";
import { can, type BusinessSummary, type Role, type Snapshot } from "./types";

export type Mode = "loading" | "signed_out" | "online" | "offline";
export interface User {
  id: string;
  email: string;
  name: string;
}

export interface SubmitResult {
  status: "synced" | "queued" | "refused";
  op: QueuedOp;
  resultId?: string;
  error?: QueuedOp["error"];
}

interface AppState {
  mode: Mode;
  user: User | null;
  /** The browser has a network connection. */
  online: boolean;
  /** Connected to the server right now. */
  connected: boolean;
  continueOffline: () => void;
  businesses: BusinessSummary[] | null;
  businessId: Id<"businesses"> | null;
  setBusinessId: (id: Id<"businesses">) => void;
  business: BusinessSummary | null;
  role: Role | undefined;
  can: (need: "read" | "record" | "manage") => boolean;
  snapshot: Snapshot | null;
  /** Where the records shown come from. */
  source: "live" | "cache" | null;
  savedAt: number | null;
  books: Books | null;
  today: Day;
  fmt: Fmt;
  ops: QueuedOp[];
  refreshOps: () => Promise<void>;
  syncing: boolean;
  lastSync: { at: number; report: SyncReport } | null;
  syncNow: () => Promise<void>;
  submit: (kind: OpKind, args: Record<string, unknown>, summary: QueuedOp["summary"], opId?: string) => Promise<SubmitResult>;
  discard: (op: QueuedOp) => Promise<void>;
  retry: (op: QueuedOp, args?: Record<string, unknown>) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

const LAST_USER = "acervus.lastUser";

function readLastUser(): User | null {
  try {
    const raw = localStorage.getItem(LAST_USER);
    if (raw) return JSON.parse(raw) as User;
  } catch {
    /* ignore */
  }
  return cachedSessionUser();
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for the server")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const classify: Classifier = (e) => {
  const d = errorData(e);
  if (!d) {
    if (isNetworkError(e)) return { disposition: "retry" };
    // A server fault: retried a few times, then shown to a person.
    return { disposition: "retry", data: { code: "unknown", message: e instanceof Error ? e.message.slice(0, 300) : "" } };
  }
  if (d.code === "unauthenticated") return { disposition: "auth" };
  if (d.code === "rate_limited") return { disposition: "retry" };
  return { disposition: "review", data: d };
};

export function AppStateProvider({ children }: { children: ReactNode }) {
  const convex = useConvex();
  const { lang } = useLang();
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.auth.getCurrentUser, isAuthenticated ? {} : "skip");
  const online = useOnline();
  const [socket, setSocket] = useState(() => convex.connectionState().isWebSocketConnected);
  useEffect(() => convex.subscribeToConnectionState((s) => setSocket(s.isWebSocketConnected)), [convex]);
  // The browser knows it lost the network before the WebSocket notices, so
  // both have to say so: never treat a dropped connection as live.
  const connected = socket && online;

  const [lastUser, setLastUser] = useState<User | null>(readLastUser);
  const [forcedOffline, setForcedOffline] = useState(false);
  useEffect(() => {
    if (!me) return;
    const u = { id: me.id, email: me.email, name: me.name };
    setLastUser(u);
    setForcedOffline(false);
    try {
      localStorage.setItem(LAST_USER, JSON.stringify(u));
    } catch {
      /* ignore */
    }
  }, [me]);

  let mode: Mode;
  if (isAuthenticated && me) mode = "online";
  else if (lastUser && (!online || forcedOffline)) mode = "offline";
  else if (authLoading || (isAuthenticated && me === undefined)) mode = "loading";
  else mode = "signed_out";
  const user: User | null = mode === "online" ? { id: me!.id, email: me!.email, name: me!.name } : mode === "offline" ? lastUser : null;
  const userId = user?.id ?? null;

  // ----- businesses -------------------------------------------------------
  const liveBusinesses = useQuery(api.businesses.mine, mode === "online" ? {} : "skip");
  const [cachedBusinesses, setCachedBusinesses] = useState<BusinessSummary[] | null>(null);
  useEffect(() => {
    setCachedBusinesses(null);
    if (userId) void loadBusinesses<BusinessSummary>(userId).then(setCachedBusinesses);
  }, [userId]);
  useEffect(() => {
    if (userId && liveBusinesses) void saveBusinesses(userId, liveBusinesses);
  }, [userId, liveBusinesses]);
  const businesses = liveBusinesses ?? cachedBusinesses;

  const businessKey = userId ? `acervus.business.${userId}` : null;
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    try {
      setChosen(businessKey ? localStorage.getItem(businessKey) : null);
    } catch {
      setChosen(null);
    }
  }, [businessKey]);
  const business = businesses?.find((b) => b.businessId === chosen) ?? businesses?.[0] ?? null;
  const businessId = (business?.businessId ?? null) as Id<"businesses"> | null;
  const setBusinessId = useCallback(
    (id: Id<"businesses">) => {
      setChosen(id);
      try {
        if (businessKey) localStorage.setItem(businessKey, id);
      } catch {
        /* ignore */
      }
    },
    [businessKey],
  );

  // ----- records ----------------------------------------------------------
  const live = useQuery(api.data.snapshot, mode === "online" && businessId ? { businessId } : "skip");
  const [cached, setCached] = useState<{ savedAt: number; data: Snapshot } | null>(null);
  useEffect(() => {
    setCached(null);
    if (userId && businessId) void loadSnapshot<Snapshot>(userId, businessId).then(setCached);
  }, [userId, businessId]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!userId || !businessId || !live) return;
    void saveSnapshot(userId, businessId, live).then(() => setSavedAt(Date.now()));
  }, [userId, businessId, live]);
  const snapshot = live ?? cached?.data ?? null;
  const source = live ? "live" : cached ? "cache" : null;

  const timezone = business?.timezone ?? snapshot?.business.timezone ?? "UTC";
  const today = live?.today ?? todayIn(timezone);
  const books = useMemo(() => (snapshot ? computeBooks(snapshot, today) : null), [snapshot, today]);
  const fmt = useMemo(() => makeFmt(snapshot?.settings, lang, today), [snapshot?.settings, lang, today]);
  const role = (snapshot?.me.role ?? business?.role) as Role | undefined;

  // ----- outbox -----------------------------------------------------------
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const refreshOps = useCallback(async () => {
    setOps(userId ? await opsFor(userId) : []);
  }, [userId]);
  useEffect(() => {
    void pruneSynced().then(refreshOps);
  }, [refreshOps]);

  const send: Sender = useCallback(
    async (op) => {
      const args = { businessId: op.businessId as Id<"businesses">, opId: op.opId, ...op.args } as never;
      switch (op.kind) {
        case "client.create": {
          const r = await withTimeout(convex.mutation(api.clients.create, args), 25_000);
          return { resultId: r.clientId };
        }
        case "payment.record": {
          const r = await withTimeout(convex.mutation(api.payments.record, args), 25_000);
          return { resultId: r.paymentId, loanVersionBefore: r.loanVersionBefore, loanVersionAfter: r.loanVersionAfter };
        }
        case "entry.expense":
        case "entry.income": {
          const r = await withTimeout(convex.mutation(api.money.addEntry, args), 25_000);
          return { resultId: r.entryId };
        }
      }
    },
    [convex],
  );

  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<AppState["lastSync"]>(null);
  const running = useRef(false);
  const syncNow = useCallback(async () => {
    if (mode !== "online" || !userId || running.current) return;
    if (!navigator.onLine || !convex.connectionState().isWebSocketConnected) return;
    running.current = true;
    setSyncing(true);
    try {
      const report = await withOutboxLock(() => syncOnce(userId, send, classify));
      if (report) setLastSync({ at: Date.now(), report });
    } finally {
      running.current = false;
      setSyncing(false);
      await refreshOps();
    }
  }, [mode, userId, convex, send, refreshOps]);

  // Send waiting changes when the connection comes back, when the app comes
  // to the front, and every 30 seconds while anything is waiting.
  useEffect(() => {
    if (mode === "online" && connected) void syncNow();
  }, [mode, connected, syncNow]);
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    const timer = setInterval(() => {
      if (ops.some((o) => o.status === "pending" || o.status === "syncing")) void syncNow();
    }, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      clearInterval(timer);
    };
  }, [syncNow, ops]);

  const submit = useCallback(
    async (kind: OpKind, args: Record<string, unknown>, summary: QueuedOp["summary"], opId?: string): Promise<SubmitResult> => {
      if (!userId || !businessId) throw new Error("no business");
      const offline = mode !== "online" || !navigator.onLine || !convex.connectionState().isWebSocketConnected;
      const fullArgs = offline ? { ...args, deviceRecordedAt: Date.now() } : { ...args };
      let op: QueuedOp;
      const existing = opId ? await getOp(opId) : undefined;
      if (existing && existing.status !== "synced") {
        await retryOp(existing.opId, { args: fullArgs, summary });
        op = (await getOp(existing.opId))!;
      } else {
        op = await enqueue({ userId, businessId, kind, args: fullArgs, summary });
      }
      await refreshOps();
      if (offline) return { status: "queued", op };
      await syncNow();
      const after = (await getOp(op.opId))!;
      if (after.status === "synced") return { status: "synced", op: after, resultId: after.resultId };
      if (after.status === "needs_review") {
        // Refused while the person is still on the form: they see why and
        // keep what they typed, so it doesn't also wait in the outbox.
        await discardOp(after);
        await refreshOps();
        return { status: "refused", op: after, error: after.error };
      }
      return { status: "queued", op: after };
    },
    [userId, businessId, mode, convex, refreshOps, syncNow],
  );

  const discard = useCallback(
    async (op: QueuedOp) => {
      await discardOp(op);
      await refreshOps();
    },
    [refreshOps],
  );
  const retry = useCallback(
    async (op: QueuedOp, args?: Record<string, unknown>) => {
      await retryOp(op.opId, args ? { args } : undefined);
      await refreshOps();
      void syncNow();
    },
    [refreshOps, syncNow],
  );

  const signOut = useCallback(async () => {
    const id = userId;
    try {
      await authClient.signOut();
    } catch {
      /* offline: the local session is still removed below */
    }
    try {
      localStorage.removeItem(LAST_USER);
      localStorage.removeItem("better-auth_session_data");
      localStorage.removeItem("better-auth_cookie");
    } catch {
      /* ignore */
    }
    if (id) await clearCachedData(id);
    setLastUser(null);
    setForcedOffline(false);
    location.assign("/sign-in");
  }, [userId]);

  const value: AppState = {
    mode,
    user,
    online,
    connected,
    continueOffline: () => setForcedOffline(true),
    businesses,
    businessId,
    setBusinessId,
    business,
    role,
    can: (need) => can(role, need),
    snapshot,
    source,
    savedAt: source === "live" ? (savedAt ?? Date.now()) : (cached?.savedAt ?? null),
    books,
    today,
    fmt,
    ops,
    refreshOps,
    syncing,
    lastSync,
    syncNow,
    submit,
    discard,
    retry,
    signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppStateProvider missing");
  return v;
}

/** The app state once a business and its records are loaded. */
export function useBooks() {
  const app = useApp();
  if (!app.snapshot || !app.books || !app.businessId) throw new Error("business data not loaded");
  return { ...app, snapshot: app.snapshot, books: app.books, businessId: app.businessId };
}
