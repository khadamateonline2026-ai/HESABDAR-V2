import type { Sql } from "@/lib/db";

/**
 * Keeps the single payment/receipt row that belongs to an invoice
 * (party_payments.purchase_invoice_id / sale_invoice_id) in step with the
 * invoice header. Shared by purchase and sale invoices.
 */
export async function syncLinkedPayment(
  sql: Sql,
  args: {
    userId: string;
    kind: "payment" | "receipt";
    partyId: number | null;
    amount: number;
    currencyId: number;
    fxRate?: number;
    accountId: number | null;
    occurredOn: string;
    purchaseInvoiceId?: number | null;
    saleInvoiceId?: number | null;
    label: string;
  },
) {
  const payFx = args.fxRate && args.fxRate > 0 ? args.fxRate : 0;
  const existing = args.purchaseInvoiceId
    ? await sql<{ id: number }>`
        select id from party_payments
        where user_id = ${args.userId} and purchase_invoice_id = ${args.purchaseInvoiceId} and kind = ${args.kind}
      `
    : await sql<{ id: number }>`
        select id from party_payments
        where user_id = ${args.userId} and sale_invoice_id = ${args.saleInvoiceId} and kind = ${args.kind}
      `;
  // ACC-05: money paid or received on an invoice moves cash even when no
  // vendor/customer is chosen (walk-in cash purchase or sale). The linked row
  // then has party_id NULL (migration 0028), so the account balance — which is
  // computed from party_payments — still drops/rises; it simply belongs to no
  // contact's ledger. Only a zero amount removes the linked row.
  if (args.amount <= 0) {
    if (existing[0]) {
      await sql`delete from party_payments where id = ${existing[0].id} and user_id = ${args.userId}`;
    }
    return;
  }
  if (existing[0]) {
    await sql`
      update party_payments set
        party_id = ${args.partyId ?? null}, amount = ${args.amount}, currency_id = ${args.currencyId},
        fx_rate = ${payFx}, account_id = ${args.accountId}, occurred_on = ${args.occurredOn}, notes = ${args.label}
      where id = ${existing[0].id} and user_id = ${args.userId}
    `;
    return;
  }
  const rows = await sql<{ id: number }>`
    insert into party_payments (
      user_id, party_id, kind, amount, currency_id, fx_rate, account_id, receipt_no, occurred_on, notes,
      purchase_invoice_id, sale_invoice_id
    ) values (
      ${args.userId}, ${args.partyId ?? null}, ${args.kind}, ${args.amount}, ${args.currencyId}, ${payFx}, ${args.accountId},
      ${"موقت"}, ${args.occurredOn}, ${args.label}, ${args.purchaseInvoiceId ?? null}, ${args.saleInvoiceId ?? null}
    ) returning id
  `;
  const receipt = `ق-${rows[0].id}`;
  await sql`update party_payments set receipt_no = ${receipt} where id = ${rows[0].id}`;
}
