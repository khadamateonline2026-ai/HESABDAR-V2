import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seedUser, type TestDb } from "@/lib/testing/pglite-db";
import { loadInventoryState, loadWarehouseStock } from "./helpers";

const U = "user-wh";

async function setup() {
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, U));
  await db.sql`insert into warehouses (user_id, name) values (${U}, ${"گدام الف"}), (${U}, ${"گدام ب"})`;
  return { db, ids };
}

async function item(db: TestDb, name: string, kind: "raw" | "product") {
  const r = await db.sql<{ id: number }>`insert into items (user_id, name, kind) values (${U}, ${name}, ${kind}) returning id`;
  return r[0].id;
}

/** A purchase line received in parts, each part into its own warehouse. */
async function buy(db: TestDb, cur: number, itemId: number, name: string, price: number, parts: [string, number][]) {
  const qty = parts.reduce((s, [, q]) => s + q, 0);
  const p = await db.sql<{ id: number }>`
    insert into purchases (user_id, item_id, item_name, quantity, received_qty, unit_price, currency_id, occurred_on, status, warehouse_name)
    values (${U}, ${itemId}, ${name}, ${qty}, ${qty}, ${price}, ${cur}, ${"2026-01-01"}, ${"final"}, ${parts[parts.length - 1][0]})
    returning id
  `;
  for (const [wh, q] of parts) {
    await db.sql`insert into purchase_receipts (user_id, purchase_id, quantity, warehouse_name, occurred_on)
      values (${U}, ${p[0].id}, ${q}, ${wh}, ${"2026-01-01"})`;
  }
}

function cellOf(rows: Awaited<ReturnType<typeof loadWarehouseStock>>, wh: string, name: string) {
  return rows.find((w) => w.warehouseName === wh)?.items.find((i) => i.name === name);
}

test("ACC-10 bug: raw material used in production still showed in the warehouse", async () => {
  const { db, ids } = await setup();
  const fabric = await item(db, "پارچه", "raw");
  const shirt = await item(db, "پیراهن", "product");
  await buy(db, ids.afnId, fabric, "پارچه", 100, [["گدام الف", 10]]);
  await db.sql`insert into bom_lines (user_id, product_id, raw_item_id, quantity) values (${U}, ${shirt}, ${fabric}, ${2})`;
  await db.sql`insert into work_orders (user_id, product_id, product_name, quantity, occurred_on)
    values (${U}, ${shirt}, ${"پیراهن"}, ${2}, ${"2026-01-02"})`;
  const rows = await loadWarehouseStock(db.sql, U);
  // 10 bought, 2 × 2 = 4 handed to production → 6 left (old view said 10).
  assert.equal(cellOf(rows, "گدام الف", "پارچه")?.qty, 6);
  assert.equal(cellOf(rows, "گدام الف", "پارچه")?.valueBase, 600);
  await db.close();
});

test("ACC-10: a purchase split over two warehouses shows in both, totals match the stock cards", async () => {
  const { db, ids } = await setup();
  const zip = await item(db, "زیپ", "raw");
  await buy(db, ids.afnId, zip, "زیپ", 10, [["گدام الف", 6], ["گدام ب", 4]]);
  await db.sql`insert into sales (user_id, item_id, item_name, quantity, unit_price, currency_id, occurred_on, status)
    values (${U}, ${zip}, ${"زیپ"}, ${5}, ${20}, ${ids.afnId}, ${"2026-01-03"}, ${"final"})`;
  const rows = await loadWarehouseStock(db.sql, U);
  // Old view put all 10 in "گدام ب" (last receipt) and drained sales by warehouse order.
  assert.equal(cellOf(rows, "گدام الف", "زیپ")?.qty, 3);
  assert.equal(cellOf(rows, "گدام ب", "زیپ")?.qty, 2);
  const card = (await loadInventoryState(db.sql, U)).raw.find((c) => c.itemId === zip)!;
  const total = rows.flatMap((w) => w.items).filter((i) => i.name === "زیپ");
  assert.equal(total.reduce((s, i) => s + i.qty, 0), card.qty);
  assert.equal(total.reduce((s, i) => s + i.valueBase, 0), card.valueBase);
  await db.close();
});

test("ACC-10: older purchases without receipt rows fall back to the line's warehouse", async () => {
  const { db, ids } = await setup();
  const id = await item(db, "دکمه", "raw");
  await db.sql`insert into purchases (user_id, item_id, item_name, quantity, received_qty, unit_price, currency_id, occurred_on, status, warehouse_name)
    values (${U}, ${id}, ${"دکمه"}, ${8}, ${8}, ${5}, ${ids.afnId}, ${"2026-01-01"}, ${"final"}, ${"گدام ب"})`;
  await db.sql`insert into opening_stock (user_id, kind, item_name, warehouse_name, quantity, value_base, occurred_on)
    values (${U}, ${"raw"}, ${"دکمه"}, ${"گدام الف"}, ${2}, ${10}, ${"2025-12-31"})`;
  const rows = await loadWarehouseStock(db.sql, U);
  assert.equal(cellOf(rows, "گدام ب", "دکمه")?.qty, 8);
  assert.equal(cellOf(rows, "گدام الف", "دکمه")?.qty, 2);
  await db.close();
});
