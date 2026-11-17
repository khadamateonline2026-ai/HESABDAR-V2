import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMigrations, createTestDb, ensureRuntimeColumns, seedUser, type TestDb } from "@/lib/testing/pglite-db";
import { assertOwned } from "./ownership";
import { loadCatalogs } from "./helpers";

async function twoTenants(upTo?: string) {
  const db = await createTestDb(upTo ? { upTo } : {});
  await ensureRuntimeColumns(db.sql);
  const a = await seedUser(db.sql, "alice");
  const b = await seedUser(db.sql, "bob");
  await db.sql`update currencies set name = 'ALICE-SECRET-CURRENCY' where id = ${a.usdId}`;
  return { db, a, b };
}

const insertBobAccountWith = (db: TestDb, currencyId: number) =>
  db.sql`insert into accounts (user_id, name, currency_id, opening_balance) values ('bob', 'x', ${currencyId}, 0)`;

test("SEC-01 bug: another workspace's id could be linked and its data read back", async () => {
  const { db, a } = await twoTenants("0030_role_pin_lockout.sql");
  // Bob's request carries Alice's currency id; the old schema/code accepted it.
  await insertBobAccountWith(db, a.usdId);
  const leaked = await db.sql<{ name: string }>`
    select c.name from accounts a join currencies c on c.id = a.currency_id where a.user_id = 'bob'
  `;
  assert.ok(leaked.some((r) => r.name === "ALICE-SECRET-CURRENCY"), "old join leaked Alice's currency name");
  await db.close();
});

test("SEC-01 fix: the database refuses cross-workspace references (migration 0031)", async () => {
  const { db, a, b } = await twoTenants();
  await assert.rejects(insertBobAccountWith(db, a.usdId), /ارجاع نامعتبر/);
  await insertBobAccountWith(db, b.usdId);
  // updates are checked too
  await assert.rejects(
    db.sql`update accounts set currency_id = ${a.afnId} where user_id = 'bob' and name = 'x'`,
    /ارجاع نامعتبر/,
  );
  // transfer to another workspace's account
  await assert.rejects(
    db.sql`insert into transfers (user_id, from_account_id, to_account_id, amount, occurred_on)
      values ('bob', ${b.accountId}, ${a.accountId}, 1, '2026-01-01')`,
    /ارجاع نامعتبر/,
  );
  await db.close();
});

test("SEC-01 fix: deferred check allows in-transaction ordering (restore, self reference)", async () => {
  const { db, b } = await twoTenants();
  const item = await db.sql<{ id: number }>`insert into items (user_id, name, kind) values ('bob', 'p', 'product') returning id`;
  await db.tx(async (tx) => {
    await tx`insert into work_orders (id, user_id, product_id, product_name, quantity, delivered_qty, occurred_on, invoice_no, root_id)
      values (9001, 'bob', ${item[0].id}, 'p', 1, 0, '2026-01-01', 'W-1', 9001)`;
  });
  const n = await db.sql<{ n: number }>`select count(*)::int as n from work_orders where id = 9001`;
  assert.equal(Number(n[0].n), 1);
  void b;
  await db.close();
});

test("SEC-01 fix: assertOwned accepts own ids, skips empty ones, rejects foreign ids in Persian", async () => {
  const { db, a, b } = await twoTenants();
  await assertOwned(db.sql, "bob", [["accounts", b.accountId], ["currencies", b.usdId], ["parties", null]]);
  await assert.rejects(assertOwned(db.sql, "bob", [["accounts", a.accountId]]), /حساب انتخاب‌شده یافت نشد یا به این حساب تعلق ندارد/);
  await assert.rejects(assertOwned(db.sql, "bob", [["currencies", b.usdId], ["currencies", a.usdId]]), /واحد پول/);
  await assert.rejects(assertOwned(db.sql, "bob", [["items", 999999]]), /کالا/);
  await db.close();
});

test("SEC-01 fix: joins are scoped by owner (catalog shows only own names)", async () => {
  // Simulate legacy bad data that predates 0031, then read through loadCatalogs.
  const { db, a } = await twoTenants("0030_role_pin_lockout.sql");
  await insertBobAccountWith(db, a.usdId);
  await applyMigrations(db.pg);
  const cat = await loadCatalogs(db.sql, "bob");
  const names = JSON.stringify(cat);
  assert.doesNotMatch(names, /ALICE-SECRET-CURRENCY/);
  await db.close();
});

test("SEC-01 invariant: write handlers check every client-sent id", () => {
  const expect: [string, string][] = [
    ["finance.ts", "saveAccount"], ["finance.ts", "saveTransfer"], ["finance.ts", "saveCapital"],
    ["finance.ts", "saveOpeningCash"], ["inventory.ts", "saveCatalogItem"], ["inventory.ts", "createWorkOrder"],
    ["inventory.ts", "deliverWorkOrder"], ["inventory.ts", "updateWorkOrder"], ["invoices.ts", "savePurchaseInvoice"],
    ["invoices.ts", "receivePurchaseInvoice"], ["invoices.ts", "saveSaleInvoice"], ["ops.ts", "savePurchase"],
    ["ops.ts", "saveSale"], ["ops.ts", "saveExpense"], ["ops.ts", "saveRecurringExpense"],
    ["ops.ts", "setRecurringPeriodStatus"], ["reports.ts", "savePartyPayment"], ["setup.ts", "saveWageRate"],
    ["setup.ts", "saveParty"], ["setup.ts", "saveItem"], ["workers.ts", "saveWorkerPayment"],
    ["workers.ts", "updateWorkerDelivery"],
  ];
  for (const [file, name] of expect) {
    const src = readFileSync(join(process.cwd(), "src/lib/api", file), "utf8");
    const start = src.indexOf(`export const ${name} =`);
    const next = src.indexOf("\nexport ", start + 1);
    let body = src.slice(start, next < 0 ? undefined : next);
    // A handler may delegate to an exported `${name}Tx(...)` (used by tests);
    // then the check must live in that function.
    if (body.includes(`${name}Tx(`)) {
      const tx = src.indexOf(`export async function ${name}Tx(`);
      assert.ok(tx >= 0, `${file}:${name}Tx`);
      const txNext = src.indexOf("\nexport ", tx + 1);
      body += src.slice(tx, txNext < 0 ? undefined : txNext);
    }
    assert.match(body, /assertOwned\(/, `${file}:${name}`);
  }
});
