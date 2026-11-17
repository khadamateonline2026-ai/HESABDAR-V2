import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, ensureRuntimeColumns, seedUser, type TestDb } from "@/lib/testing/pglite-db";
import { restoreWorkspaceTx, WORKSPACE_TABLES } from "./helpers";
import { validateWorkspaceBackup } from "@/lib/backup-validate";
import { RESET_SNAPSHOT_PREFIX, resetWorkspaceTx } from "./workspace";

async function seeded(): Promise<TestDb> {
  const db = await createTestDb();
  await ensureRuntimeColumns(db.sql);
  const ids = await seedUser(db.sql, "u1");
  await db.sql`insert into parties (user_id, name, kind) values ('u1', 'مشتری قدیمی', 'customer')`;
  await db.sql`insert into expenses (user_id, title, amount, currency_id, account_id, occurred_on)
    values ('u1', 'کرایه', 10, ${ids.afnId}, ${ids.accountId}, '2026-01-01')`;
  return db;
}
const count = async (db: TestDb, table: string) =>
  Number((await db.sql.query<{ n: number }>(`select count(*)::int as n from ${table} where user_id = 'u1'`, []))[0].n);

test("reset-backup bug: reset all data used to leave no copy behind", async () => {
  // Pre-fix resetWorkspaceData deleted every table without saving anything:
  // this is the state the old code produced (no data_backups row).
  const db = await seeded();
  assert.equal(await count(db, "data_backups"), 0);
  await db.close();
});

test("reset-backup fix: reset saves a full automatic copy first, and it restores", async () => {
  const db = await seeded();
  const { snapshotId } = await db.tx((tx) => resetWorkspaceTx(tx, "u1"));
  assert.equal(await count(db, "expenses"), 0);
  const snap = await db.sql<{ label: string; payload: string }>`select label, payload from data_backups where id = ${snapshotId}`;
  assert.ok(snap[0].label.startsWith(RESET_SNAPSHOT_PREFIX));
  const backup = validateWorkspaceBackup(JSON.parse(snap[0].payload), WORKSPACE_TABLES);
  await db.tx((tx) => restoreWorkspaceTx(tx, "u1", backup));
  assert.equal(await count(db, "expenses"), 1);
  const p = await db.sql<{ name: string }>`select name from parties where user_id = 'u1'`;
  assert.ok(p.some((r) => r.name === "مشتری قدیمی"));
  await db.close();
});

test("reset-backup fix: a failed reset keeps neither the deletes nor a stray snapshot", async () => {
  const db = await seeded();
  await assert.rejects(db.tx(async (tx) => {
    await resetWorkspaceTx(tx, "u1");
    throw new Error("boom");
  }));
  assert.equal(await count(db, "expenses"), 1);
  assert.equal(await count(db, "data_backups"), 0);
  await db.close();
});
