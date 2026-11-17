import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seedUser } from "@/lib/testing/pglite-db";
import { receivePurchaseInvoiceTx, savePurchaseInvoiceTx } from "./invoices";

const U = "user-rcpt";

async function setup() {
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, U));
  const item = await db.sql<{ id: number }>`insert into items (user_id, name, kind) values (${U}, ${"دکمه"}, ${"raw"}) returning id`;
  const base = {
    vendorId: null,
    occurredOn: "2026-01-01",
    expectedOn: "",
    currencyId: ids.afnId,
    fxEnabled: false,
    fxRate: 1,
    paidAmount: 0,
    accountId: ids.accountId,
    notes: "",
  };
  const line = { itemId: item[0].id, itemName: "دکمه", quantity: 10, unitId: null, unitPrice: 5 };
  const saved = await db.tx((sql) => savePurchaseInvoiceTx(sql, U, { ...base, lines: [line] }));
  const lineId = (await db.sql<{ id: number }>`select id from purchases where invoice_id = ${saved.id}`)[0].id;
  return { db, ids, base, line, invoiceId: saved.id, lineId, itemId: item[0].id };
}

test("ACC-09 bug: a second partial receipt overwrote the first one's warehouse", async () => {
  const { db, invoiceId, lineId } = await setup();
  const recv = (wh: string, qty: number) =>
    db.tx((sql) =>
      receivePurchaseInvoiceTx(sql, U, {
        id: invoiceId,
        warehouseName: wh,
        categoryId: null,
        mode: "partial",
        lines: [{ id: lineId, receivedQty: qty, notes: "" }],
      }),
    );
  await recv("گدام الف", 4);
  const st = await recv("گدام ب", 6);
  assert.equal(st.status, "arrived");
  const rows = await db.sql<{ warehouse_name: string; quantity: string }>`
    select warehouse_name, quantity from purchase_receipts where purchase_id = ${lineId} order by id
  `;
  assert.deepEqual(rows.map((r) => [r.warehouse_name, Number(r.quantity)]), [["گدام الف", 4], ["گدام ب", 6]]);
  const line = await db.sql<{ received_qty: string }>`select received_qty from purchases where id = ${lineId}`;
  assert.equal(Number(line[0].received_qty), 10);
  await db.close();
});

test("ACC-09 bug: editing a purchase re-created its lines and lost the receipts", async () => {
  const { db, base, line, invoiceId, lineId } = await setup();
  await db.tx((sql) =>
    receivePurchaseInvoiceTx(sql, U, { id: invoiceId, warehouseName: "گدام الف", categoryId: null, mode: "full", lines: [] }),
  );
  await db.tx((sql) => savePurchaseInvoiceTx(sql, U, { ...base, id: invoiceId, lines: [{ ...line, id: lineId, unitPrice: 6 }] }));
  const lines = await db.sql<{ id: number; unit_price: string; received_qty: string }>`
    select id, unit_price, received_qty from purchases where invoice_id = ${invoiceId}
  `;
  assert.equal(lines.length, 1);
  assert.equal(lines[0].id, lineId, "line is updated in place, not re-created");
  assert.equal(Number(lines[0].unit_price), 6);
  assert.equal(Number(lines[0].received_qty), 10);
  const rc = await db.sql<{ n: number }>`select count(*)::int as n from purchase_receipts where purchase_id = ${lineId}`;
  assert.equal(rc[0].n, 1);
  await db.close();
});

test("ACC-09/ACC-11: an edit cannot remove received goods that were already sold", async () => {
  const { db, ids, base, line, invoiceId, lineId, itemId } = await setup();
  await db.tx((sql) =>
    receivePurchaseInvoiceTx(sql, U, { id: invoiceId, warehouseName: "گدام الف", categoryId: null, mode: "full", lines: [] }),
  );
  await db.sql`
    insert into sales (user_id, item_id, item_name, quantity, unit_price, currency_id, occurred_on, status)
    values (${U}, ${itemId}, ${"دکمه"}, ${8}, ${9}, ${ids.afnId}, ${"2026-01-02"}, ${"final"})
  `;
  await assert.rejects(
    db.tx((sql) => savePurchaseInvoiceTx(sql, U, { ...base, id: invoiceId, lines: [{ ...line, id: lineId, quantity: 5 }] })),
    /فروخته یا در تولید مصرف شده/,
  );
  // lowering to what is still on hand (10 − 8 = 2 may go) works and trims the receipt
  await db.tx((sql) => savePurchaseInvoiceTx(sql, U, { ...base, id: invoiceId, lines: [{ ...line, id: lineId, quantity: 8 }] }));
  const r = await db.sql<{ q: string }>`select sum(quantity) as q from purchase_receipts where purchase_id = ${lineId}`;
  assert.equal(Number(r[0].q), 8);
  await db.close();
});

test("ACC-09: a received line cannot silently switch to another item", async () => {
  const { db, base, line, invoiceId, lineId } = await setup();
  const other = await db.sql<{ id: number }>`insert into items (user_id, name, kind) values (${U}, ${"زیپ"}, ${"raw"}) returning id`;
  await db.tx((sql) =>
    receivePurchaseInvoiceTx(sql, U, { id: invoiceId, warehouseName: "گدام الف", categoryId: null, mode: "full", lines: [] }),
  );
  await assert.rejects(
    db.tx((sql) =>
      savePurchaseInvoiceTx(sql, U, { ...base, id: invoiceId, lines: [{ ...line, id: lineId, itemId: other[0].id, itemName: "زیپ" }] }),
    ),
    /رسیده است و کالای آن را نمی‌توان عوض کرد/,
  );
  await db.close();
});

test("ACC-09: restoring a backup made before receipts existed rebuilds them", async () => {
  const { db, invoiceId, lineId } = await setup();
  await db.tx((sql) =>
    receivePurchaseInvoiceTx(sql, U, { id: invoiceId, warehouseName: "گدام الف", categoryId: null, mode: "full", lines: [] }),
  );
  const { dumpWorkspace, restoreWorkspaceTx, WORKSPACE_TABLES } = await import("./helpers");
  const { validateWorkspaceBackup } = await import("@/lib/backup-validate");
  const old = JSON.parse(JSON.stringify(await dumpWorkspace(db.sql, U))) as {
    tables: Record<string, unknown[]>;
    manifest?: { tables: Record<string, number>; rowTotal?: number };
  };
  const dropped = old.tables.purchase_receipts.length;
  delete old.tables.purchase_receipts;
  if (old.manifest) {
    delete old.manifest.tables.purchase_receipts;
    if (typeof old.manifest.rowTotal === "number") old.manifest.rowTotal -= dropped;
  }
  const backup = validateWorkspaceBackup(old, WORKSPACE_TABLES);
  await db.tx((tx) => restoreWorkspaceTx(tx, U, backup));
  const r = await db.sql<{ warehouse_name: string; quantity: string }>`
    select warehouse_name, quantity from purchase_receipts where purchase_id = ${lineId}
  `;
  assert.deepEqual(r.map((x) => [x.warehouse_name, Number(x.quantity)]), [["گدام الف", 10]]);
  await db.close();
});
