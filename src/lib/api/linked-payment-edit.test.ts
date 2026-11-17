import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, ensureRuntimeColumns, seedUser, type TestDb } from "@/lib/testing/pglite-db";
import { deleteLinkedPayment, loadLinkedPayment, syncLinkedPayment, updateLinkedPayment } from "./linked-payment";
import { loadCatalogs } from "./helpers";

async function setup() {
  const db = await createTestDb();
  await ensureRuntimeColumns(db.sql);
  const ids = await seedUser(db.sql, "u1");
  await db.sql`update accounts set opening_balance = 1000 where id = ${ids.accountId}`;
  const v = await db.sql<{ id: number }>`insert into parties (user_id, kind, name) values ('u1', 'vendor', 'کریم') returning id`;
  const c = await db.sql<{ id: number }>`insert into parties (user_id, kind, name) values ('u1', 'customer', 'احمد') returning id`;
  return { db, ids, vendorId: v[0].id, customerId: c[0].id };
}

async function paidPurchase(db: TestDb, ids: { afnId: number; accountId: number }, vendorId: number, paid: number) {
  const inv = await db.sql<{ id: number }>`
    insert into purchase_invoices (user_id, vendor_id, invoice_no, occurred_on, currency_id, fx_enabled, fx_rate, paid_amount, account_id, notes, receive_status)
    values ('u1', ${vendorId}, 'B-1', '2026-01-01', ${ids.afnId}, false, 1, ${paid}, ${ids.accountId}, '', 'arrived') returning id
  `;
  await syncLinkedPayment(db.sql, {
    userId: "u1", kind: "payment", partyId: vendorId, amount: paid, currencyId: ids.afnId,
    accountId: ids.accountId, occurredOn: "2026-01-01", purchaseInvoiceId: inv[0].id, label: "پرداخت فاکتور B-1",
  });
  const pay = await db.sql<{ id: number }>`select id from party_payments where purchase_invoice_id = ${inv[0].id}`;
  return { invoiceId: inv[0].id, paymentId: pay[0].id };
}

async function paidSale(db: TestDb, ids: { afnId: number; accountId: number }, customerId: number, received: number) {
  const inv = await db.sql<{ id: number }>`
    insert into sale_invoices (user_id, customer_id, invoice_no, occurred_on, currency_id, fx_enabled, fx_rate, received_amount, account_id, notes, kind)
    values ('u1', ${customerId}, 'S-1', '2026-01-01', ${ids.afnId}, false, 1, ${received}, ${ids.accountId}, '', 'shop') returning id
  `;
  await syncLinkedPayment(db.sql, {
    userId: "u1", kind: "receipt", partyId: customerId, amount: received, currencyId: ids.afnId, fxRate: 1,
    accountId: ids.accountId, occurredOn: "2026-01-01", saleInvoiceId: inv[0].id, label: "دریافت فاکتور S-1",
  });
  const pay = await db.sql<{ id: number }>`select id from party_payments where sale_invoice_id = ${inv[0].id}`;
  return { invoiceId: inv[0].id, paymentId: pay[0].id };
}

const purchasePaid = async (db: TestDb, id: number) =>
  Number((await db.sql<{ p: string }>`select paid_amount as p from purchase_invoices where id = ${id}`)[0].p);
const saleReceived = async (db: TestDb, id: number) =>
  Number((await db.sql<{ r: string }>`select received_amount as r from sale_invoices where id = ${id}`)[0].r);
const cash = async (db: TestDb) => (await loadCatalogs(db.sql, "u1")).accounts[0].balance;

test("ACC-03 bug: deleting only the payment row left the invoice 'paid' while the cash came back", async () => {
  const { db, ids, vendorId } = await setup();
  const { invoiceId, paymentId } = await paidPurchase(db, ids, vendorId, 300);
  await db.sql`delete from party_payments where id = ${paymentId}`; // what the old delete did
  assert.equal(await purchasePaid(db, invoiceId), 300, "header still says paid 300");
  assert.equal(await cash(db), 1000, "but the cash movement is gone");
  await db.close();
});

test("ACC-03 fix: deleting a purchase payment un-pays the invoice in the same transaction", async () => {
  const { db, ids, vendorId } = await setup();
  const { invoiceId, paymentId } = await paidPurchase(db, ids, vendorId, 300);
  const linked = (await loadLinkedPayment(db.sql, "u1", paymentId))!;
  await db.tx((tx) => deleteLinkedPayment(tx, "u1", linked));
  assert.equal(await purchasePaid(db, invoiceId), 0);
  assert.equal(await cash(db), 1000);
  await db.close();
});

test("ACC-03 fix: editing a purchase payment amount updates the invoice header too", async () => {
  const { db, ids, vendorId } = await setup();
  const { invoiceId, paymentId } = await paidPurchase(db, ids, vendorId, 300);
  const linked = (await loadLinkedPayment(db.sql, "u1", paymentId))!;
  await db.tx((tx) =>
    updateLinkedPayment(tx, "u1", linked, {
      partyId: vendorId, kind: "payment", amount: 120, currencyId: ids.afnId, fxRate: 1,
      accountId: ids.accountId, occurredOn: "2026-01-02", notes: "اصلاح",
    }),
  );
  assert.equal(await purchasePaid(db, invoiceId), 120);
  assert.equal(await cash(db), 880);
  await db.close();
});

test("ACC-03 fix: contact or currency of an invoice payment can only change on the invoice", async () => {
  const { db, ids, vendorId, customerId } = await setup();
  const { paymentId } = await paidPurchase(db, ids, vendorId, 300);
  const linked = (await loadLinkedPayment(db.sql, "u1", paymentId))!;
  const edit = { partyId: vendorId, kind: "payment" as const, amount: 300, currencyId: ids.afnId, fxRate: 1, accountId: ids.accountId, occurredOn: "2026-01-01", notes: "" };
  await assert.rejects(db.tx((tx) => updateLinkedPayment(tx, "u1", linked, { ...edit, partyId: customerId })), /خود فاکتور/);
  await assert.rejects(db.tx((tx) => updateLinkedPayment(tx, "u1", linked, { ...edit, currencyId: ids.usdId, fxRate: 70 })), /خود فاکتور/);
  await db.close();
});

test("ACC-03 fix: deleting / editing a sale receipt keeps the sale header in step", async () => {
  const { db, ids, customerId } = await setup();
  const { invoiceId, paymentId } = await paidSale(db, ids, customerId, 400);
  assert.equal(await cash(db), 1400);
  const linked = (await loadLinkedPayment(db.sql, "u1", paymentId))!;
  await db.tx((tx) =>
    updateLinkedPayment(tx, "u1", linked, {
      partyId: customerId, kind: "receipt", amount: 250, currencyId: ids.afnId, fxRate: 1,
      accountId: ids.accountId, occurredOn: "2026-01-01", notes: "",
    }),
  );
  assert.equal(await saleReceived(db, invoiceId), 250);
  assert.equal(await cash(db), 1250);
  await db.tx((tx) => deleteLinkedPayment(tx, "u1", linked));
  assert.equal(await saleReceived(db, invoiceId), 0);
  assert.equal(await cash(db), 1000);
  await db.close();
});

test("ACC-03 fix: a sale receipt tied to a refund must be changed on the invoice", async () => {
  const { db, ids, customerId } = await setup();
  const { invoiceId, paymentId } = await paidSale(db, ids, customerId, 400);
  await db.sql`update sale_invoices set refund_amount = 50 where id = ${invoiceId}`;
  const linked = (await loadLinkedPayment(db.sql, "u1", paymentId))!;
  await assert.rejects(db.tx((tx) => deleteLinkedPayment(tx, "u1", linked)), /بازپرداخت/);
  assert.equal(await saleReceived(db, invoiceId), 400);
  await db.close();
});

test("ACC-03: ordinary (non-invoice) payments are not treated as linked", async () => {
  const { db, ids, vendorId } = await setup();
  const p = await db.sql<{ id: number }>`
    insert into party_payments (user_id, party_id, kind, amount, currency_id, account_id, receipt_no, occurred_on)
    values ('u1', ${vendorId}, 'payment', 10, ${ids.afnId}, ${ids.accountId}, 'ق-9', '2026-01-01') returning id
  `;
  assert.equal(await loadLinkedPayment(db.sql, "u1", p[0].id), null);
  await db.close();
});
