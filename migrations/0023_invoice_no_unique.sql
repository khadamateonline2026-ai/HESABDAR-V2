do $$
begin
  if not exists (
    select 1 from purchase_invoices
    group by user_id, invoice_no
    having count(*) > 1
  ) then
    create unique index if not exists purchase_invoices_user_no_uidx
      on purchase_invoices (user_id, invoice_no);
  end if;
  if not exists (
    select 1 from sale_invoices
    group by user_id, invoice_no
    having count(*) > 1
  ) then
    create unique index if not exists sale_invoices_user_no_uidx
      on sale_invoices (user_id, invoice_no);
  end if;
end $$;
