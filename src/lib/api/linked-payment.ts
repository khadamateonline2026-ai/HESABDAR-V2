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

/**
 * ACC-03 — a payment/receipt row created BY an invoice (purchase payment, sale
 * receipt) is the cash side of that invoice. Editing or deleting it from the
 * payments/statement screens must change the invoice header in the same
 * transaction, otherwise the invoice stays "paid" while the cash is gone (or
 * the other way round).
 */
export type LinkedPayment = {
  id: number;
  kind: "payment" | "receipt";
  partyId: number | null;
  currencyId: number;
  purchaseInvoiceId: number | null;
  saleInvoiceId: number | null;
};

export async function loadLinkedPayment(sql: Sql, userId: string, id: number): Promise<LinkedPayment | null> {
  const rows = await sql<Record<string, unknown>>`
    select id, kind, party_id, currency_id, purchase_invoice_id, sale_invoice_id
    from party_payments where id = ${id} and user_id = ${userId}
  `;
  const r = rows[0];
  if (!r || (r.purchase_invoice_id == null && r.sale_invoice_id == null)) return null;
  return {
    id: Number(r.id),
    kind: r.kind === "payment" ? "payment" : "receipt",
    partyId: r.party_id == null ? null : Number(r.party_id),
    currencyId: Number(r.currency_id),
    purchaseInvoiceId: r.purchase_invoice_id == null ? null : Number(r.purchase_invoice_id),
    saleInvoiceId: r.sale_invoice_id == null ? null : Number(r.sale_invoice_id),
  };
}

const EDIT_ON_INVOICE = "برای این تغییر، خود فاکتور را ویرایش کنید";

async function saleRefund(sql: Sql, userId: string, saleInvoiceId: number): Promise<number> {
  await sql.query("alter table sale_invoices add column if not exists refund_amount double precision not null default 0");
  const rows = await sql<{ refund_amount: unknown }>`
    select refund_amount from sale_invoices where id = ${saleInvoiceId} and user_id = ${userId}
  `;
  return Number(rows[0]?.refund_amount ?? 0) || 0;
}

/**
 * Edit of an invoice-linked row. Contact, direction and (for purchases) the
 * currency are fixed by the invoice; amount, account, date and notes may change
 * and are written to both the row and the invoice header. Run inside a transaction.
 */
export async function updateLinkedPayment(
  tx: Sql,
  userId: string,
  linked: LinkedPayment,
  edit: {
    partyId: number | null;
    kind: "payment" | "receipt";
    amount: number;
    currencyId: number;
    fxRate: number;
    accountId: number | null;
    occurredOn: string;
    notes: string;
  },
): Promise<void> {
  if (edit.kind !== linked.kind) throw new Error(`نوع این ردیف را نمی‌توان عوض کرد؛ ${EDIT_ON_INVOICE}`);
  if ((edit.partyId ?? null) !== linked.partyId) {
    throw new Error(`طرف حساب این ردیف از فاکتور می‌آید؛ ${EDIT_ON_INVOICE}`);
  }
  if (edit.amount <= 0) throw new Error("مبلغ باید بزرگ‌تر از صفر باشد؛ برای حذف، دکمه حذف را بزنید");
  if (edit.accountId == null) throw new Error("حساب را انتخاب کنید");
  if (linked.purchaseInvoiceId != null) {
    if (edit.currencyId !== linked.currencyId) throw new Error(`ارز پرداخت فاکتور خرید ثابت است؛ ${EDIT_ON_INVOICE}`);
    await tx`
      update party_payments set amount = ${edit.amount}, account_id = ${edit.accountId},
        occurred_on = ${edit.occurredOn}, notes = ${edit.notes}
      where id = ${linked.id} and user_id = ${userId}
    `;
    await tx`
      update purchase_invoices set paid_amount = ${edit.amount}, account_id = ${edit.accountId}
      where id = ${linked.purchaseInvoiceId} and user_id = ${userId}
    `;
    return;
  }
  const saleId = linked.saleInvoiceId!;
  if (linked.kind === "payment" || (await saleRefund(tx, userId, saleId)) > 1e-9) {
    throw new Error(`این ردیف با بازپرداخت فاکتور فروش گره خورده است؛ ${EDIT_ON_INVOICE}`);
  }
  await tx.query("alter table sale_invoices add column if not exists received_fx_rate double precision not null default 0");
  await tx`
    update party_payments set amount = ${edit.amount}, currency_id = ${edit.currencyId}, fx_rate = ${edit.fxRate},
      account_id = ${edit.accountId}, occurred_on = ${edit.occurredOn}, notes = ${edit.notes}
    where id = ${linked.id} and user_id = ${userId}
  `;
  await tx`
    update sale_invoices set received_amount = ${edit.amount}, received_fx_rate = ${edit.fxRate}, account_id = ${edit.accountId}
    where id = ${saleId} and user_id = ${userId}
  `;
}

/** Delete of an invoice-linked row: the invoice becomes unpaid by that amount. Run inside a transaction. */
export async function deleteLinkedPayment(tx: Sql, userId: string, linked: LinkedPayment): Promise<void> {
  if (linked.purchaseInvoiceId != null) {
    await tx`delete from party_payments where id = ${linked.id} and user_id = ${userId}`;
    await tx`update purchase_invoices set paid_amount = 0 where id = ${linked.purchaseInvoiceId} and user_id = ${userId}`;
    return;
  }
  const saleId = linked.saleInvoiceId!;
  if (linked.kind === "payment" || (await saleRefund(tx, userId, saleId)) > 1e-9) {
    throw new Error(`این ردیف با بازپرداخت فاکتور فروش گره خورده است؛ ${EDIT_ON_INVOICE}`);
  }
  await tx.query("alter table sale_invoices add column if not exists received_fx_rate double precision not null default 0");
  await tx`delete from party_payments where id = ${linked.id} and user_id = ${userId}`;
  await tx`
    update sale_invoices set received_amount = 0, received_fx_rate = 0
    where id = ${saleId} and user_id = ${userId}
  `;
}
