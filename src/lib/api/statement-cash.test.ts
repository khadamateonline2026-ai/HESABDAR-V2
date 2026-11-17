import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seedUser } from "@/lib/testing/pglite-db";
import { partyStatementTx } from "./reports";

const U = "user-stmt";

test("ACC-04: customer statement rows add up to the summary when cash is included in an invoice", async () => {
  const db = await createTestDb();
  const ids = await db.tx((sql) => seedUser(sql, U));
  const party = await db.sql<{ id: number }>`
    insert into parties (user_id, kind, name) values (${U}, ${"customer"}, ${"احمد"}) returning id
  `;
  const pid = party[0].id;
  const inv = await db.sql<{ id: number }>`
    insert into sale_invoices (user_id, invoice_no, customer_id, currency_id, occurred_on, cash_included_base)
    values (${U}, ${"F-1"}, ${pid}, ${ids.afnId}, ${"2026-11-01"}, ${50}) returning id
  `;
  await db.sql`
    insert into sales (user_id, invoice_id, customer_id, item_name, quantity, unit_price, currency_id, occurred_on, status)
    values (${U}, ${inv[0].id}, ${pid}, ${"پیراهن"}, ${2}, ${50}, ${ids.afnId}, ${"2026-11-01"}, ${"final"})
  `;
  const st = await partyStatementTx(db.sql, U, { kind: "customer", partyId: pid });
  const summary = st.summaries.find((s) => s.id === pid);
  assert.ok(summary);
  const rowsTotal = st.invoices.reduce((s, r) => s + r.totalBase, 0);
  // Before: summary 150 (100 goods + 50 cash included), rows 100.
  assert.equal(summary.invoicedBase, 150);
  assert.equal(st.invoiced, 150);
  assert.equal(rowsTotal, 150);
  assert.equal(st.remaining, summary.remainingBase);
  const cashRow = st.invoices.find((r) => r.id < 0);
  assert.ok(cashRow && cashRow.totalBase === 50 && /F-1/.test(cashRow.invoiceNo));
  await db.close();
});
