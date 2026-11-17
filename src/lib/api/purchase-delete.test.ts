import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seedUser } from "@/lib/testing/pglite-db";
import { deletePurchaseInvoiceTx } from "./invoices";

const U = "user-pdel";

async function setup(sold: number) {
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, U));
  const item = await db.sql<{ id: number }>`insert into items (user_id, name, kind) values (${U}, ${"پارچه"}, ${"raw"}) returning id`;
  const inv = await db.sql<{ id: number }>`
    insert into purchase_invoices (user_id, invoice_no, currency_id, occurred_on) values (${U}, ${"B1"}, ${ids.afnId}, ${"2026-01-01"}) returning id
  `;
  await db.sql`
    insert into purchases (user_id, invoice_id, item_id, item_name, quantity, received_qty, unit_price, currency_id, occurred_on, status)
    values (${U}, ${inv[0].id}, ${item[0].id}, ${"پارچه"}, ${10}, ${10}, ${5}, ${ids.afnId}, ${"2026-01-01"}, ${"final"})
  `;
  if (sold > 0) {
    await db.sql`
      insert into sales (user_id, item_id, item_name, quantity, unit_price, currency_id, occurred_on, status)
      values (${U}, ${item[0].id}, ${"پارچه"}, ${sold}, ${9}, ${ids.afnId}, ${"2026-01-02"}, ${"final"})
    `;
  }
  return { db, invoiceId: inv[0].id };
}

test("ACC-11 bug: a purchase whose goods were already sold could be deleted", async () => {
  const { db, invoiceId } = await setup(6);
  await assert.rejects(db.tx((tx) => deletePurchaseInvoiceTx(tx, U, invoiceId)), /فروخته یا در تولید مصرف شده/);
  const left = await db.sql<{ n: number }>`select count(*)::int as n from purchases where invoice_id = ${invoiceId}`;
  assert.equal(left[0].n, 1);
  await db.close();
});

test("ACC-11: a purchase whose goods are all still in stock can be deleted", async () => {
  const { db, invoiceId } = await setup(0);
  await db.tx((tx) => deletePurchaseInvoiceTx(tx, U, invoiceId));
  const left = await db.sql<{ n: number }>`select count(*)::int as n from purchase_invoices where id = ${invoiceId}`;
  assert.equal(left[0].n, 0);
  await db.close();
});
