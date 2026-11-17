import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, seedUser } from "@/lib/testing/pglite-db";
import { readInSnapshot } from "@/lib/db-snapshot";
import { driveOutcome, readSnapshotTables } from "@/lib/backup-read";

test("STR-06 bug: backups read table by table with no snapshot (inconsistent copies)", () => {
  const ws = readFileSync(join(process.cwd(), "src/lib/api/workspace.ts"), "utf8");
  for (const name of ["exportWorkspace", "saveOnlineBackup"]) {
    const start = ws.indexOf(`export const ${name} =`);
    const body = ws.slice(start, ws.indexOf("\nexport ", start + 1));
    assert.match(body, /dumpWorkspaceConsistent\(/, `${name} must read in one snapshot`);
  }
  const drive = readFileSync(join(process.cwd(), "src/lib/api/drive-backup.ts"), "utf8");
  assert.match(drive, /withReadSnapshot\(/);
});

test("STR-06: reads run in one REPEATABLE READ, read-only transaction", async () => {
  const db = await createTestDb();
  const r = await db.tx((tx) =>
    readInSnapshot(tx, async (sql) => {
      const iso = await sql<{ transaction_isolation: string }>`show transaction_isolation`;
      const ro = await sql<{ transaction_read_only: string }>`show transaction_read_only`;
      return [iso[0].transaction_isolation, ro[0].transaction_read_only];
    }),
  );
  assert.deepEqual(r, ["repeatable read", "on"]);
  await db.close();
});

test("STR-06: a missing table is reported, not swallowed, and the rest is still read", async () => {
  const db = await createTestDb();
  await db.tx((sql) => seedUser(sql, "u1"));
  const r = await db.tx((tx) => readInSnapshot(tx, (sql) => readSnapshotTables(sql, "u1", ["currencies", "no_such_table"])));
  assert.equal(r.tables.currencies.length, 2);
  assert.deepEqual(r.missingTables, ["no_such_table"]);
  await db.close();
});

test("STR-06 bug: a Drive upload with failures was reported as success", () => {
  const partial = driveOutcome(["a.json"], ["b.csv"], []);
  assert.equal(partial.ok, false);
  assert.equal(partial.partial, true);
  assert.match(partial.message, /ناقص/);
  assert.equal(driveOutcome(["a.json"], [], ["x"]).ok, false, "missing tables also make it partial");
  assert.equal(driveOutcome(["a.json", "b.csv"], [], []).ok, true);
  assert.equal(driveOutcome([], [], []).partial, false);
});
