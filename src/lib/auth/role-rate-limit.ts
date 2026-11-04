type Entry = { fails: number; lockedUntil: number };

const store = new Map<string, Entry>();

const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

export function assertRoleNotLocked(userId: string): void {
  const entry = store.get(userId);
  if (!entry) return;
  if (entry.lockedUntil > Date.now()) {
    const mins = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    throw new Error(`تلاش‌های ناموفق زیاد بود. حدود ${mins} دقیقه دیگر دوباره امتحان کنید`);
  }
}

export function recordRoleFail(userId: string): void {
  const now = Date.now();
  const prev = store.get(userId);
  if (!prev || now - (prev.lockedUntil || 0) > WINDOW_MS && prev.fails === 0) {
    store.set(userId, { fails: 1, lockedUntil: 0 });
    return;
  }
  const fails = (prev?.fails ?? 0) + 1;
  const lockedUntil = fails >= MAX_FAILS ? now + LOCK_MS : 0;
  store.set(userId, { fails, lockedUntil });
  if (lockedUntil) {
    throw new Error("به‌خاطر تلاش‌های ناموفق، تغییر نقش برای ۱۵ دقیقه قفل شد");
  }
}

export function recordRoleSuccess(userId: string): void {
  store.delete(userId);
}

/** Test helper */
export function _resetRoleRateLimitForTests(): void {
  store.clear();
}
