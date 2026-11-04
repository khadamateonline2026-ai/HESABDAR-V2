import type { Role } from "./types";

export type Area =
  | "company"
  | "parties"
  | "workers"
  | "wages"
  | "jobs"
  | "currencies"
  | "units"
  | "accounts"
  | "transfers"
  | "capital"
  | "opening"
  | "purchase"
  | "sales"
  | "expenses"
  | "payments"
  | "warehouses"
  | "reports"
  | "notes"
  | "settings"
  | "dashboard";

const SELLER_WRITE: Area[] = ["workers", "purchase", "sales", "expenses", "payments", "warehouses"];

/** Match original: any authenticated role may view every app area. */
export function canView(role: Role | null | undefined, _area: Area): boolean {
  if (!role) return false;
  return true;
}

export function canWrite(role: Role | null | undefined, area: Area): boolean {
  if (!role) return false;
  if (role === "supervisor") return false;
  if (role === "accountant") return true;
  return SELLER_WRITE.includes(area);
}

/**
 * Role-code (PIN) settings tab: seller never sees it.
 * Supervisor may view the section (values are never sent in plain — hashes blanked client-side).
 * Accountant may view and manage.
 */
export function canViewRoleCodes(role: Role | null | undefined): boolean {
  return role === "accountant" || role === "supervisor";
}

/** Only accountant may set / change role PIN hashes. */
export function canManageRoleCodes(role: Role | null | undefined): boolean {
  return role === "accountant";
}

export function writeError(role: Role): string {
  if (role === "supervisor") return "ناظر اجازه ثبت، ویرایش یا حذف ندارد";
  return "شما به این بخش دسترسی ندارید";
}
