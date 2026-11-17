import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, ensureRuntimeColumns, seedUser, applyMigrations } from "@/lib/testing/pglite-db";
import { syncLinkedPayment } from "./linked-payment";
import { loadCatalogs } from "./helpers";

async function purchaseInvoice(sql: Awaited<ReturnType<typeof createTestDb>>["sql"], userId: string, ids: { afnId: number; accountId: number }, vendorId: number | null, paid: number) {
  const rows = await sql<{ id: number }>`
    insert into purchase_invoices (user_id, vendor_id, invoice_no, occurred_on, currency_id, fx_enabled, fx_rate, paid_amount, account_id, notes, receive_status)
    values (${userId}, ${vendorId}, ${"B-1"}, ${"2026-01-01"}, ${ids.afnId}, ${false}, ${1}, ${paid}, ${ids.accountId}, ${""}, ${"arrived"})
    returning id
  `;
  return rows[0].id;
}

const balance = async (sql: Awaited<ReturnType<typeof createTestDb>>["sql"], userId: string) =>
  (await loadCatalogs(sql, userId)).accounts[0].balance;

test("ACC-05 bug: a paid purchase without a vendor did not reduce the cashbox", async () => {
  // Reproduce the old schema: party_id NOT NULL meant no linked row could exist.
  const db = await createTestDb({ upTo: "0027_party_history_restrict.sql" });
  await ensureRuntimeColumns(db.sql);
  const ids = await seedUser(db.sql, "u1");
  await db.sql`update accounts set opening_balance = 1000 where id = ${ids.accountId}`;
  await purchaseInvoice(db.sql, "u1", ids, null, 300);
  // Old state: no cash movement row exists for the paid invoice, so the till never dropped.
  const rows = await db.sql<{ n: number }>`select count(*)::int as n from party_payments`;
  assert.equal(Number(rows[0].n), 0, "old: paid 300 but no cash movement recorded");
  // Migration 0028 backfills the missing cash movement for existing invoices.
  await applyMigrations(db.pg);
  assert.equal(await balance(db.sql, "u1"), 700);
  await db.close();
});

test("ACC-05 fix: saving a paid purchase without a vendor moves cash out of the account", async () => {
  const db = await createTestDb();
  await ensureRuntimeColumns(db.sql);
  const ids = await seedUser(db.sql, "u1");
  await db.sql`update accounts set opening_balance = 1000 where id = ${ids.accountId}`;
  const invId = await purchaseInvoice(db.sql, "u1", ids, null, 300);
  await syncLinkedPayment(db.sql, {
    userId: "u1", kind: "payment", partyId: null, amount: 300, currencyId: ids.afnId,
    accountId: ids.accountId, occurredOn: "2026-01-01", purchaseInvoiceId: invId, label: "پرداخت فاکتور B-1",
  });
  assert.equal(await balance(db.sql, "u1"), 700);
  // Editing the amount updates the same row (no duplicate), zero removes it.
  await syncLinkedPayment(db.sql, {
    userId: "u1", kind: "payment", partyId: null, amount: 100, currencyId: ids.afnId,
    accountId: ids.accountId, occurredOn: "2026-01-01", purchaseInvoiceId: invId, label: "x",
  });
  assert.equal(await balance(db.sql, "u1"), 900);
  await syncLinkedPayment(db.sql, {
    userId: "u1", kind: "payment", partyId: null, amount: 0, currencyId: ids.afnId,
    accountId: ids.accountId, occurredOn: "2026-01-01", purchaseInvoiceId: invId, label: "x",
  });
  assert.equal(await balance(db.sql, "u1"), 1000);
  await db.close();
});

test("ACC-05 fix: adding a vendor later moves the same payment to that vendor", async () => {
  const db = await createTestDb();
  await ensureRuntimeColumns(db.sql);
  const ids = await seedUser(db.sql, "u1");
  const v = await db.sql<{ id: number }>`insert into parties (user_id, kind, name) values ('u1', 'vendor', 'کریم') returning id`;
  const invId = await purchaseInvoice(db.sql, "u1", ids, null, 50);
  const base = { userId: "u1", kind: "payment" as const, amount: 50, currencyId: ids.afnId, accountId: ids.accountId, occurredOn: "2026-01-01", purchaseInvoiceId: invId, label: "x" };
  await syncLinkedPayment(db.sql, { ...base, partyId: null });
  await syncLinkedPayment(db.sql, { ...base, partyId: v[0].id });
  const rows = await db.sql<{ party_id: number | null }>`select party_id from party_payments where purchase_invoice_id = ${invId}`;
  assert.deepEqual(rows.map((r) => r.party_id), [v[0].id]);
  await db.close();
});
