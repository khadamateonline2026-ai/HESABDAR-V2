import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, ensureRuntimeColumns, seedUser, type TestDb } from "@/lib/testing/pglite-db";
import { canView, canWrite } from "@/lib/permissions";
import { loadCatalogs } from "./helpers";
import { cashbookData } from "./cashbook";

const U = "user-cashbook";
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** AFN till (seeded, opening 0) + a USD till (opening 1000, rate 70), one entry of every source. */
async function seed(db: TestDb) {
  await ensureRuntimeColumns(db.sql);
  const ids = await seedUser(db.sql, U);
  const usd = (
    await db.sql<{ id: number }>`
      insert into accounts (user_id, name, currency_id, opening_balance) values (${U}, ${"صندوق دالر"}, ${ids.usdId}, ${1000}) returning id
    `
  )[0].id;
  const afn = ids.accountId;
  const party = async (kind: string, name: string) =>
    (await db.sql<{ id: number }>`insert into parties (user_id, kind, name) values (${U}, ${kind}, ${name}) returning id`)[0].id;
  const cust = await party("customer", "احمد");
  const vend = await party("vendor", "کریم");
  const worker = await party("worker", "محمود");
  // 01: opening cash 5000 AFN
  await db.sql`insert into opening_cash (user_id, account_id, currency_id, amount, occurred_on) values (${U}, ${afn}, ${ids.afnId}, ${5000}, ${"2026-11-01"})`;
  // 02: capital add 10 USD into AFN till (700), capital withdraw 100 AFN
  await db.sql`insert into capital_moves (user_id, kind, account_id, currency_id, amount, occurred_on) values (${U}, ${"add"}, ${afn}, ${ids.usdId}, ${10}, ${"2026-11-02"})`;
  await db.sql`insert into capital_moves (user_id, kind, account_id, currency_id, amount, occurred_on) values (${U}, ${"withdraw"}, ${afn}, ${ids.afnId}, ${100}, ${"2026-11-02"})`;
  // 03: sale invoice 1000, 600 received (credit 400), refund none
  const si = (
    await db.sql<{ id: number }>`
      insert into sale_invoices (user_id, invoice_no, customer_id, currency_id, occurred_on, received_amount, account_id)
      values (${U}, ${"S-1"}, ${cust}, ${ids.afnId}, ${"2026-11-03"}, ${600}, ${afn}) returning id
    `
  )[0].id;
  await db.sql`insert into sales (user_id, invoice_id, customer_id, item_name, quantity, unit_price, currency_id, occurred_on, status)
    values (${U}, ${si}, ${cust}, ${"پیراهن"}, ${2}, ${500}, ${ids.afnId}, ${"2026-11-03"}, ${"final"})`;
  await db.sql`insert into party_payments (user_id, party_id, kind, amount, currency_id, fx_rate, account_id, receipt_no, occurred_on, sale_invoice_id)
    values (${U}, ${cust}, ${"receipt"}, ${600}, ${ids.afnId}, ${1}, ${afn}, ${"S-1"}, ${"2026-11-03"}, ${si})`;
  // 03: change given back on another sale (refund 50)
  const si2 = (
    await db.sql<{ id: number }>`
      insert into sale_invoices (user_id, invoice_no, customer_id, currency_id, occurred_on, received_amount, refund_amount, account_id)
      values (${U}, ${"S-2"}, ${cust}, ${ids.afnId}, ${"2026-11-03"}, ${300}, ${50}, ${afn}) returning id
    `
  )[0].id;
  await db.sql`insert into sales (user_id, invoice_id, customer_id, item_name, quantity, unit_price, currency_id, occurred_on, status)
    values (${U}, ${si2}, ${cust}, ${"پیراهن"}, ${1}, ${250}, ${ids.afnId}, ${"2026-11-03"}, ${"final"})`;
  await db.sql`insert into party_payments (user_id, party_id, kind, amount, currency_id, fx_rate, account_id, receipt_no, occurred_on, sale_invoice_id)
    values (${U}, ${cust}, ${"receipt"}, ${300}, ${ids.afnId}, ${1}, ${afn}, ${"S-2"}, ${"2026-11-03"}, ${si2})`;
  await db.sql`insert into party_payments (user_id, party_id, kind, amount, currency_id, fx_rate, account_id, receipt_no, occurred_on, sale_invoice_id)
    values (${U}, ${cust}, ${"payment"}, ${50}, ${ids.afnId}, ${1}, ${afn}, ${"S-2"}, ${"2026-11-03"}, ${si2})`;
  // 04: standalone receipt 200 (receivable collected), standalone payment 70 to vendor
  await db.sql`insert into party_payments (user_id, party_id, kind, amount, currency_id, fx_rate, account_id, receipt_no, occurred_on)
    values (${U}, ${cust}, ${"receipt"}, ${200}, ${ids.afnId}, ${1}, ${afn}, ${"R-1"}, ${"2026-11-04"})`;
  await db.sql`insert into party_payments (user_id, party_id, kind, amount, currency_id, fx_rate, account_id, receipt_no, occurred_on)
    values (${U}, ${vend}, ${"payment"}, ${70}, ${ids.afnId}, ${1}, ${afn}, ${"P-1"}, ${"2026-11-04"})`;
  // 05: purchase 10 USD × 3 = 30 USD, paid 20 USD from the USD till (credit 10 USD = 700)
  const pi = (
    await db.sql<{ id: number }>`
      insert into purchase_invoices (user_id, invoice_no, vendor_id, currency_id, occurred_on, fx_enabled, fx_rate, paid_amount, account_id)
      values (${U}, ${"B-1"}, ${vend}, ${ids.usdId}, ${"2026-11-05"}, ${true}, ${70}, ${20}, ${usd}) returning id
    `
  )[0].id;
  await db.sql`insert into purchases (user_id, invoice_id, vendor_id, item_name, quantity, unit_price, currency_id, occurred_on, status)
    values (${U}, ${pi}, ${vend}, ${"پارچه"}, ${3}, ${10}, ${ids.usdId}, ${"2026-11-05"}, ${"final"})`;
  await db.sql`insert into party_payments (user_id, party_id, kind, amount, currency_id, account_id, receipt_no, occurred_on, purchase_invoice_id)
    values (${U}, ${vend}, ${"payment"}, ${20}, ${ids.usdId}, ${usd}, ${"B-1"}, ${"2026-11-05"}, ${pi})`;
  // 06: paid expense 150, expense as debt 999 (non-cash), worker payment 300
  await db.sql`insert into expenses (user_id, title, amount, currency_id, account_id, occurred_on) values (${U}, ${"کرایه"}, ${150}, ${ids.afnId}, ${afn}, ${"2026-11-06"})`;
  await db.sql`insert into expenses (user_id, title, amount, currency_id, account_id, occurred_on, as_debt) values (${U}, ${"برق"}, ${999}, ${ids.afnId}, ${afn}, ${"2026-11-06"}, ${true})`;
  await db.sql`insert into worker_payments (user_id, worker_id, amount, occurred_on, invoice_no, account_id, currency_id, fx_rate)
    values (${U}, ${worker}, ${300}, ${"2026-11-06"}, ${"W-1"}, ${afn}, ${ids.afnId}, ${1})`;
  // 07: transfer 5 USD from the USD till to the AFN till (= 350 AFN)
  await db.sql`insert into transfers (user_id, from_account_id, to_account_id, amount, occurred_on) values (${U}, ${usd}, ${afn}, ${5}, ${"2026-11-07"})`;
  return { ids, afn, usd };
}

test("روزنامچه دخل: opening + in − out equals the حساب‌ها balance for every account, over any split", async () => {
  const db = await createTestDb();
  const { afn, usd } = await seed(db);
  const balances = new Map((await loadCatalogs(db.sql, U)).accounts.map((a) => [a.id, a.balance]));
  const all = await cashbookData(db.sql, U, { from: "2000-01-01", to: "2100-01-01" });
  assert.equal(all.accounts.length, 2);
  for (const a of all.accounts) {
    assert.equal(r6(a.closing), r6(balances.get(a.accountId)!), a.name);
    assert.equal(r6(a.opening + a.totalIn - a.totalOut), r6(a.closing));
  }
  // AFN: 5000 + 700 − 100 + 600 + 300 − 50 + 200 − 70 − 150 − 300 + 350 = 6480
  assert.equal(r6(balances.get(afn)!), 6480);
  // USD: 1000 − 20 − 5 = 975
  assert.equal(r6(balances.get(usd)!), 975);
  // Any date split: first part's closing is the next part's opening, last closing = balance.
  for (const cut of ["2026-11-02", "2026-11-04", "2026-11-06"]) {
    const next = new Date(Date.parse(cut) + 86400000).toISOString().slice(0, 10);
    const a = await cashbookData(db.sql, U, { from: "2000-01-01", to: cut });
    const b = await cashbookData(db.sql, U, { from: next, to: "2100-01-01" });
    for (const acc of a.accounts) {
      const other = b.accounts.find((x) => x.accountId === acc.accountId)!;
      assert.equal(r6(acc.closing), r6(other.opening));
      assert.equal(r6(other.closing), r6(balances.get(acc.accountId)!));
    }
  }
  await db.close();
});

test("روزنامچه دخل: every source lands in its group with the right direction", async () => {
  const db = await createTestDb();
  const { afn } = await seed(db);
  const d = await cashbookData(db.sql, U, { from: "2026-11-01", to: "2026-11-07" });
  const g = Object.fromEntries(d.groups.map((x) => [x.group, [r6(x.baseIn), r6(x.baseOut)]]));
  assert.deepEqual(g.opening, [5000, 0]);
  assert.deepEqual(g.capital_in, [700, 0]);
  assert.deepEqual(g.capital_out, [0, 100]);
  assert.deepEqual(g.sale_receipt, [900, 0]);
  assert.deepEqual(g.sale_refund, [0, 50]);
  assert.deepEqual(g.receipt, [200, 0]);
  assert.deepEqual(g.payment, [0, 70]);
  assert.deepEqual(g.purchase_payment, [0, 1400]);
  assert.deepEqual(g.expense, [0, 150]);
  assert.deepEqual(g.worker, [0, 300]);
  // Internal transfer: shown as its own group and counted on both sides.
  assert.deepEqual(g.transfer, [350, 350]);
  assert.equal(r6(d.totals.baseIn), 5000 + 700 + 900 + 200 + 350);
  assert.equal(r6(d.totals.baseOut), 100 + 50 + 70 + 1400 + 150 + 300 + 350);
  // Ordered by date, then type, then id.
  const dates = d.movements.map((m) => m.date);
  assert.deepEqual(dates, [...dates].sort());
  // Single-day view (default today) and a single-account filter with running balance.
  const day = await cashbookData(db.sql, U, { from: "2026-11-03", to: "2026-11-03", accountId: afn });
  assert.equal(day.accounts.length, 1);
  assert.equal(r6(day.accounts[0].opening), 5600);
  assert.equal(r6(day.accounts[0].closing), 6450);
  assert.equal(r6(day.movements.at(-1)!.running!), 6450);
  // Currency filter: only USD accounts.
  const usdOnly = await cashbookData(db.sql, U, { from: "2026-11-01", to: "2026-11-07", currencyId: d.accounts.find((a) => a.currencySymbol === "$")!.currencyId });
  assert.deepEqual(usdOnly.accounts.map((a) => a.name), ["صندوق دالر"]);
  await db.close();
});

test("روزنامچه دخل: non-cash items are listed for information only and never enter cash totals", async () => {
  const db = await createTestDb();
  await seed(db);
  const d = await cashbookData(db.sql, U, { from: "2026-11-01", to: "2026-11-07" });
  const nc = Object.fromEntries(d.nonCash.map((r) => [r.kind + ":" + r.docNo, r6(r.amountBase)]));
  assert.equal(nc["credit_sale:S-1"], 400);
  assert.equal(nc["credit_purchase:B-1"], 700);
  assert.equal(nc["debt_expense:برق"], 999);
  assert.equal(nc["credit_sale:S-2"], undefined); // fully paid
  assert.ok(!d.movements.some((m) => /برق/.test(m.description)), "debt expense is not a cash movement");
  const inSum = d.movements.reduce((s, m) => s + m.baseIn, 0);
  const outSum = d.movements.reduce((s, m) => s + m.baseOut, 0);
  assert.equal(r6(inSum), r6(d.totals.baseIn));
  assert.equal(r6(outSum), r6(d.totals.baseOut));
  await db.close();
});

test("روزنامچه دخل: rejects a reversed or invalid range", async () => {
  const db = await createTestDb();
  await seed(db);
  await assert.rejects(cashbookData(db.sql, U, { from: "2026-11-05", to: "2026-11-01" }));
  await assert.rejects(cashbookData(db.sql, U, { from: "x", to: "2026-11-01" }));
  await db.close();
});

test("روزنامچه دخل: seller, accountant and supervisor can open it; no other access changes", () => {
  for (const role of ["seller", "accountant", "supervisor"] as const) assert.ok(canView(role, "reports"));
  // Read-only for everyone except as before: the report itself never writes.
  assert.equal(canWrite("seller", "reports"), false);
  assert.equal(canWrite("supervisor", "reports"), false);
  const api = readFileSync(join(process.cwd(), "src/lib/api/cashbook.ts"), "utf8");
  assert.ok(api.includes("await requireProfile(sql, context.userId)"), "server fn must allow every signed-in role");
  assert.ok(!/\b(insert|update|delete)\s+(into|from)?\s*\w+/i.test(api.replace(/\/\*[\s\S]*?\*\//g, "")), "read-only");
  const route = readFileSync(join(process.cwd(), "src/routes/_app/reports.daily.tsx"), "utf8");
  assert.ok(route.includes('createFileRoute("/_app/reports/daily")'));
  const layout = readFileSync(join(process.cwd(), "src/routes/_app/reports.tsx"), "utf8");
  assert.ok(layout.includes('{ to: "/reports/daily", label: "روزنامچه دخل" }'));
  assert.ok(layout.includes('<Guard area="reports">'), "other reports keep their existing guard");
});
