import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seedUser } from "@/lib/testing/pglite-db";
import { splitPartyBalances } from "@/lib/kpi";
import { salesLedgerData } from "./reports";

const U = "user-kpi";

test("ACC-12 bug: the sales ledger re-valued old invoices at today's exchange rate", async () => {
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, U));
  const it = await db.sql<{ id: number }>`insert into items (user_id, name, kind) values (${U}, ${"پیراهن"}, ${"product"}) returning id`;
  const inv = await db.sql<{ id: number }>`
    insert into sale_invoices (user_id, invoice_no, currency_id, occurred_on, fx_enabled, fx_rate)
    values (${U}, ${"S-1"}, ${ids.usdId}, ${"2026-01-01"}, ${true}, ${65}) returning id
  `;
  await db.sql`insert into sales (user_id, invoice_id, item_id, item_name, quantity, unit_price, currency_id, occurred_on, status)
    values (${U}, ${inv[0].id}, ${it[0].id}, ${"پیراهن"}, ${2}, ${10}, ${ids.usdId}, ${"2026-01-01"}, ${"final"})`;
  await db.sql`update currencies set rate_to_base = ${80} where id = ${ids.usdId}`;
  const res = await salesLedgerData(db.sql, U, it[0].id);
  // Frozen invoice rate 65: 2 × 10 × 65 = 1300 (old code: today's 80 → 1600).
  assert.equal(res.rows[0].totalBase, 1300);
  assert.equal(res.summary?.amountSold, 1300);
  await db.close();
});

test("ACC-12: customer advances are reported, not dropped", () => {
  const r = splitPartyBalances([{ remainingBase: 500 }, { remainingBase: -200 }, { remainingBase: 0 }]);
  // Old dashboard only summed the positive side; the 200 advance disappeared.
  assert.deepEqual(r, { owedToUs: 500, heldForThem: 200 });
});
