import { getSql } from "@/lib/db";
import { peekSessionRole } from "@/lib/session-role-slot";

/**
 * STR-04: wrap a queued-save handler so a replay with the same client
 * idempotency key (x-hesabdar-op) returns the original result instead of
 * writing twice. Requests without a key run unchanged.
 */
export async function idempotent<T>(userId: string, run: () => Promise<T>): Promise<T> {
  const ops = await import("@/lib/op-scope.server");
  const key = await ops.requestOpKey();
  // SEC-02: nothing (not even a stored result) is returned before a role is unlocked.
  if (!key || !peekSessionRole()) return run();
  return ops.idempotentWith(await getSql(), userId, key, run);
}
