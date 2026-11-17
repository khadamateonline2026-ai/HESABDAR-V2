import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, seedUser } from "@/lib/testing/pglite-db";
import { INSUFFICIENT_CASH, assertCashAvailable, loadAccountBalances, loadCatalogs } from "./helpers";

test("STR-08 bug: every cash check loaded the whole catalog (items, parties, units…)", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/api/helpers.ts"), "utf8");
  const start = src.indexOf("export async function assertCashAvailable(");
  const body = src.slice(start, src.indexOf("\nexport ", start + 1));
  assert.doesNotMatch(body, /loadCatalogs\(/);
  assert.match(body, /loadAccountBalances\(/);
});

test("STR-08: the light balance load matches the catalog balances, and the check still works", async () => {
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, "u1"));
  await db.sql`insert into opening_cash (user_id, account_id, amount, currency_id, occurred_on)
    values ('u1', ${ids.accountId}, ${500}, ${ids.afnId}, ${"2026-01-01"})`;
  const light = await loadAccountBalances(db.sql, "u1");
  const full = (await loadCatalogs(db.sql, "u1")).accounts;
  assert.deepEqual(light.accounts, full);
  await assertCashAvailable(db.sql, "u1", { accountId: ids.accountId, amount: 500, amountRate: 1 });
  await assert.rejects(
    assertCashAvailable(db.sql, "u1", { accountId: ids.accountId, amount: 501, amountRate: 1 }),
    new RegExp(INSUFFICIENT_CASH),
  );
  await db.close();
});
