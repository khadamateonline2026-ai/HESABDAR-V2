import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seedUser } from "@/lib/testing/pglite-db";
import { assertPartyDeletable, isForeignKeyViolation, partyArea, storedPartyArea } from "./party-history";

async function partyWithReceipt(sql: Awaited<ReturnType<typeof createTestDb>>["sql"], userId: string) {
  const { afnId, accountId } = await seedUser(sql, userId);
  const p = await sql<{ id: number }>`insert into parties (user_id, kind, name) values (${userId}, ${"customer"}, ${"احمد"}) returning id`;
  await sql`
    insert into party_payments (user_id, party_id, kind, amount, currency_id, account_id, receipt_no, occurred_on)
    values (${userId}, ${p[0].id}, ${"receipt"}, ${500}, ${afnId}, ${accountId}, ${"ق-1"}, ${"2026-01-01"})
  `;
  return p[0].id;
}

test("SEC-07 bug (schema before 0027): deleting a contact cascade-deleted its receipts", async () => {
  const db = await createTestDb({ upTo: "0026_security_v2.sql" });
  const id = await partyWithReceipt(db.sql, "u1");
  await db.sql`delete from parties where id = ${id}`;
  const left = await db.sql`select * from party_payments where user_id = 'u1'`;
  assert.equal(left.length, 0, "old schema silently erased the receipt");
  await db.close();
});

test("SEC-07 fix: database refuses to delete a contact that has receipts; receipt survives", async () => {
  const db = await createTestDb();
  const id = await partyWithReceipt(db.sql, "u1");
  await assert.rejects(db.sql`delete from parties where id = ${id}`, (e) => isForeignKeyViolation(e));
  const left = await db.sql`select * from party_payments where user_id = 'u1'`;
  assert.equal(left.length, 1);
  await db.close();
});

test("SEC-07 fix: worker payments are protected the same way", async () => {
  const db = await createTestDb();
  await seedUser(db.sql, "u1");
  const w = await db.sql<{ id: number }>`insert into parties (user_id, kind, name) values ('u1', 'worker', 'کریم') returning id`;
  await db.sql`insert into worker_payments (user_id, worker_id, amount, occurred_on, invoice_no) values ('u1', ${w[0].id}, 100, '2026-01-01', 'WP-1')`;
  await assert.rejects(db.sql`delete from parties where id = ${w[0].id}`, (e) => isForeignKeyViolation(e));
  await db.close();
});

test("SEC-07 fix: app gives a clear Persian error listing the history", async () => {
  const db = await createTestDb();
  const id = await partyWithReceipt(db.sql, "u1");
  await assert.rejects(assertPartyDeletable(db.sql, "u1", id), /«احمد» قابل حذف نیست.*1 رسید یا پرداخت/);
  await db.close();
});

test("SEC-07 fix: a contact without history can still be deleted", async () => {
  const db = await createTestDb();
  await seedUser(db.sql, "u1");
  const p = await db.sql<{ id: number }>`insert into parties (user_id, kind, name) values ('u1', 'vendor', 'تازه') returning id`;
  await assertPartyDeletable(db.sql, "u1", p[0].id);
  await db.sql`delete from parties where id = ${p[0].id}`;
  await db.close();
});

test("SEC-07 fix: another tenant's contact is 'not found', never deletable", async () => {
  const db = await createTestDb();
  await seedUser(db.sql, "u2");
  const p = await db.sql<{ id: number }>`insert into parties (user_id, kind, name) values ('u2', 'vendor', 'x') returning id`;
  await assert.rejects(assertPartyDeletable(db.sql, "u1", p[0].id), /یافت نشد/);
  await db.close();
});

test("SEC-07 fix: permission area comes from the stored kind, not the client's claim", async () => {
  const db = await createTestDb();
  await seedUser(db.sql, "u1");
  const p = await db.sql<{ id: number }>`insert into parties (user_id, kind, name) values ('u1', 'other', 'شریک') returning id`;
  // Client would claim "customer" (area "sales", which a seller may write).
  assert.equal(partyArea("customer"), "sales");
  assert.equal(await storedPartyArea(db.sql, "u1", p[0].id), "parties");
  await db.close();
});
