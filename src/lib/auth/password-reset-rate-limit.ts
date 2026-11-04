type Entry = { count: number; windowStart: number };

const store = new Map<string, Entry>();

const MAX_REQUESTS = 3;
const WINDOW_MS = 60 * 60 * 1000;

function keyOf(email: string): string {
  return email.trim().toLowerCase();
}

/** Throws a Persian rate-limit error when the email has too many recent reset requests. */
export function assertPasswordResetAllowed(email: string): void {
  const key = keyOf(email);
  if (!key) return;
  const now = Date.now();
  const prev = store.get(key);
  if (!prev || now - prev.windowStart >= WINDOW_MS) {
    store.set(key, { count: 0, windowStart: now });
    return;
  }
  if (prev.count >= MAX_REQUESTS) {
    throw new Error("درخواست‌های بازنشانی زیاد بود. حدود یک ساعت دیگر دوباره امتحان کنید");
  }
}

export function recordPasswordResetRequest(email: string): void {
  const key = keyOf(email);
  if (!key) return;
  const now = Date.now();
  const prev = store.get(key);
  if (!prev || now - prev.windowStart >= WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
    return;
  }
  store.set(key, { count: prev.count + 1, windowStart: prev.windowStart });
}

/** Test helper */
export function _resetPasswordResetRateLimitForTests(): void {
  store.clear();
}
