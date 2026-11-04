import type { Role } from "@/lib/types";

export type SessionRoleSlot = { role: Role; displayName: string };

type RoleAls = {
  getStore: () => SessionRoleSlot | null | undefined;
};

function isRole(value: unknown): value is Role {
  return value === "supervisor" || value === "accountant" || value === "seller";
}

/** Role bound to this request only. Set by the server middleware; absent in the browser. */
export function peekSessionRole(): SessionRoleSlot | null {
  const als = (globalThis as { __hesabdarRoleAls?: RoleAls }).__hesabdarRoleAls;
  const slot = als?.getStore?.() ?? null;
  if (!slot || !isRole(slot.role)) return null;
  const displayName = typeof slot.displayName === "string" ? slot.displayName : "";
  return { role: slot.role, displayName };
}
