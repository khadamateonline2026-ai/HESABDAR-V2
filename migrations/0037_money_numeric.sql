-- ACC-13: the last money columns stored as double precision become numeric
-- (exact decimal). The cast keeps every stored value as it reads today.
alter table sale_invoices alter column received_fx_rate type numeric using received_fx_rate::numeric;
alter table sale_invoices alter column refund_amount type numeric using refund_amount::numeric;
alter table sale_invoices alter column cash_included_base type numeric using cash_included_base::numeric;
