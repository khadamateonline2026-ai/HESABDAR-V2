import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, ensureRuntimeColumns, seedUser, type TestDb } from "@/lib/testing/pglite-db";
import { dumpWorkspace, restoreWorkspaceTx, WORKSPACE_TABLES } from "./helpers";
import { assertRestoreConfirmed, RESTORE_CONFIRM, validateWorkspaceBackup } from "@/lib/backup-validate";

async function freshDb(): Promise<TestDb> {
  const db = await createTestDb();
  await ensureRuntimeColumns(db.sql);
  return db;
}

async function workspaceWithData(db: TestDb, userId: string) {
  const ids = await seedUser(db.sql, userId);
  await db.sql`insert into parties (user_id, kind, name) values (${userId}, 'customer', 'احمد')`;
  await db.sql`insert into parties (user_id, kind, name) values (${userId}, 'vendor', 'کریم')`;
  return ids;
}

const count = async (db: TestDb, table: string, userId: string) =>
  Number((await db.sql.query<{ n: number }>(`select count(*) as n from ${table} where user_id = $1`, [userId]))[0].n);

test("STR-02 bug: an empty `{tables:{}}` file is refused before anything is deleted", async () => {
  // Old code accepted this and issued DELETE on all 36 workspace tables.
  assert.throws(() => validateWorkspaceBackup({ version: 1, tables: {} }, WORKSPACE_TABLES), /پشتیبان ناقص است/);
  assert.throws(() => validateWorkspaceBackup({ tables: {} }, WORKSPACE_TABLES), /نسخه فایل پشتیبان/);
});

test("STR-02: a backup missing one table is refused and names the table", async () => {
  const db = await freshDb();
  await workspaceWithData(db, "u1");
  const dump = await dumpWorkspace(db.sql, "u1");
  const partial = { ...dump, tables: { ...dump.tables } } as Record<string, unknown> & { tables: Record<string, unknown> };
  delete partial.tables.party_payments;
  assert.throws(() => validateWorkspaceBackup(partial, WORKSPACE_TABLES), /party_payments/);
  await db.close();
});

test("STR-02: a truncated file (rows lost vs. its manifest) is refused", async () => {
  const db = await freshDb();
  await workspaceWithData(db, "u1");
  const dump = await dumpWorkspace(db.sql, "u1");
  const truncated = { ...dump, tables: { ...dump.tables, parties: dump.tables.parties.slice(0, 1) } };
  assert.throws(() => validateWorkspaceBackup(truncated, WORKSPACE_TABLES), /تعداد ردیف‌ها.*parties/);
  await db.close();
});

test("STR-02: a workspace with no currency at all is treated as empty and refused", () => {
  const tables = Object.fromEntries(WORKSPACE_TABLES.map((t) => [t, []]));
  assert.throws(() => validateWorkspaceBackup({ version: 1, tables }, WORKSPACE_TABLES), /خالی/);
});

test("STR-02: full replace must be confirmed explicitly", () => {
  assert.throws(() => assertRestoreConfirmed(undefined), /صریحاً تأیید/);
  assertRestoreConfirmed(RESTORE_CONFIRM);
});

test("STR-02: valid restore replaces data, keeps an automatic snapshot, all in one transaction", async () => {
  const db = await freshDb();
  await workspaceWithData(db, "u1");
  const backup = validateWorkspaceBackup(JSON.parse(JSON.stringify(await dumpWorkspace(db.sql, "u1"))), WORKSPACE_TABLES);
  await db.sql`insert into parties (user_id, kind, name) values ('u1', 'other', 'بعد از پشتیبان')`;
  const res = await db.tx((tx) => restoreWorkspaceTx(tx, "u1", backup));
  assert.equal(await count(db, "parties", "u1"), 2, "back to the backup's 2 contacts");
  const snap = await db.sql<{ label: string; payload: string }>`select label, payload from data_backups where id = ${res.snapshotId}`;
  assert.match(snap[0].label, /خودکار پیش از بازیابی/);
  const snapParties = (JSON.parse(snap[0].payload) as { tables: { parties: unknown[] } }).tables.parties;
  assert.equal(snapParties.length, 3, "snapshot holds the data as it was just before the restore");
  await db.close();
});

test("STR-02: a failure mid-restore rolls everything back (no data lost, no snapshot left)", async () => {
  const db = await freshDb();
  await workspaceWithData(db, "u1");
  const dump = JSON.parse(JSON.stringify(await dumpWorkspace(db.sql, "u1")));
  dump.tables.parties[1].kind = null; // violates NOT NULL during insert
  dump.manifest = undefined;
  const backup = validateWorkspaceBackup(dump, WORKSPACE_TABLES);
  await assert.rejects(db.tx((tx) => restoreWorkspaceTx(tx, "u1", backup)));
  assert.equal(await count(db, "parties", "u1"), 2);
  assert.equal(await count(db, "currencies", "u1"), 2);
  assert.equal(await count(db, "data_backups", "u1"), 0);
  await db.close();
});

test("STR-02: restoring into a fresh database moves id sequences so new rows don't collide", async () => {
  const src = await freshDb();
  await workspaceWithData(src, "u1");
  const backup = validateWorkspaceBackup(JSON.parse(JSON.stringify(await dumpWorkspace(src.sql, "u1"))), WORKSPACE_TABLES);
  await src.close();
  const dst = await freshDb();
  await dst.sql`insert into profiles (user_id, display_name, role) values ('u1', 't', 'accountant')`;
  await dst.tx((tx) => restoreWorkspaceTx(tx, "u1", backup));
  // Without advancing the sequence this would reuse id 1 and fail.
  await dst.sql`insert into parties (user_id, kind, name) values ('u1', 'other', 'جدید')`;
  await dst.sql`insert into currencies (user_id, name, symbol, rate_to_base) values ('u1', 'یورو', '€', 75)`;
  assert.equal(await count(dst, "parties", "u1"), 3);
  await dst.close();
});
