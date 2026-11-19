import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMigrations, createTestDb, seedUser, type TestDb } from "@/lib/testing/pglite-db";
import { carryRefCosts } from "./invoices";
import { backfillSaleRefCosts, loadInventoryState, loadInventoryValuation, overheadPerUnitBase, saleRefUnitCost } from "./helpers";

const U = "user-snap";

function handlerSource(file: string, name: string): string {
  const src = readFileSync(join(process.cwd(), "src/lib/api", file), "utf8");
  const start = src.indexOf(`export const ${name} =`);
  assert.ok(start >= 0, `${file}: ${name} not found`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
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

async function sell(db: TestDb, cur: number, itemId: number, name: string, qty: number, on: string, refCost?: number | null) {
  const r =
    refCost === undefined
      ? await db.sql<{ id: number }>`
          insert into sales (user_id, item_id, item_name, quantity, unit_price, currency_id, occurred_on, status)
          values (${U}, ${itemId}, ${name}, ${qty}, ${1000}, ${cur}, ${on}, ${"final"}) returning id
        `
      : await db.sql<{ id: number }>`
          insert into sales (user_id, item_id, item_name, quantity, unit_price, currency_id, occurred_on, status, ref_unit_cost_base)
          values (${U}, ${itemId}, ${name}, ${qty}, ${1000}, ${cur}, ${on}, ${"final"}, ${refCost}) returning id
        `;
  return r[0].id;
}

/** Order of `qty` products using 2 units of raw each (recipe snapshotted like createWorkOrder). */
async function order(db: TestDb, productId: number, rawId: number, qty: number, on: string) {
  const r = await db.sql<{ id: number }>`
    insert into work_orders (user_id, product_id, product_name, quantity, delivered_qty, occurred_on)
    values (${U}, ${productId}, ${"پیراهن"}, ${qty}, ${0}, ${on}) returning id
  `;
  await db.sql`update work_orders set root_id = id where id = ${r[0].id}`;
  await db.sql`
    insert into work_order_alloc (user_id, work_order_id, raw_item_id, raw_item_name, qty_per_unit, allocated_qty)
    values (${U}, ${r[0].id}, ${rawId}, ${"پارچه"}, ${2}, ${2 * qty})
  `;
  return r[0].id;
}

/** Delivery to the warehouse; `snapshot` mirrors deliverWorkOrder (overhead frozen at delivery). */
async function deliver(db: TestDb, orderId: number, productId: number, qty: number, on: string, snapshot = true) {
  const overhead = snapshot ? await overheadPerUnitBase(db.sql, U, productId) : null;
  await db.sql`
    insert into work_deliveries (user_id, work_order_id, quantity, occurred_on, notes, overhead_per_unit_base)
    values (${U}, ${orderId}, ${qty}, ${on}, ${""}, ${overhead})
  `;
}

async function setOverhead(db: TestDb, productId: number, amount: number) {
  await db.sql`delete from item_overheads where user_id = ${U} and item_id = ${productId}`;
  await db.sql`insert into item_overheads (user_id, item_id, title, amount) values (${U}, ${productId}, ${"دوخت"}, ${amount})`;
}

test("deliverWorkOrder stores the overhead per unit on every delivery it inserts", () => {
  const body = handlerSource("inventory.ts", "deliverWorkOrder");
  assert.ok(body.includes("overheadPerUnitBase(sql, context.userId"), "overhead must be read at delivery time");
  const inserts = body.split("insert into work_deliveries").slice(1);
  assert.equal(inserts.length, 2);
  for (const ins of inserts) assert.ok(ins.slice(0, 400).includes("overhead_per_unit_base"));
});

test("changing a product's overhead keeps past deliveries and past sales profit; new deliveries use the new overhead", async () => {
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, U));
  const raw = await item(db, "پارچه", "raw");
  const prod = await item(db, "پیراهن", "product");
  await buy(db, ids.afnId, raw, "پارچه", 100, 50, "2026-01-01");
  await setOverhead(db, prod, 30);
  const o1 = await order(db, prod, raw, 10, "2026-01-02");
  await deliver(db, o1, prod, 10, "2026-01-03"); // unit = 2×50 + 30 = 130
  const s1 = await sell(db, ids.afnId, prod, "پیراهن", 4, "2026-01-04");
  const before = await loadInventoryValuation(db.sql, U);
  assert.equal(before.saleCosts[s1], 520);
  assert.equal(before.products.find((c) => c.itemId === prod)!.valueBase, 780);

  await setOverhead(db, prod, 80); // overhead edited later
  const after = await loadInventoryValuation(db.sql, U);
  // Old code: 4 × (100 + 80) = 720 — the past sale's profit changed.
  assert.equal(after.saleCosts[s1], 520);
  assert.equal(after.products.find((c) => c.itemId === prod)!.valueBase, 780);

  const o2 = await order(db, prod, raw, 10, "2026-01-05");
  await deliver(db, o2, prod, 10, "2026-01-06"); // unit = 100 + 80 = 180
  const s2 = await sell(db, ids.afnId, prod, "پیراهن", 16, "2026-01-07");
  const later = await loadInventoryValuation(db.sql, U);
  assert.equal(later.saleCosts[s1], 520);
  // WAC after second delivery: (6×130 + 10×180) / 16 = 161.25 → 16 × 161.25
  assert.equal(later.saleCosts[s2], 2580);
  await db.close();
});

test("deliveries without a stored overhead (old backups) still use the current overhead", async () => {
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, U));
  const raw = await item(db, "پارچه", "raw");
  const prod = await item(db, "پیراهن", "product");
  await buy(db, ids.afnId, raw, "پارچه", 100, 50, "2026-01-01");
  await setOverhead(db, prod, 30);
  const o1 = await order(db, prod, raw, 10, "2026-01-02");
  await deliver(db, o1, prod, 10, "2026-01-03", false);
  const inv = await loadInventoryValuation(db.sql, U);
  assert.equal(inv.products.find((c) => c.itemId === prod)!.valueBase, 1300);
  await db.close();
});

test("migration 0040 freezes existing deliveries at the overhead in force at deploy: no number changes", async () => {
  const db = await createTestDb({ upTo: "0039_sale_warehouse.sql" });
  const ids = await db.tx((sql) => seedUser(sql, U));
  const raw = await item(db, "پارچه", "raw");
  const prod = await item(db, "پیراهن", "product");
  await buy(db, ids.afnId, raw, "پارچه", 100, 50, "2026-01-01");
  await setOverhead(db, prod, 30);
  const o1 = await order(db, prod, raw, 10, "2026-01-02");
  await db.sql`
    insert into work_deliveries (user_id, work_order_id, quantity, occurred_on, notes)
    values (${U}, ${o1}, ${10}, ${"2026-01-03"}, ${""})
  `;
  const r = await db.sql<{ id: number }>`
    insert into sales (user_id, item_id, item_name, quantity, unit_price, currency_id, occurred_on, status)
    values (${U}, ${prod}, ${"پیراهن"}, ${4}, ${1000}, ${ids.afnId}, ${"2026-01-04"}, ${"final"}) returning id
  `;
  await applyMigrations(db.pg);
  const atDeploy = await loadInventoryValuation(db.sql, U);
  assert.equal(atDeploy.saleCosts[r[0].id], 520);
  const row = await db.sql<{ v: string }>`select overhead_per_unit_base as v from work_deliveries`;
  assert.equal(Number(row[0].v), 30);
  await setOverhead(db, prod, 80);
  const later = await loadInventoryValuation(db.sql, U);
  assert.equal(later.saleCosts[r[0].id], 520);
  // The current cost estimate for new production follows the new overhead.
  assert.equal(await overheadPerUnitBase(db.sql, U, prod), 80);
  await db.close();
});

test("saveSaleInvoice stores the reference unit cost on every sale line (new lines: today's)", () => {
  const body = handlerSource("invoices.ts", "saveSaleInvoice");
  const ins = body.split("insert into sales")[1] ?? "";
  assert.ok(ins.slice(0, 600).includes("ref_unit_cost_base"));
  assert.ok(body.includes("(itemId) => saleRefUnitCost(inv, itemId)"));
});

test("oversold quantity keeps the cost frozen at sale time when the purchase price changes later", async () => {
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, U));
  const id = await item(db, "دکمه", "raw", 100);
  await buy(db, ids.afnId, id, "دکمه", 5, 100, "2026-01-01");
  // Snapshot as saveSaleInvoice does it: card unit cost at save time (100).
  const ref = saleRefUnitCost(await loadInventoryState(db.sql, U), id);
  assert.equal(ref, 100);
  const s1 = await sell(db, ids.afnId, id, "دکمه", 8, "2026-01-02", ref); // 3 more than on hand
  const before = await loadInventoryValuation(db.sql, U);
  assert.equal(before.saleCosts[s1], 800); // 5 × 100 + 3 × 100
  await db.sql`update items set purchase_price = ${250} where id = ${id}`;
  const after = await loadInventoryValuation(db.sql, U);
  // Old code: 5 × 100 + 3 × 250 = 1250 — past profit changed.
  assert.equal(after.saleCosts[s1], 800);
  await db.close();
});

test("old sale lines without a snapshot: same number as before, then frozen by the backfill", async () => {
  const db = await createTestDb({ upTo: "0040_delivery_overhead_snapshot.sql" });
  const ids = await db.tx((sql) => seedUser(sql, U));
  const id = await item(db, "دکمه", "raw", 100);
  await buy(db, ids.afnId, id, "دکمه", 5, 100, "2026-01-01");
  const s1 = await sell(db, ids.afnId, id, "دکمه", 8, "2026-01-02");
  const prod = await item(db, "پیراهن", "product", 400);
  const s2 = await sell(db, ids.afnId, prod, "پیراهن", 2, "2026-01-02"); // nothing on hand
  const old = await loadInventoryValuation(db.sql, U);
  await applyMigrations(db.pg);
  const atDeploy = await loadInventoryValuation(db.sql, U);
  assert.deepEqual(atDeploy.saleCosts, old.saleCosts);
  assert.equal(await backfillSaleRefCosts(db.sql, U), 2);
  const filled = await loadInventoryValuation(db.sql, U);
  assert.deepEqual(filled.saleCosts, old.saleCosts);
  assert.equal(filled.saleCosts[s1], 800);
  assert.equal(filled.saleCosts[s2], 800);
  assert.equal(await backfillSaleRefCosts(db.sql, U), 0);
  await db.sql`update items set purchase_price = ${250} where id in (${id}, ${prod})`;
  const later = await loadInventoryValuation(db.sql, U);
  assert.equal(later.saleCosts[s1], 800);
  assert.equal(later.saleCosts[s2], 800);
  await db.close();
});

test("editing a sale invoice keeps each existing line's original reference cost", () => {
  const body = handlerSource("invoices.ts", "saveSaleInvoice");
  assert.ok(body.includes("carryRefCosts("), "edit must carry old snapshots over");
  assert.ok(body.includes("${refCosts[lineIdx]}"));
  const client = readFileSync(join(process.cwd(), "src/routes/_app/sales.tsx"), "utf8");
  assert.ok(client.includes("id: initial?.lines.some((x) => String(x.id) === l.key) ? Number(l.key) : null"));
});

test("carryRefCosts: same line keeps its snapshot (null stays null); new or re-itemed lines get today's", () => {
  const old = [
    { id: 11, itemId: 1, refCost: 100 },
    { id: 12, itemId: 2, refCost: null },
    { id: 13, itemId: 3, refCost: 70 },
  ];
  const fresh = (itemId: number | null) => (itemId == null ? null : itemId * 1000);
  // New client: ids sent; line 13's item changed to 4; one brand-new line of item 1.
  assert.deepEqual(
    carryRefCosts(old, [{ id: 11, itemId: 1 }, { id: 12, itemId: 2 }, { id: 13, itemId: 4 }, { id: null, itemId: 1 }], fresh),
    [100, null, 4000, 1000],
  );
  // Old client / old offline queue (no ids): matched by item in order.
  assert.deepEqual(
    carryRefCosts(old, [{ itemId: 2 }, { itemId: 1 }, { itemId: 1 }, { itemId: 3 }], fresh),
    [null, 100, 1000, 70],
  );
  // New invoice: everything fresh.
  assert.deepEqual(carryRefCosts([], [{ id: null, itemId: 5 }], fresh), [5000]);
});

test("edit a sale after the purchase price changed: its oversold cost stays at the original rate", async () => {
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, U));
  const id = await item(db, "دکمه", "raw", 100);
  await buy(db, ids.afnId, id, "دکمه", 5, 100, "2026-01-01");
  const s1 = await sell(db, ids.afnId, id, "دکمه", 8, "2026-01-02", saleRefUnitCost(await loadInventoryState(db.sql, U), id));
  assert.equal((await loadInventoryValuation(db.sql, U)).saleCosts[s1], 800);
  await db.sql`update items set purchase_price = ${250} where id = ${id}`;
  // Re-save as saveSaleInvoice does: read old lines, delete, re-insert with carried snapshots.
  const inv = await loadInventoryState(db.sql, U);
  const oldRows = await db.sql<{ id: number; item_id: number; ref_unit_cost_base: string | null }>`
    select id, item_id, ref_unit_cost_base from sales where user_id = ${U} order by id
  `;
  const lines = [{ id: s1, itemId: id }];
  const refs = carryRefCosts(
    oldRows.map((r) => ({ id: r.id, itemId: r.item_id, refCost: r.ref_unit_cost_base == null ? null : Number(r.ref_unit_cost_base) })),
    lines,
    (itemId) => saleRefUnitCost(inv, itemId),
  );
  await db.sql`delete from sales where user_id = ${U}`;
  const s1b = await sell(db, ids.afnId, id, "دکمه", 8, "2026-01-02", refs[0]);
  // Re-snapshotting at edit time would give 5 × 100 + 3 × 250 = 1250.
  assert.equal((await loadInventoryValuation(db.sql, U)).saleCosts[s1b], 800);
  await db.close();
});

test("editing a delivery (quantity/date/receiver) updates it in place and keeps its stored overhead", async () => {
  const src = readFileSync(join(process.cwd(), "src/lib/api/workers.ts"), "utf8");
  assert.ok(!src.includes("insert into work_deliveries"), "worker edits must not re-create deliveries");
  assert.ok(!src.includes("overhead_per_unit_base"), "worker edits must not rewrite the stored overhead");
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, U));
  const raw = await item(db, "پارچه", "raw");
  const prod = await item(db, "پیراهن", "product");
  await buy(db, ids.afnId, raw, "پارچه", 100, 50, "2026-01-01");
  await setOverhead(db, prod, 30);
  const o1 = await order(db, prod, raw, 10, "2026-01-02");
  await deliver(db, o1, prod, 10, "2026-01-03");
  await setOverhead(db, prod, 80);
  await db.sql`update work_deliveries set quantity = ${8} where user_id = ${U}`; // as applyDeliveryPlan does
  const inv = await loadInventoryValuation(db.sql, U);
  assert.equal(inv.products.find((c) => c.itemId === prod)!.valueBase, 8 * 130);
  await db.close();
});
