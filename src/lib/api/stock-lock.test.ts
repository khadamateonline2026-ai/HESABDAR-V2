import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb } from "@/lib/testing/pglite-db";
import { lockStock } from "./helpers";

function handlerSource(file: string, name: string): string {
  const src = readFileSync(join(process.cwd(), "src/lib/api", file), "utf8");
  const start = src.indexOf(`export const ${name} =`);
  assert.ok(start >= 0, `${file}: ${name} not found`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

// Every transaction that checks stock before moving it.
const STOCK_POSTINGS: [string, string][] = [
  ["invoices.ts", "saveSaleInvoice"],
  ["finance.ts", "saveOpeningStock"],
  ["inventory.ts", "createWorkOrder"],
  ["inventory.ts", "deliverWorkOrder"],
  ["inventory.ts", "updateWorkOrder"],
  ["workers.ts", "updateWorkerDelivery"],
  ["workers.ts", "deleteWorkerDelivery"],
];

for (const [file, name] of STOCK_POSTINGS) {
  test(`ACC-08: ${name} takes the stock lock inside its transaction before checking stock`, () => {
    const body = handlerSource(file, name);
    const tx = body.indexOf("withTransaction(");
    const lock = body.indexOf("lockStock(sql, context.userId)");
    assert.ok(tx >= 0, "must run in a transaction");
    assert.ok(lock > tx, "lock must be taken inside the transaction");
    for (const later of ["loadInventoryState(", "allocInvoiceNo(", "for update", "applyDeliveryPlan("]) {
      const at = body.indexOf(later, tx);
      if (at >= 0) assert.ok(lock < at, `${name}: lockStock must come before ${later}`);
    }
  });
}

test("ACC-08: lockStock holds a transaction-scoped advisory lock", async () => {
  const db = await createTestDb();
  const held = await db.tx(async (sql) => {
    await lockStock(sql, "user-lock");
    const r = await sql<{ n: number }>`select count(*)::int as n from pg_locks where locktype = 'advisory' and granted`;
    return r[0].n;
  });
  assert.equal(held, 1);
  const after = await db.sql<{ n: number }>`select count(*)::int as n from pg_locks where locktype = 'advisory'`;
  assert.equal(after[0].n, 0);
  await db.close();
});
