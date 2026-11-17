import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, ensureRuntimeColumns, seedUser, applyMigrations, type TestDb } from "@/lib/testing/pglite-db";
import { loadCatalogs } from "./helpers";

type Ids = Awaited<ReturnType<typeof seedUser>>;

/** AFN till (seeded) + a USD till; USD rate starts at 70. */
async function setup(db: TestDb) {
  await ensureRuntimeColumns(db.sql);
  const ids = await seedUser(db.sql, "u1");
  const usdAcc = await db.sql<{ id: number }>`
    insert into accounts (user_id, name, currency_id, opening_balance) values (${"u1"}, ${"صندوق دالر"}, ${ids.usdId}, ${1000}) returning id
  `;
  return { ...ids, usdAccountId: usdAcc[0].id };
}

async function postHistory(db: TestDb, ids: Ids & { usdAccountId: number }) {
  // 100 USD moved from the USD till to the AFN till (worth 7000 AFN today).
  await db.sql`insert into transfers (user_id, from_account_id, to_account_id, amount, occurred_on)
    values (${"u1"}, ${ids.usdAccountId}, ${ids.accountId}, ${100}, ${"2026-01-01"})`;
  // 7000 AFN customer receipt into the USD till (= 100 USD today).
  const p = await db.sql<{ id: number }>`insert into parties (user_id, name, kind) values (${"u1"}, ${"مشتری"}, ${"customer"}) returning id`;
  await db.sql`insert into party_payments (user_id, party_id, kind, amount, currency_id, fx_rate, account_id, receipt_no, occurred_on)
    values (${"u1"}, ${p[0].id}, ${"receipt"}, ${7000}, ${ids.afnId}, ${1}, ${ids.usdAccountId}, ${"R-1"}, ${"2026-01-02"})`;
  // 10 USD paid expense from the AFN till (= 700 AFN today).
  await db.sql`insert into expenses (user_id, title, amount, currency_id, account_id, occurred_on)
    values (${"u1"}, ${"کرایه"}, ${10}, ${ids.usdId}, ${ids.accountId}, ${"2026-01-03"})`;
  // 5 USD capital added to the AFN till (= 350 AFN today).
  await db.sql`insert into capital_moves (user_id, kind, account_id, currency_id, amount, occurred_on)
    values (${"u1"}, ${"add"}, ${ids.accountId}, ${ids.usdId}, ${5}, ${"2026-01-04"})`;
}

const balances = async (db: TestDb) => {
  const accs = (await loadCatalogs(db.sql, "u1")).accounts;
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return Object.fromEntries(accs.map((a) => [a.name, round(a.balance)]));
};
// AFN: +7000 transfer − 700 expense + 350 capital = 6650; USD: 1000 − 100 + 100 = 1000.
const EXPECTED = { "صندوق": 6650, "صندوق دالر": 1000 };

async function stripSnapshots(db: TestDb) {
  // Simulate the pre-fix world: no stored rates, so only today's rate exists.
  for (const t of ["transfers", "capital_moves", "opening_cash", "expenses", "party_payments", "worker_payments"]) {
    await db.sql.query(`alter table ${t} disable trigger user`);
  }
  await db.sql`update transfers set from_rate = null, to_rate = null`;
  await db.sql`update expenses set fx_rate = null, account_rate = null`;
  await db.sql`update capital_moves set fx_rate = null, account_rate = null`;
  await db.sql`update party_payments set account_rate = null`;
}

test("ACC-01 bug: without stored rates, changing today's USD rate rewrote past balances", async () => {
  const db = await createTestDb();
  const ids = await setup(db);
  await postHistory(db, ids);
  await stripSnapshots(db);
  assert.deepEqual(await balances(db), EXPECTED);
  await db.sql`update currencies set rate_to_base = 80 where id = ${ids.usdId}`;
  const after = await balances(db);
  assert.notDeepEqual(after, EXPECTED, "old behaviour re-valued history with the new rate");
  assert.equal(after["صندوق"], 8000 - 800 + 400);
  assert.equal(after["صندوق دالر"], 987.5);
  await db.close();
});

test("ACC-01 fix: rates are frozen at posting time, editing a rate later does not move history", async () => {
  const db = await createTestDb();
  const ids = await setup(db);
  await postHistory(db, ids);
  assert.deepEqual(await balances(db), EXPECTED);
  await db.sql`update currencies set rate_to_base = 80 where id = ${ids.usdId}`;
  assert.deepEqual(await balances(db), EXPECTED);
  // A new transfer after the change uses the new rate (100 USD = 8000 AFN).
  await db.sql`insert into transfers (user_id, from_account_id, to_account_id, amount, occurred_on)
    values (${"u1"}, ${ids.usdAccountId}, ${ids.accountId}, ${100}, ${"2026-02-01"})`;
  const now = await balances(db);
  assert.equal(now["صندوق"], 6650 + 8000);
  assert.equal(now["صندوق دالر"], 900);
  await db.close();
});

test("ACC-01 fix: editing a row keeps its rate unless its currency/account changes", async () => {
  const db = await createTestDb();
  const ids = await setup(db);
  await db.sql`insert into expenses (user_id, title, amount, currency_id, account_id, occurred_on)
    values (${"u1"}, ${"x"}, ${10}, ${ids.usdId}, ${ids.accountId}, ${"2026-01-03"})`;
  await db.sql`update currencies set rate_to_base = 80 where id = ${ids.usdId}`;
  await db.sql`update expenses set amount = 20, notes = 'edit' where user_id = 'u1'`;
  let row = (await db.sql<{ fx_rate: unknown }>`select fx_rate from expenses`)[0];
  assert.equal(Number(row.fx_rate), 70, "amount edit keeps the original rate");
  await db.sql`update expenses set currency_id = ${ids.afnId} where user_id = 'u1'`;
  row = (await db.sql<{ fx_rate: unknown }>`select fx_rate from expenses`)[0];
  assert.equal(Number(row.fx_rate), 1, "currency change takes that currency's rate");
  await db.close();
});

test("ACC-01 migration: backfill uses the current rate, so today's numbers do not change", async () => {
  const db = await createTestDb({ upTo: "0028_cash_payment_without_party.sql" });
  const ids = await setup(db);
  await postHistory(db, ids);
  // Rows saved before 0029 have no rate columns; the app showed EXPECTED for them.
  await applyMigrations(db.pg);
  const before = await balances(db);
  assert.deepEqual(before, EXPECTED);
  const nulls = await db.sql<{ n: number }>`
    select (select count(*) from transfers where from_rate is null or to_rate is null)
      + (select count(*) from expenses where fx_rate is null or account_rate is null)
      + (select count(*) from capital_moves where fx_rate is null or account_rate is null)
      + (select count(*) from party_payments where account_rate is null) as n
  `;
  assert.equal(Number(nulls[0].n), 0);
  // The technical backfill must not flood the activity history with edits.
  const edits = await db.sql<{ n: number }>`select count(*)::int as n from activity_log where action = 'ویرایش'`;
  assert.equal(Number(edits[0].n), 0);
  const muted = await db.sql<{ n: number }>`select count(*)::int as n from activity_log_mute`;
  assert.equal(Number(muted[0].n), 0);
  await db.sql`update currencies set rate_to_base = 80 where id = ${ids.usdId}`;
  assert.deepEqual(await balances(db), before);
  await db.close();
});
