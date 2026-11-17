import type { Sql } from "@/lib/db";
import type { Area } from "@/lib/permissions";

/**
 * SEC-07 — contacts (customers / vendors / workers / others).
 *
 * 1. Permission for an existing contact comes from the kind STORED on the row,
 *    never from the kind the client sends (a seller could otherwise edit or
 *    delete an "other" contact by claiming it is a customer).
 * 2. A contact with any financial history cannot be deleted: deleting it used
 *    to cascade-delete its receipts/payments (party_payments, worker_payments)
 *    while invoices stayed, silently changing cash balances. Migration 0027
 *    makes the database refuse too (ON DELETE RESTRICT) as a second line.
 */
export const PARTY_KINDS = ["customer", "vendor", "worker", "other"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

export function isPartyKind(value: unknown): value is PartyKind {
  return typeof value === "string" && (PARTY_KINDS as readonly string[]).includes(value);
}

export function partyArea(kind: PartyKind): Area {
  if (kind === "worker") return "workers";
  if (kind === "customer") return "sales";
  if (kind === "vendor") return "purchase";
  return "parties";
}

export async function storedParty(
  sql: Sql,
  userId: string,
  id: number,
): Promise<{ id: number; kind: PartyKind; name: string } | null> {
  const rows = await sql<{ id: number; kind: string; name: string }>`
    select id, kind, name from parties where id = ${id} and user_id = ${userId}
  `;
  const row = rows[0];
  if (!row) return null;
  return { id: Number(row.id), kind: isPartyKind(row.kind) ? row.kind : "other", name: String(row.name ?? "") };
}

/** Write area for an existing contact, from its stored kind. Throws if missing. */
export async function storedPartyArea(sql: Sql, userId: string, id: number): Promise<Area> {
  const party = await storedParty(sql, userId, id);
  if (!party) throw new Error("طرف حساب یافت نشد");
  return partyArea(party.kind);
}

const HISTORY: { table: string; column: string; label: string }[] = [
  { table: "sale_invoices", column: "customer_id", label: "فاکتور فروش" },
  { table: "sales", column: "customer_id", label: "ردیف فروش" },
  { table: "purchase_invoices", column: "vendor_id", label: "فاکتور خرید" },
  { table: "purchases", column: "vendor_id", label: "ردیف خرید" },
  { table: "party_payments", column: "party_id", label: "رسید یا پرداخت" },
  { table: "worker_payments", column: "worker_id", label: "پرداخت کارگر" },
  { table: "work_orders", column: "worker_id", label: "سفارش کار" },
  { table: "work_deliveries", column: "to_worker_id", label: "تحویل کار" },
  { table: "expenses", column: "party_id", label: "هزینه" },
];

export async function partyHistory(
  sql: Sql,
  userId: string,
  id: number,
): Promise<{ label: string; count: number }[]> {
  const out: { label: string; count: number }[] = [];
  for (const h of HISTORY) {
    // Table/column names are constants above, never user input.
    const rows = await sql.query<{ n: number | string }>(
      `select count(*) as n from ${h.table} where user_id = $1 and ${h.column} = $2`,
      [userId, id],
    );
    const n = Number(rows[0]?.n ?? 0);
    if (n > 0) out.push({ label: h.label, count: n });
  }
  return out;
}

export function partyHistoryMessage(name: string, history: { label: string; count: number }[]): string {
  const list = history.map((h) => `${h.count} ${h.label}`).join("، ");
  return `«${name}» قابل حذف نیست، چون سابقه مالی دارد (${list}). حذف او رسیدها و پرداخت‌ها را پاک می‌کرد و مانده حساب‌ها را خراب می‌کرد.`;
}

/** Throws a clear Persian error when the contact has any financial history. */
export async function assertPartyDeletable(sql: Sql, userId: string, id: number): Promise<void> {
  const party = await storedParty(sql, userId, id);
  if (!party) throw new Error("طرف حساب یافت نشد");
  const history = await partyHistory(sql, userId, id);
  if (history.length) throw new Error(partyHistoryMessage(party.name, history));
}

/** Postgres foreign_key_violation → friendly message (DB-level safety net). */
export function isForeignKeyViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: string }).code;
  return code === "23503" || /foreign key/i.test(String((err as { message?: string }).message ?? ""));
}
