import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, ensureRuntimeColumns, seedUser, type TestDb } from "@/lib/testing/pglite-db";
import { resetWorkspaceTx } from "./workspace";

/** Body of `export const <name> = createServerFn(...)` up to the next top-level export. */
function handlerSource(file: string, name: string): string {
  const src = readFileSync(join(process.cwd(), "src/lib/api", file), "utf8");
  const start = src.indexOf(`export const ${name} =`);
  assert.ok(start >= 0, `${file}: ${name} not found`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

// STR-03 invariant: every multi-step business operation runs in one transaction.
const ATOMIC: [string, string][] = [
  ["workspace.ts", "resetWorkspaceData"],
  ["inventory.ts", "createWorkOrder"],
  ["inventory.ts", "deliverWorkOrder"],
  ["invoices.ts", "receivePurchaseInvoice"],
  ["finance.ts", "saveTransfer"],
  ["reports.ts", "savePartyPayment"],
  ["ops.ts", "setRecurringPeriodStatus"],
  ["workers.ts", "updateWorkerDelivery"],
  ["workers.ts", "deleteWorkerDelivery"],
  ["workers.ts", "resetWorkerAccounts"],
];

for (const [file, name] of ATOMIC) {
  test(`STR-03: ${name} runs inside withTransaction`, () => {
    const body = handlerSource(file, name);
    assert.match(body, /withTransaction\(/, `${file}:${name} must use withTransaction`);
  });
}

test("STR-03: updateWorkerDelivery validates the target before the first write", () => {
  const body = handlerSource("workers.ts", "updateWorkerDelivery");
  const check = body.indexOf("کارگر مرحله بعد را انتخاب کنید");
  const firstWrite = body.indexOf("applyDeliveryPlan(");
  assert.ok(check > 0 && check < firstWrite, "worker check must come before applyDeliveryPlan");
});

async function seeded(): Promise<TestDb> {
  const db = await createTestDb();
  await ensureRuntimeColumns(db.sql);
  const ids = await seedUser(db.sql, "u1");
  await db.sql`insert into parties (user_id, name, kind) values (${"u1"}, ${"مشتری"}, ${"customer"})`;
  await db.sql`insert into expenses (user_id, title, amount, currency_id, account_id, occurred_on)
    values (${"u1"}, ${"کرایه"}, ${10}, ${ids.afnId}, ${ids.accountId}, ${"2026-01-01"})`;
  return db;
}
const count = async (db: TestDb, table: string) =>
  Number((await db.sql.query<{ n: number }>(`select count(*)::int as n from ${table} where user_id = $1`, ["u1"]))[0].n);

test("STR-03 bug: reset without a transaction leaves a half-empty workspace when a step fails", async () => {
  const db = await seeded();
  // Old code: each delete committed on its own; a failure afterwards (here
  // simulated) left the data deleted and the activity log muted.
  await assert.rejects(
    (async () => {
      await resetWorkspaceTx(db.sql, "u1");
      throw new Error("boom");
    })(),
  );
  assert.equal(await count(db, "expenses"), 0, "data already gone although the operation failed");
  await db.close();
});

test("STR-03 fix: a failing reset rolls back completely", async () => {
  const db = await seeded();
  await assert.rejects(
    db.tx(async (tx) => {
      await resetWorkspaceTx(tx, "u1");
      throw new Error("boom");
    }),
  );
  assert.equal(await count(db, "expenses"), 1);
  assert.equal(await count(db, "parties"), 1);
  assert.equal(await count(db, "activity_log_mute"), 0, "activity log is not left muted");
  await db.close();
});

test("STR-03 fix: a successful reset empties data, re-seeds defaults and unmutes the log", async () => {
  const db = await seeded();
  await db.tx((tx) => resetWorkspaceTx(tx, "u1"));
  assert.equal(await count(db, "expenses"), 0);
  assert.equal(await count(db, "parties"), 0);
  assert.ok((await count(db, "currencies")) > 0, "defaults seeded");
  assert.equal(await count(db, "activity_log_mute"), 0);
  assert.equal(await count(db, "profiles"), 1, "profile kept");
  await db.close();
});
