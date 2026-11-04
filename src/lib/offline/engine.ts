import { CONFLICT_USER_MESSAGE } from "@/lib/offline/conflict-policy";
import { queryClient } from "@/lib/query-client";

type Phase = "online" | "offline" | "syncing";

export type OfflineStatus = {
  phase: Phase;
  pending: number;
  warning: string;
};

type Row = {
  id: number;
  url: string;
  body: string;
  headers: [string, string][];
  clientAt: number;
  key: string;
  superseded: boolean;
};

type Cached = {
  url: string;
  status: number;
  body: string;
  contentType: string;
  serialized: string;
};

const DB = "hesabdar-offline";
const QUEUE = "queue";
const CACHE = "gets";
const SESSION_KEY = "hesabdar-offline-session";
const SAVE_URL = /save(SaleInvoice|PurchaseInvoice|PartyPayment|CatalogItem|OpeningStock|Sale|Purchase)|receivePurchaseInvoice/;
const ONLINE_ONLY = /sign-up|change-password|reset-password|forget-password|request-password-reset/;

function serverFnExport(url: string) {
  const id = decodeURIComponent((url.split("?")[0] ?? "").split("/").pop() || "");
  if (!id) return "";
  try {
    const b64 = id.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const json = JSON.parse(new TextDecoder().decode(bytes)) as { export?: unknown };
    return typeof json.export === "string" ? json.export : "";
  } catch {
    return id;
  }
}

function isSaveRequest(url: string) {
  return SAVE_URL.test(url) || SAVE_URL.test(serverFnExport(url));
}

let native: typeof fetch | null = null;
let dbp: Promise<IDBDatabase> | null = null;
const listeners = new Set<(s: OfflineStatus) => void>();
let status: OfflineStatus = {
  phase: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online",
  pending: 0,
  warning: "",
};
let flushing = false;

function emit(partial: Partial<OfflineStatus>) {
  status = { ...status, ...partial };
  for (const fn of listeners) fn(status);
}

export function getOfflineStatus() {
  return status;
}

export function subscribeOffline(fn: (s: OfflineStatus) => void) {
  listeners.add(fn);
  fn(status);
  return () => {
    listeners.delete(fn);
  };
}

function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: "url" });
      if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function txDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function putQueue(row: Omit<Row, "id">) {
  const db = await openDb();
  const tx = db.transaction(QUEUE, "readwrite");
  const store = tx.objectStore(QUEUE);
  const existing = await new Promise<Row[]>((resolve, reject) => {
    const r = store.getAll();
    r.onsuccess = () => resolve(r.result as Row[]);
    r.onerror = () => reject(r.error);
  });
  for (const old of existing) {
    if (!old.superseded && old.key === row.key && old.key.includes("#id:")) {
      old.superseded = true;
      store.put(old);
    }
  }
  store.add(row);
  await txDone(tx);
}

async function listQueue() {
  const db = await openDb();
  const tx = db.transaction(QUEUE, "readonly");
  const rows = await new Promise<Row[]>((resolve, reject) => {
    const r = tx.objectStore(QUEUE).getAll();
    r.onsuccess = () => resolve(r.result as Row[]);
    r.onerror = () => reject(r.error);
  });
  return rows.sort((a, b) => a.clientAt - b.clientAt || a.id - b.id);
}

async function deleteQueue(id: number) {
  const db = await openDb();
  const tx = db.transaction(QUEUE, "readwrite");
  tx.objectStore(QUEUE).delete(id);
  await txDone(tx);
}

async function countPending() {
  const rows = await listQueue();
  return rows.filter((r) => !r.superseded).length;
}

async function refreshCount() {
  try {
    emit({ pending: await countPending() });
  } catch {
    /* ignore */
  }
}

async function rememberGet(url: string, res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType || res.body == null) return;
  const body = await res.clone().text();
  if (body.length > 1_500_000) return;
  const db = await openDb();
  const tx = db.transaction(CACHE, "readwrite");
  const row: Cached = {
    url,
    status: res.status,
    body,
    contentType,
    serialized: res.headers.get("x-tss-serialized") || "",
  };
  tx.objectStore(CACHE).put(row);
  await txDone(tx);
  if (url.includes("/api/auth/get-session")) {
    try {
      localStorage.setItem(SESSION_KEY, body);
    } catch {
      /* ignore */
    }
  }
}

async function cachedGet(url: string) {
  if (url.includes("/api/auth/get-session")) {
    try {
      const body = localStorage.getItem(SESSION_KEY);
      if (body) {
        return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      }
    } catch {
      /* ignore */
    }
  }
  const db = await openDb();
  const tx = db.transaction(CACHE, "readonly");
  const row = await new Promise<Cached | undefined>((resolve, reject) => {
    const r = tx.objectStore(CACHE).get(url);
    r.onsuccess = () => resolve(r.result as Cached | undefined);
    r.onerror = () => reject(r.error);
  });
  if (!row) return null;
  const headers = new Headers({ "content-type": row.contentType });
  if (row.serialized) headers.set("x-tss-serialized", row.serialized);
  return new Response(row.body, { status: row.status, headers });
}

function entityKey(url: string, body: string) {
  const id = /"id"\s*:\s*(\d+)/.exec(body)?.[1];
  const fn = url.split("/").pop() || url;
  return id ? `${fn}#id:${id}` : `${fn}#new:${Date.now()}:${Math.random()}`;
}

function fakeOk() {
  return new Response(JSON.stringify({ ok: true, offline: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function onlineOnlyResponse() {
  return new Response(JSON.stringify({ message: "ثبت‌نام و تغییر رمز فقط با اینترنت ممکن است" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

async function flush() {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine || !native) return;
  flushing = true;
  emit({ phase: "syncing" });
  let warning = "";
  try {
    const rows = await listQueue();
    for (const row of rows) {
      if (row.superseded) {
        await deleteQueue(row.id);
        warning = "نسخه جدیدتر محلی ماند و نسخه قدیمی‌تر فرستاده نشد";
        continue;
      }
      const headers = new Headers(row.headers);
      headers.set("x-hesabdar-replay", "1");
      let res: Response;
      try {
        res = await native(row.url, { method: "POST", headers, body: row.body, credentials: "include" });
      } catch {
        emit({ phase: "offline", warning });
        return;
      }
      if (res.ok) {
        await deleteQueue(row.id);
        continue;
      }
      const text = await res.text().catch(() => "");
      if (res.status === 409 || /جدیدتر|تغییر کرده|conflict/i.test(text)) {
        await deleteQueue(row.id);
        warning = CONFLICT_USER_MESSAGE;
        continue;
      }
      warning = "هماهنگ یکی از ثبت‌ها ناکام شد و در صف ماند";
      break;
    }
    await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["sale-invoices"] });
    await queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
    await queryClient.invalidateQueries({ queryKey: ["party-payments"] });
    await queryClient.invalidateQueries({ queryKey: ["warehouse-stock"] });
    await queryClient.invalidateQueries({ queryKey: ["party-balance"] });
  } finally {
    flushing = false;
    const pending = await countPending().catch(() => status.pending);
    emit({
      phase: navigator.onLine ? "online" : "offline",
      pending,
      warning,
    });
  }
}

async function offlineFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init);
  const url = request.url;
  const method = request.method.toUpperCase();
  const replay = request.headers.get("x-hesabdar-replay") === "1";
  if (!native) return fetch(request);

  if (method === "GET") {
    try {
      const res = await native(request);
      if (res.ok) void rememberGet(url, res);
      return res;
    } catch (err) {
      const cached = await cachedGet(url).catch(() => null);
      if (cached) return cached;
      throw err;
    }
  }

  if (ONLINE_ONLY.test(url) && !navigator.onLine) return onlineOnlyResponse();
  if (method !== "POST" || replay || !isSaveRequest(url) || request.headers.get("x-tsr-serverfn") !== "true") {
    return native(request);
  }

  const body = await request.text();
  const headers: [string, string][] = [];
  // Never persist Authorization in IndexedDB — rely on credentials: "include" + httpOnly cookies.
  request.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "content-type" || k === "accept" || k === "x-tsr-serverfn") {
      headers.push([key, value]);
    }
  });
  await putQueue({
    url,
    body,
    headers,
    clientAt: Date.now(),
    key: entityKey(url, body),
    superseded: false,
  });
  emit({ pending: await countPending() });

  if (!navigator.onLine) return fakeOk();
  try {
    const res = await native(url, { method: "POST", headers, body, credentials: "include" });
    if (res.ok) {
      const rows = await listQueue();
      const mine = rows.filter((r) => !r.superseded && r.url === url && r.body === body);
      for (const row of mine) await deleteQueue(row.id);
      emit({ pending: await countPending(), phase: "online" });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      return res;
    }
    const failed = res.clone();
    const text = await res.clone().text().catch(() => "");
    if (res.status >= 400 && res.status < 500 && res.status !== 409) {
      const rows = await listQueue();
      const mine = rows.filter((r) => r.url === url && r.body === body);
      for (const row of rows.filter((r) => mine.includes(r))) await deleteQueue(row.id);
      emit({ pending: await countPending() });
    } else if (/جدیدتر|conflict/i.test(text)) {
      emit({ warning: "نسخه جدیدتر سرور ماند" });
    }
    return failed;
  } catch {
    emit({ phase: "offline" });
    return fakeOk();
  }
}

export function installOffline() {
  if (typeof window === "undefined" || native) return;
  native = window.fetch.bind(window);
  window.fetch = offlineFetch;
  window.addEventListener("online", () => {
    emit({ phase: "online" });
    void flush();
  });
  window.addEventListener("offline", () => emit({ phase: "offline" }));
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }
  void refreshCount().then(() => {
    if (navigator.onLine) void flush();
  });
}
