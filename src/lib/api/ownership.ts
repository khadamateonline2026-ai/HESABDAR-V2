/**
 * SEC-01: every id that comes from the client must belong to the caller's
 * workspace before it is read or written. Use `assertOwned` at the top of a
 * handler (before the first write); migration 0031 enforces the same rule in
 * the database for every insert/update as a safety net.
 */
import type { Sql } from "@/lib/db";

/** Workspace tables that may be referenced by id, with a Persian label. */
export const OWNED_TABLES = {
  accounts: "حساب",
  currencies: "واحد پول",
  parties: "طرف حساب",
  items: "کالا",
  units: "واحد",
  warehouses: "گدام",
  item_categories: "دسته کالا",
  item_types: "نوع کالا",
  party_categories: "دسته طرف حساب",
  expense_categories: "دسته هزینه",
  job_types: "نوع کار",
  production_stages: "مرحله تولید",
  sale_invoices: "فاکتور فروش",
  purchase_invoices: "فاکتور خرید",
  work_orders: "سفارش تولید",
  work_deliveries: "تحویل",
  recurring_expenses: "هزینه تکراری",
  expenses: "هزینه",
  party_payments: "دریافت/پرداخت",
  transfers: "انتقال",
  worker_payments: "پرداخت کارگر",
  staff_users: "کاربر",
} as const;

export type OwnedTable = keyof typeof OWNED_TABLES;
export type OwnedRef = readonly [OwnedTable, number | null | undefined];

export function ownershipMessage(table: OwnedTable): string {
  return `${OWNED_TABLES[table]} انتخاب‌شده یافت نشد یا به این حساب تعلق ندارد`;
}

/**
 * Throws (Persian) unless every non-empty id exists in its table with
 * `user_id = userId`. One query per table; null/undefined/0 ids are skipped
 * (optional references).
 */
export async function assertOwned(sql: Sql, userId: string, refs: readonly OwnedRef[]): Promise<void> {
  const byTable = new Map<OwnedTable, Set<number>>();
  for (const [table, id] of refs) {
    if (!(table in OWNED_TABLES)) throw new Error("جدول نامعتبر");
    if (id == null || id === 0) continue;
    if (!Number.isInteger(id) || id < 0) throw new Error(ownershipMessage(table));
    const set = byTable.get(table) ?? new Set<number>();
    set.add(id);
    byTable.set(table, set);
  }
  for (const [table, ids] of byTable) {
    const list = [...ids];
    const rows = await sql.query<{ n: number }>(
      `select count(*)::int as n from ${table} where user_id = $1 and id = any($2::bigint[])`,
      [userId, list],
    );
    if (Number(rows[0]?.n ?? 0) !== list.length) throw new Error(ownershipMessage(table));
  }
}

/** Convenience for a single id. */
export async function assertOwnedId(sql: Sql, userId: string, table: OwnedTable, id: number | null | undefined) {
  await assertOwned(sql, userId, [[table, id]]);
}
