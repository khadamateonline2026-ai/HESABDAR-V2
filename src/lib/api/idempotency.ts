import { getSql } from "@/lib/db";

/**
 * STR-04: wrap a queued-save handler so a replay with the same client
 * idempotency key (x-hesabdar-op) returns the original result instead of
 * writing twice. Requests without a key run unchanged.
 */
export async function idempotent<T>(userId: string, run: () => Promise<T>): Promise<T> {
  const ops = await import("@/lib/op-scope.server");
  const key = await ops.requestOpKey();
  if (!key) return run();
  return ops.idempotentWith(await getSql(), userId, key, run);
}
