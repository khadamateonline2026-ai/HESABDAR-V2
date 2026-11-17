import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seedUser } from "@/lib/testing/pglite-db";
import { loadCatalogs, loadWorkerPaidBase } from "./helpers";
import { loadRecurringDues } from "./ops";
import { loadExpenseDebts } from "./reports";

const U = "user-wcur";

/** A salaried worker paid 100 USD a month (USD = 70 AFN). */
async function setup() {
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, U));
  const w = await db.sql<{ id: number }>`
    insert into parties (user_id, kind, name, employment, currency_id)
    values (${U}, ${"worker"}, ${"احمد"}, ${"salaried"}, ${ids.usdId}) returning id
  `;
  await db.sql`
    insert into recurring_expenses (user_id, title, amount, currency_id, start_on, worker_id)
    values (${U}, ${"معاش احمد"}, ${100}, ${ids.usdId}, ${"2026-08-01"}, ${w[0].id})
  `;
  return { db, ids, workerId: w[0].id };
}

test("ACC-06 bug: an AFN payment was compared with a USD salary as if both were AFN", async () => {
  const { db, workerId } = await setup();
  const dues = (await loadRecurringDues(db.sql, U)).filter((d) => d.workerId === workerId);
  assert.ok(dues.length >= 2, "at least two months are due");
  assert.equal(dues[0].amountBase, 7000);
  // One month's salary paid in AFN (7000 ؋ = 100 $).
  await db.sql`insert into worker_payments (user_id, worker_id, amount, occurred_on, invoice_no)
    values (${U}, ${workerId}, ${7000}, ${"2026-09-02"}, ${"WP-1"})`;
  const debts = (await loadExpenseDebts(db.sql, U)).filter((d) => d.source === "salary");
  // Old code: 7000 ≥ 100 × n, so every month looked paid.
  assert.equal(debts.length, dues.length - 1);
  assert.ok(debts.every((d) => d.amountBase === 7000));
  await db.close();
});

test("ACC-06: a payment recorded in another currency counts at its frozen rate", async () => {
  const { db, ids, workerId } = await setup();
  await db.sql`insert into worker_payments (user_id, worker_id, amount, occurred_on, invoice_no, currency_id, fx_rate, account_id)
    values (${U}, ${workerId}, ${100}, ${"2026-09-02"}, ${"WP-1"}, ${ids.usdId}, ${65}, ${ids.accountId})`;
  await db.sql`update currencies set rate_to_base = ${80} where id = ${ids.usdId}`;
  const paid = await loadWorkerPaidBase(db.sql, U);
  assert.equal(paid.get(workerId), 6500);
  const before = (await loadCatalogs(db.sql, U)).accounts.find((a) => a.id === ids.accountId)!;
  await db.sql`delete from worker_payments where user_id = ${U}`;
  const after = (await loadCatalogs(db.sql, U)).accounts.find((a) => a.id === ids.accountId)!;
  assert.equal(after.balance - before.balance, 6500, "the AFN account paid 6500 ؋, not 100 ؋");
  await db.close();
});

test("ACC-06: payments without a currency stay in the base currency (old rows unchanged)", async () => {
  const { db, workerId } = await setup();
  await db.sql`insert into worker_payments (user_id, worker_id, amount, occurred_on, invoice_no)
    values (${U}, ${workerId}, ${500}, ${"2026-09-02"}, ${"WP-1"})`;
  assert.equal((await loadWorkerPaidBase(db.sql, U)).get(workerId), 500);
  await db.close();
});
