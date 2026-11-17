/**
 * SEC-03: one server-side gate for every role secret (role PIN, accountant
 * code, emailed reset code), with a persistent, atomic, per-workspace limiter
 * stored in app_settings (migration 0030).
 *
 * - An attempt is "reserved" with one atomic UPDATE before the secret is
 *   checked, so parallel guesses cannot exceed ROLE_PIN_MAX_FAILS.
 * - ROLE_PIN_MAX_FAILS wrong answers lock the workspace's role checks for
 *   15 min, then 30, 60 … (max 24 h). A correct answer resets everything.
 * - Failures older than 15 minutes are forgotten.
 * - Legacy plaintext PINs are accepted once and immediately re-hashed; the
 *   well-known factory defaults are never accepted (use the email reset).
 *
 * Never call this inside a transaction that may roll back: the failure
 * counter must survive the request.
 */
import { hashPin, isHashedPin, legacyPlainMatches, verifyPin } from "@/lib/auth/pin-hash";
import type { Sql } from "@/lib/db";
import type { Role } from "@/lib/types";

export const ROLE_PIN_MAX_FAILS = 5;
export const ROLE_FAIL_WINDOW_MIN = 15;
export const ROLE_LOCK_BASE_MIN = 15;
export const ROLE_LOCK_MAX_MIN = 24 * 60;

/** Factory defaults from migration 0003 — public knowledge, never valid. */
const PUBLIC_DEFAULT_PINS = new Set(["12345", "102030", "54321"]);

const ROLES: Role[] = ["supervisor", "accountant", "seller"];

export function lockMinutesForLevel(level: number): number {
  return Math.min(ROLE_LOCK_BASE_MIN * 2 ** Math.max(0, level), ROLE_LOCK_MAX_MIN);
}

function lockedMessage(until: Date): string {
  const mins = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  return `به‌خاطر تلاش‌های ناموفق، کد نقش‌ها قفل است. حدود ${mins} دقیقه دیگر دوباره امتحان کنید یا از «فراموشی کد» استفاده کنید`;
}

type SettingsRow = {
  role_code_supervisor: string | null;
  role_code_accountant: string | null;
  role_code_seller: string | null;
  role_reset_hash: string | null;
  role_reset_exp: string | Date | null;
};

/** Throw the Persian lockout message when the workspace is locked. */
export async function assertRoleNotLockedDb(sql: Sql, userId: string): Promise<void> {
  const rows = await sql<{ role_lock_until: string | Date | null }>`
    select role_lock_until from app_settings where user_id = ${userId}
  `;
  const until = rows[0]?.role_lock_until ? new Date(rows[0].role_lock_until) : null;
  if (until && until.getTime() > Date.now()) throw new Error(lockedMessage(until));
}

/**
 * Count one attempt, run `check`, and record the outcome. Throws `wrongMessage`
 * (or the lockout message) on failure.
 */
export async function attemptRoleSecret(
  sql: Sql,
  userId: string,
  check: (row: SettingsRow) => boolean | Promise<boolean>,
  wrongMessage: string,
): Promise<SettingsRow> {
  const reserved = await sql<SettingsRow & { role_fail_count: number }>`
    update app_settings set
      role_fail_count = case
        when role_fail_at is null or role_fail_at < now() - make_interval(mins => ${ROLE_FAIL_WINDOW_MIN}) then 1
        else role_fail_count + 1
      end,
      role_fail_at = now()
    where user_id = ${userId}
      and (role_lock_until is null or role_lock_until <= now())
      and (
        role_fail_count < ${ROLE_PIN_MAX_FAILS}
        or role_fail_at is null
        or role_fail_at < now() - make_interval(mins => ${ROLE_FAIL_WINDOW_MIN})
      )
    returning role_fail_count, role_code_supervisor, role_code_accountant, role_code_seller,
      role_reset_hash, role_reset_exp
  `;
  const row = reserved[0];
  if (!row) {
    const state = await sql<{ role_lock_until: string | Date | null }>`
      select role_lock_until from app_settings where user_id = ${userId}
    `;
    if (!state[0]) throw new Error(wrongMessage);
    const until = state[0].role_lock_until ? new Date(state[0].role_lock_until) : null;
    throw new Error(lockedMessage(until && until.getTime() > Date.now() ? until : new Date(Date.now() + 60_000)));
  }
  let ok = false;
  try {
    ok = await check(row);
  } catch {
    ok = false;
  }
  if (ok) {
    await sql`
      update app_settings set role_fail_count = 0, role_fail_at = null, role_lock_until = null, role_lock_level = 0
      where user_id = ${userId}
    `;
    return row;
  }
  if (Number(row.role_fail_count) >= ROLE_PIN_MAX_FAILS) {
    const locked = await sql<{ role_lock_until: string | Date }>`
      update app_settings set
        role_fail_count = 0,
        role_fail_at = null,
        role_lock_until = now() + make_interval(mins => least(${ROLE_LOCK_BASE_MIN} * power(2, role_lock_level)::int, ${ROLE_LOCK_MAX_MIN})),
        role_lock_level = role_lock_level + 1
      where user_id = ${userId}
      returning role_lock_until
    `;
    throw new Error(lockedMessage(new Date(locked[0]?.role_lock_until ?? Date.now() + 15 * 60_000)));
  }
  const left = ROLE_PIN_MAX_FAILS - Number(row.role_fail_count);
  throw new Error(`${wrongMessage} (${left} تلاش دیگر باقی است)`);
}

function storedCode(row: SettingsRow, role: Role): string {
  const v =
    role === "supervisor" ? row.role_code_supervisor : role === "accountant" ? row.role_code_accountant : row.role_code_seller;
  return (v ?? "").trim();
}

/** Check a role PIN with the persistent limiter; upgrades legacy plaintext to a hash. */
export async function verifyRolePin(
  sql: Sql,
  userId: string,
  role: Role,
  code: string,
  wrongMessage = "کد نقش نادرست است",
): Promise<void> {
  if (!ROLES.includes(role)) throw new Error("نقش نادرست است");
  const pin = (code ?? "").trim();
  let legacy: string | null = null;
  await attemptRoleSecret(
    sql,
    userId,
    (row) => {
      const stored = storedCode(row, role);
      if (!stored || !pin) return false;
      if (isHashedPin(stored)) return verifyPin(pin, stored);
      if (PUBLIC_DEFAULT_PINS.has(stored)) return false;
      const ok = legacyPlainMatches(pin, stored);
      if (ok) legacy = stored;
      return ok;
    },
    wrongMessage,
  );
  if (legacy !== null) {
    // One-time upgrade: from now on only the hash exists.
    await sql.query(
      `update app_settings set role_code_${role} = $1 where user_id = $2 and role_code_${role} = $3`,
      [hashPin(pin), userId, legacy],
    );
    await sql`
      update app_settings set role_codes_hashed = (
        (coalesce(role_code_supervisor, '') = '' or role_code_supervisor like 'scrypt$%')
        and (coalesce(role_code_accountant, '') = '' or role_code_accountant like 'scrypt$%')
        and (coalesce(role_code_seller, '') = '' or role_code_seller like 'scrypt$%')
      ) where user_id = ${userId}
    `;
  }
}

/** Accountant-code gate for destructive/settings actions. */
export async function verifyAccountantPin(sql: Sql, userId: string, code: string): Promise<void> {
  await verifyRolePin(sql, userId, "accountant", code, "کد نقش حسابدار نادرست است");
}
