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
const SELLER_VIEW: Area[] = [
  "dashboard",
  "parties",
  "workers",
  "wages",
  "jobs",
  "purchase",
  "sales",
  "expenses",
  "payments",
  "warehouses",
  "notes",
  "reports",
];

export function canView(role: Role | null | undefined, area: Area): boolean {
  if (!role) return false;
  if (role === "accountant" || role === "supervisor") return true;
  return SELLER_VIEW.includes(area);
}

export function canWrite(role: Role | null | undefined, area: Area): boolean {
  if (!role) return false;
  if (role === "supervisor") return false;
  if (role === "accountant") return true;
  return SELLER_WRITE.includes(area);
}

export function writeError(role: Role): string {
  if (role === "supervisor") return "ناظر اجازه ثبت، ویرایش یا حذف ندارد";
  return "شما به این بخش دسترسی ندارید";
}
