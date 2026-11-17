/**
 * SEC-04: current role-PIN version of a workspace, read by authMiddleware to
 * reject role tokens issued before the last PIN change/reset. Server-only.
 *
 * A tiny per-instance cache (ROLE_VERSION_CACHE_MS) avoids one extra query per
 * server-function call; the instance that changes a PIN drops its entry at
 * once, other instances notice within that window.
 */
export const ROLE_VERSION_CACHE_MS = 3000;

const cache = new Map<string, { v: number; at: number }>();

export function forgetRolePinVersion(userId: string): void {
  cache.delete(userId);
}

export async function currentRolePinVersion(userId: string): Promise<number> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < ROLE_VERSION_CACHE_MS) return hit.v;
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  let v = 1;
  try {
    const rows = await sql<{ role_pin_version: number | null }>`
      select role_pin_version from app_settings where user_id = ${userId}
    `;
    v = Number(rows[0]?.role_pin_version ?? 1) || 1;
  } catch {
    v = 1; // column not migrated yet
  }
  cache.set(userId, { v, at: Date.now() });
  return v;
}
