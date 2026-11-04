import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Format: scrypt$N$r$p$saltHex$hashHex */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const PREFIX = "scrypt$";

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEYLEN, { N, r: R, p: P });
  return `${PREFIX}${N}$${R}$${P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function isHashedPin(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function verifyPin(pin: string, stored: string): boolean {
  if (!stored) return false;
  if (!isHashedPin(stored)) {
    // Legacy plaintext (should not exist in V2 new installs). Constant-time-ish compare.
    const a = Buffer.from(pin);
    const b = Buffer.from(stored);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? "", "hex");
  const expected = Buffer.from(parts[5] ?? "", "hex");
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p) || salt.length === 0 || expected.length === 0) {
    return false;
  }
  const actual = scryptSync(pin, salt, expected.length, { N: n, r, p });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function assertPinShape(pin: string): void {
  const trimmed = pin.trim();
  if (trimmed.length < 4) throw new Error("رمز هر نقش حداقل ۴ رقم باشد");
  if (trimmed.length > 32) throw new Error("رمز نقش بیش از حد طولانی است");
}
