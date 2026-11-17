import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Role } from "@/lib/types";
import type { SessionRoleSlot } from "@/lib/session-role-slot";

/**
 * SEC-04: v3 adds `pv`, the workspace role-PIN version at issue time.
 * authMiddleware drops the token when the stored version moved on (a PIN was
 * changed/reset). v1 (no expiry) and v2 (no version) tokens are no longer
 * accepted — holders simply enter their role PIN again.
 */
type Payload = { u: string; r: Role; n: string; v: 3; pv: number; exp: number };

const als = new AsyncLocalStorage<SessionRoleSlot | null>();
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const g = globalThis as typeof globalThis & {
  __hesabdarRoleAls?: AsyncLocalStorage<SessionRoleSlot | null>;
  __grokAuthPreviewSecret__?: string;
  __hesabdarRoleSecret__?: string;
};
g.__hesabdarRoleAls = als;

function secret(): string {
  const env = process.env.BETTER_AUTH_SECRET?.trim();
  if (env) return env;
  if (g.__grokAuthPreviewSecret__) return g.__grokAuthPreviewSecret__;
  g.__hesabdarRoleSecret__ ??= randomBytes(32).toString("hex");
  return g.__hesabdarRoleSecret__;
}

function isRole(value: unknown): value is Role {
  return value === "supervisor" || value === "accountant" || value === "seller";
}

function cleanName(name: string): string {
  let out = "";
  for (const ch of name) {
    if (ch.charCodeAt(0) < 32) continue;
    out += ch;
  }
  return out.trim().slice(0, 80);
}

export function signRoleToken(userId: string, role: Role, displayName: string, pinVersion: number): string {
  const payload: Payload = {
    u: userId,
    r: role,
    n: cleanName(displayName),
    v: 3,
    pv: Math.max(1, Math.floor(pinVersion) || 1),
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Verified token contents, including the PIN version it was issued for. */
export type RoleTokenClaims = SessionRoleSlot & { pinVersion: number };

export function readRoleToken(token: string | null | undefined, userId: string): RoleTokenClaims | null {
  if (!token || !userId) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!body || !sig || token.indexOf(".", dot + 1) !== -1) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Payload> & { v?: number };
    // SEC-04: only v3 (expiring + PIN-versioned) tokens are valid.
    if (parsed.v !== 3 || parsed.u !== userId || !isRole(parsed.r)) return null;
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    if (typeof parsed.pv !== "number" || !Number.isFinite(parsed.pv)) return null;
    return {
      role: parsed.r,
      displayName: cleanName(typeof parsed.n === "string" ? parsed.n : ""),
      pinVersion: parsed.pv,
    };
  } catch {
    return null;
  }
}

/** SEC-04: the role slot only while the token's PIN version is still current. */
export function slotIfCurrent(claims: RoleTokenClaims | null, currentVersion: number): SessionRoleSlot | null {
  if (!claims || claims.pinVersion !== currentVersion) return null;
  return { role: claims.role, displayName: claims.displayName };
}

export async function setRoleCookie(token: string): Promise<void> {
  try {
    const { setCookie } = await import("@tanstack/react-start/server");
    setCookie("hesabdar_role", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(TOKEN_TTL_MS / 1000),
      secure: true,
    });
  } catch {
    /* preview / non-request context */
  }
}

export async function clearRoleCookie(): Promise<void> {
  try {
    const { setCookie } = await import("@tanstack/react-start/server");
    setCookie("hesabdar_role", "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      secure: true,
    });
  } catch {
    /* ignore */
  }
}

export function bindSessionRole<T>(slot: SessionRoleSlot | null, fn: () => T): T {
  return als.run(slot, fn);
}

export const ROLE_TOKEN_TTL_MS = TOKEN_TTL_MS;
