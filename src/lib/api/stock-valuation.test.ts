import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seedUser, type TestDb } from "@/lib/testing/pglite-db";
import { loadInventoryState, loadInventoryValuation } from "./helpers";

const U = "user-wac";

async function setup() {
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, U));
  return { db, ids };
}

async function item(db: TestDb, name: string, kind: "raw" | "product", purchasePrice = 0) {
  const r = await db.sql<{ id: number }>`
    insert into items (user_id, name, kind, purchase_price) values (${U}, ${name}, ${kind}, ${purchasePrice}) returning id
  `;
  return r[0].id;
}

async function buy(db: TestDb, cur: number, itemId: number, name: string, qty: number, price: number, on: string) {
  await db.sql`
    insert into purchases (user_id, item_id, item_name, quantity, received_qty, unit_price, currency_id, occurred_on, status)
    values (${U}, ${itemId}, ${name}, ${qty}, ${qty}, ${price}, ${cur}, ${on}, ${"final"})
  `;
}

async function sell(db: TestDb, cur: number, itemId: number, name: string, qty: number, price: number, on: string) {
  const r = await db.sql<{ id: number }>`
    insert into sales (user_id, item_id, item_name, quantity, unit_price, currency_id, occurred_on, status)
    values (${U}, ${itemId}, ${name}, ${qty}, ${price}, ${cur}, ${on}, ${"final"}) returning id
  `;
  return r[0].id;
}

test("ACC-02 bug: stock was valued at the catalog purchase price, not what was paid", async () => {
  const { db, ids } = await setup();
  const id = await item(db, "پارچه", "raw", 120); // catalog price 120
  await buy(db, ids.afnId, id, "پارچه", 10, 100, "2026-01-01");
  await buy(db, ids.afnId, id, "پارچه", 10, 200, "2026-01-02");
  await sell(db, ids.afnId, id, "پارچه", 5, 400, "2026-01-03");
  const inv = await loadInventoryState(db.sql, U);
  const c = inv.raw.find((x) => x.itemId === id)!;
  assert.equal(c.qty, 15);
  // WAC = (10×100 + 10×200) / 20 = 150; old code said 120 (catalog) → 1800.
  assert.equal(c.unitCost, 150);
  assert.equal(c.valueBase, 2250);
  await db.close();
});

test("ACC-02 bug: COGS used today's cost instead of the cost when sold", async () => {
  const { db, ids } = await setup();
  const id = await item(db, "دکمه", "raw");
  await buy(db, ids.afnId, id, "دکمه", 10, 100, "2026-01-01");
  const s1 = await sell(db, ids.afnId, id, "دکمه", 10, 150, "2026-01-02");
  await buy(db, ids.afnId, id, "دکمه", 10, 300, "2026-01-03");
  const s2 = await sell(db, ids.afnId, id, "دکمه", 5, 400, "2026-01-04");
  const inv = await loadInventoryValuation(db.sql, U);
  // old: (10 + 5) × current cost 300 = 4500; WAC at sale time: 1000 + 1500.
  assert.equal(inv.saleCosts[s1], 1000);
  assert.equal(inv.saleCosts[s2], 1500);
  await db.close();
});

test("ACC-02: foreign-currency purchases use the invoice's frozen rate", async () => {
  const { db, ids } = await setup();
  const id = await item(db, "زیپ", "raw");
  const inv = await db.sql<{ id: number }>`
    insert into purchase_invoices (user_id, invoice_no, currency_id, occurred_on, fx_enabled, fx_rate)
    values (${U}, ${"P-1"}, ${ids.usdId}, ${"2026-01-01"}, ${true}, ${65}) returning id
  `;
  await db.sql`
    insert into purchases (user_id, invoice_id, item_id, item_name, quantity, received_qty, unit_price, currency_id, occurred_on, status)
    values (${U}, ${inv[0].id}, ${id}, ${"زیپ"}, ${4}, ${4}, ${2}, ${ids.usdId}, ${"2026-01-01"}, ${"final"})
  `;
  await db.sql`update currencies set rate_to_base = ${80} where id = ${ids.usdId}`;
  const c = (await loadInventoryState(db.sql, U)).raw.find((x) => x.itemId === id)!;
  assert.equal(c.unitCost, 130);
  assert.equal(c.valueBase, 520);
  await db.close();
});

test("ACC-02: opening stock without value uses the purchase price, else is flagged", async () => {
  const { db } = await setup();
  const priced = await item(db, "بکس", "product", 80);
  const unpriced = await item(db, "چمدان", "product");
  for (const name of ["بکس", "چمدان"]) {
    await db.sql`
      insert into opening_stock (user_id, kind, item_name, warehouse_name, quantity, value_base, occurred_on)
      values (${U}, ${"finished"}, ${name}, ${"گدام اصلی"}, ${10}, ${0}, ${"2026-01-01"})
    `;
  }
  const inv = await loadInventoryState(db.sql, U);
  const a = inv.products.find((x) => x.itemId === priced)!;
  const b = inv.products.find((x) => x.itemId === unpriced)!;
  assert.equal(a.valueBase, 800);
  assert.ok(!a.costMissing);
  assert.equal(b.qty, 10);
  assert.equal(b.valueBase, 0);
  assert.equal(b.costMissing, true);
  await db.close();
});

test("ACC-02: a stored opening value is kept and averaged with later purchases", async () => {
  const { db, ids } = await setup();
  const id = await item(db, "نخ", "raw", 999);
  await db.sql`
    insert into opening_stock (user_id, kind, item_name, warehouse_name, quantity, value_base, occurred_on)
    values (${U}, ${"raw"}, ${"نخ"}, ${"گدام اصلی"}, ${10}, ${500}, ${"2026-01-01"})
  `;
  await buy(db, ids.afnId, id, "نخ", 10, 70, "2026-01-02");
  const c = (await loadInventoryState(db.sql, U)).raw.find((x) => x.itemId === id)!;
  assert.equal(c.unitCost, 60);
  assert.equal(c.valueBase, 1200);
  await db.close();
});

test("ACC-02: the inventory payload does not carry the per-sale cost map", async () => {
  const { db } = await setup();
  const inv = await loadInventoryState(db.sql, U);
  assert.equal("saleCosts" in inv, false);
  await db.close();
});
