/**
 * Role token for this browser tab.
 * Prefer httpOnly cookie set by the server (read only on the server).
 * Client keeps an in-memory copy for live-preview bearer forwarding — never localStorage.
 */
const KEY = "hesabdar-role-token";
const COOKIE = "hesabdar_role";
const LEGACY_KEY = "dftar-role-session";
/** 12 hours — matches server token exp */
const MAX_AGE_SEC = 12 * 60 * 60;

let memory: string | null = null;

function clearLegacyStores() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
    window.sessionStorage.removeItem(KEY);
    window.localStorage.removeItem(LEGACY_KEY);
    window.sessionStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
  try {
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE}=; path=/; max-age=0; SameSite=Lax${secure}`;
    document.cookie = `${LEGACY_KEY}=; path=/; max-age=0`;
  } catch {
    /* ignore */
  }
}

export function getRoleToken(): string | null {
  if (typeof window === "undefined") return null;
  return memory;
}

export function setRoleToken(token: string) {
  memory = token;
  clearLegacyStores();
  // Non-httpOnly fallback for environments where Set-Cookie from server fn is unavailable.
  // Shorter max-age; prefer server httpOnly cookie when present.
  if (typeof document !== "undefined") {
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${MAX_AGE_SEC}; SameSite=Lax${secure}`;
  }
}

export function clearRoleToken() {
  memory = null;
  clearLegacyStores();
}

export const ROLE_TOKEN_MAX_AGE_SEC = MAX_AGE_SEC;
