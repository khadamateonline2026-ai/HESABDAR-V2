import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, seedUser, type TestDb } from "@/lib/testing/pglite-db";
import { idempotentWith, inOpTx } from "@/lib/op-scope.server";
import type { Sql } from "@/lib/db";

const U = "user-idem";

/** Mirrors withTransaction (db.ts): every transaction body goes through inOpTx. */
function withTx<T>(db: TestDb, fn: (sql: Sql) => Promise<T>) {
  return db.tx((sql) => inOpTx(sql, fn));
}

async function setup() {
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, U));
  return { db, ids };
}

/** A queued "new sale" save: one insert, returns the new id (like saveSale). */
function saveSale(db: TestDb, ids: { afnId: number }, fail = false) {
  return withTx(db, async (sql) => {
    const rows = await sql<{ id: number }>`
      insert into sales (user_id, item_name, quantity, unit_price, currency_id, occurred_on, status)
      values (${U}, ${"چای"}, ${2}, ${10}, ${ids.afnId}, ${"2026-11-17"}, ${"final"})
      returning id
    `;
    if (fail) throw new Error("خطای آزمایشی");
    return { id: rows[0].id };
  });
}

async function saleCount(db: TestDb) {
  const r = await db.sql<{ n: number }>`select count(*)::int as n from sales where user_id = ${U}`;
  return r[0].n;
}

test("STR-04 bug: replaying a committed offline save without a key writes it twice", async () => {
  const { db, ids } = await setup();
  await saveSale(db, ids); // first attempt committed, response lost (fakeOk)
  await saveSale(db, ids); // flush replays the same queued row
  assert.equal(await saleCount(db), 2);
  await db.close();
});

test("STR-04 fix: a replay with the same key returns the original result and writes nothing", async () => {
  const { db, ids } = await setup();
  const key = "4f6a2c1e-0b7d-4e8a-9c3f-1a2b3c4d5e6f";
  const first = await idempotentWith(db.sql, U, key, () => saveSale(db, ids));
  const again = await idempotentWith(db.sql, U, key, () => saveSale(db, ids));
  assert.deepEqual(again, first);
  assert.equal(await saleCount(db), 1);
  const ops = await db.sql<{ n: number }>`select count(*)::int as n from offline_ops where user_id = ${U}`;
  assert.equal(ops[0].n, 1);
  await db.close();
});

test("STR-04: the key is claimed inside the write's transaction (lost race replays are no-ops)", async () => {
  const { db, ids } = await setup();
  const key = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const first = await idempotentWith(db.sql, U, key, () => saveSale(db, ids));
  // A second attempt that passed the pre-check before the first committed
  // still hits the unique key inside its own transaction and is rolled back.
  const { runUnderOp } = await import("@/lib/op-scope.server");
  const raced = await runUnderOp(U, key, () => saveSale(db, ids));
  assert.deepEqual(raced, first);
  assert.equal(await saleCount(db), 1);
  await db.close();
});

test("STR-04: a failed attempt leaves no key, so the retry really runs", async () => {
  const { db, ids } = await setup();
  const key = "11111111-2222-4333-8444-555555555555";
  await assert.rejects(idempotentWith(db.sql, U, key, () => saveSale(db, ids, true)), /خطای آزمایشی/);
  assert.equal(await saleCount(db), 0);
  const ok = await idempotentWith(db.sql, U, key, () => saveSale(db, ids));
  assert.ok(ok.id > 0);
  assert.equal(await saleCount(db), 1);
  await db.close();
});

test("STR-04: keys are per user", async () => {
  const { db, ids } = await setup();
  const other = await db.tx((sql) => seedUser(sql, "user-2"));
  const key = "99999999-8888-4777-8666-555555555555";
  await idempotentWith(db.sql, U, key, () => saveSale(db, ids));
  const r = await idempotentWith(db.sql, "user-2", key, () =>
    withTx(db, async (sql) => {
      const rows = await sql<{ id: number }>`
        insert into sales (user_id, item_name, quantity, unit_price, currency_id, occurred_on, status)
        values (${"user-2"}, ${"قند"}, ${1}, ${5}, ${other.afnId}, ${"2026-11-17"}, ${"final"}) returning id
      `;
      return { id: rows[0].id };
    }),
  );
  assert.ok(r.id > 0);
  await db.close();
});

test("STR-04 invariant: every queued save is idempotent and transactional; the engine sends the key", () => {
  const api = (f: string) => readFileSync(join(process.cwd(), "src/lib/api", f), "utf8");
  const saves: [string, string][] = [
    ["invoices.ts", "saveSaleInvoice"],
    ["invoices.ts", "savePurchaseInvoice"],
    ["invoices.ts", "receivePurchaseInvoice"],
    ["reports.ts", "savePartyPayment"],
    ["inventory.ts", "saveCatalogItem"],
    ["finance.ts", "saveOpeningStock"],
    ["ops.ts", "saveSale"],
    ["ops.ts", "savePurchase"],
  ];
  for (const [file, name] of saves) {
    const src = api(file);
    const start = src.indexOf(`export const ${name} =`);
    const next = src.indexOf("\nexport ", start + 1);
    const body = src.slice(start, next < 0 ? undefined : next);
    assert.match(body, /idempotent\(context\.userId/, `${name} must be idempotent`);
    assert.match(body, /withTransaction\(/, `${name} must write in one transaction`);
  }
  const engine = readFileSync(join(process.cwd(), "src/lib/offline/engine.ts"), "utf8");
  assert.equal((engine.match(/OFFLINE_OP_HEADER/g) ?? []).length >= 3, true);
  const db = readFileSync(join(process.cwd(), "src/lib/db.ts"), "utf8");
  assert.equal((db.match(/inOpTx\(sql, fn\)/g) ?? []).length, 2);
});
