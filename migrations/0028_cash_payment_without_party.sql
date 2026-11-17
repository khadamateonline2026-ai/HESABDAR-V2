-- ACC-05: a purchase (or sale) paid in cash without choosing a vendor/customer
-- must still move the cash account. The invoice's linked payment row is now
-- allowed to have no contact (party_id NULL): the account balance, which is
-- computed from party_payments, then reflects the money; no contact ledger
-- does, because there is no contact.
alter table party_payments alter column party_id drop not null;

-- Backfill invoices saved before this fix: paid/received amount > 0, no contact,
-- an account chosen, and no linked row yet. Same values the app now writes.
insert into party_payments (
  user_id, party_id, kind, amount, currency_id, account_id, receipt_no, occurred_on, notes, purchase_invoice_id
)
select
  i.user_id, null, 'payment', i.paid_amount, i.currency_id, i.account_id,
  'ق-' || i.invoice_no, i.occurred_on, 'پرداخت فاکتور ' || i.invoice_no, i.id
from purchase_invoices i
where i.paid_amount > 0 and i.vendor_id is null and i.account_id is not null
  and not exists (
    select 1 from party_payments p where p.purchase_invoice_id = i.id and p.kind = 'payment'
  );

-- Sales: the received money is in the account's currency at the invoice's
-- received rate (received_fx_rate is added at runtime on older databases, so
-- only use it when the column exists).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'sale_invoices' and column_name = 'received_fx_rate'
  ) then
    execute $q$
      insert into party_payments (
        user_id, party_id, kind, amount, currency_id, fx_rate, account_id, receipt_no, occurred_on, notes, sale_invoice_id
      )
      select
        i.user_id, null, 'receipt', i.received_amount, a.currency_id, coalesce(i.received_fx_rate, 0), i.account_id,
        'ق-' || i.invoice_no, i.occurred_on, 'دریافت فاکتور ' || i.invoice_no, i.id
      from sale_invoices i
      join accounts a on a.id = i.account_id and a.user_id = i.user_id
      where i.received_amount > 0 and i.customer_id is null
        and not exists (
          select 1 from party_payments p where p.sale_invoice_id = i.id and p.kind = 'receipt'
        )
    $q$;
  end if;
end $$;
