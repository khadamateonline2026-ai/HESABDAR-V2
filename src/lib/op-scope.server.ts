import { AsyncLocalStorage } from "node:async_hooks";
import type { Sql } from "@/lib/db";

/**
 * STR-04: idempotent replay of offline-queued writes.
 *
 * A save that carries an idempotency key runs inside `runWithOp`. The first
 * transaction it opens (`withTransaction` → `inOpTx`) inserts the key into
 * `offline_ops` and, just before COMMIT, stores the handler's result there.
 * Key and write therefore commit or roll back together:
 *  - a replay after the write committed hits the unique key, rolls back, and
 *    gets the stored original result;
 *  - a replay racing the first attempt blocks on the unique index until that
 *    attempt finishes, then behaves as above (or proceeds if it rolled back);
 *  - a failed attempt leaves no key, so the retry really runs.
 */
type OpScope = { userId: string; key: string; claimed: boolean };

const scopes = new AsyncLocalStorage<OpScope>();
const KEEP_DAYS = 90;

export class OpAlreadyApplied extends Error {
  constructor(readonly result: string | null) {
    super("این ثبت پیش‌تر انجام شده است");
  }
}

export function opResult(raw: string | null): unknown {
  if (raw == null) return { ok: true };
  try {
    return JSON.parse(raw);
  } catch {
    return { ok: true };
  }
}

/** Run one transaction body, claiming the current op key (if any) atomically with it. */
export async function inOpTx<T>(tx: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  const scope = scopes.getStore();
  if (!scope || scope.claimed) return fn(tx);
  const won = await tx`
    insert into offline_ops (user_id, op_key) values (${scope.userId}, ${scope.key})
    on conflict do nothing
    returning op_key
  `;
  if (!won.length) {
    const prev = await tx<{ result: string | null }>`
      select result from offline_ops where user_id = ${scope.userId} and op_key = ${scope.key}
    `;
    throw new OpAlreadyApplied(prev[0]?.result ?? null);
  }
  scope.claimed = true;
  try {
    const out = await fn(tx);
    await tx`
      update offline_ops set result = ${JSON.stringify(out ?? null)}
      where user_id = ${scope.userId} and op_key = ${scope.key}
    `;
    await tx`
      delete from offline_ops
      where user_id = ${scope.userId} and created_at < now() - make_interval(days => ${KEEP_DAYS})
    `;
    return out;
  } catch (err) {
    scope.claimed = false;
    throw err;
  }
}

/** Run a save handler under an idempotency key; a repeat returns the first result. */
export async function idempotentWith<T>(sql: Sql, userId: string, key: string, run: () => Promise<T>): Promise<T> {
  const done = await sql<{ result: string | null }>`
    select result from offline_ops where user_id = ${userId} and op_key = ${key}
  `;
  if (done[0]) return opResult(done[0].result) as T;
  return runUnderOp(userId, key, run);
}

/** Idempotency key of the current server-function request, if the client sent a valid one. */
export async function requestOpKey(): Promise<string | null> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { OFFLINE_OP_HEADER, isOpKey } = await import("@/lib/offline/op-key");
  const v = getRequest()?.headers.get(OFFLINE_OP_HEADER);
  return isOpKey(v) ? v : null;
}

/** Run under a key without the pre-check (also used by tests to simulate a lost race). */
export async function runUnderOp<T>(userId: string, key: string, run: () => Promise<T>): Promise<T> {
  try {
    return await scopes.run({ userId, key, claimed: false }, run);
  } catch (err) {
    if (err instanceof OpAlreadyApplied) return opResult(err.result) as T;
    throw err;
  }
}
