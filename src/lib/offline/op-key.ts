/** STR-04: header carrying the client-generated idempotency key of a queued write. */
export const OFFLINE_OP_HEADER = "x-hesabdar-op";

const OP_KEY = /^[A-Za-z0-9-]{16,64}$/;

export function isOpKey(v: unknown): v is string {
  return typeof v === "string" && OP_KEY.test(v);
}

export function newOpKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
