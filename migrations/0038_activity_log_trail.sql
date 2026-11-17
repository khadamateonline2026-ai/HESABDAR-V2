-- STR-05: activity log as a more reliable trail.
-- 1. Mute is transaction-scoped (setting hesabdar.mute_log) instead of a row in
--    activity_log_mute that survived crashes and muted parallel requests.
-- 2. Each entry keeps the row before and after the change (images and PINs left out).
-- 3. Logging failures raise a WARNING instead of disappearing silently.
alter table activity_log add column if not exists before_data jsonb;
alter table activity_log add column if not exists after_data jsonb;

create or replace function hesabdar_activity_log_row()
returns trigger
language plpgsql
as $$
declare
  rec jsonb;
  uid text;
  act text;
  ttl text;
  dtl text;
  amt text;
  qty text;
  kind_fa text;
begin
  begin
    if tg_op = 'DELETE' then
      rec := to_jsonb(old);
      act := 'حذف';
    elsif tg_op = 'UPDATE' then
      rec := to_jsonb(new);
      act := 'ویرایش';
    else
      rec := to_jsonb(new);
      act := 'ثبت';
    end if;

    uid := rec->>'user_id';
    if uid is null or uid = '' then
      return coalesce(new, old);
    end if;
    -- STR-05: the mute is transaction-scoped (set_config(..., true)), so a
    -- crash or a parallel request can never leave the log switched off.
    if coalesce(current_setting('hesabdar.mute_log', true), '') = uid then
      return coalesce(new, old);
    end if;

    ttl := coalesce(
      nullif(rec->>'invoice_no', ''),
      nullif(rec->>'receipt_no', ''),
      nullif(rec->>'name', ''),
      nullif(rec->>'title', ''),
      nullif(rec->>'product_name', ''),
      nullif(rec->>'item_name', ''),
      nullif(rec->>'label', ''),
      case tg_table_name
        when 'sale_invoices' then 'فروش'
        when 'purchase_invoices' then 'خرید'
        when 'expenses' then 'هزینه'
        when 'recurring_expenses' then 'هزینه تکراری'
        when 'party_payments' then 'دریافت و پرداخت'
        when 'worker_payments' then 'پرداخت کارگر'
        when 'transfers' then 'انتقال'
        when 'capital_moves' then 'سرمایه'
        when 'opening_cash' then 'تعدیل دخل'
        when 'opening_stock' then 'تعدیل موجودی'
        when 'work_orders' then 'سفارش تولید'
        when 'work_deliveries' then 'تحویل تولید'
        when 'items' then 'کالا'
        when 'parties' then 'طرف‌حساب'
        when 'accounts' then 'حساب'
        else 'ثبت'
      end
    );

    amt := rec->>'amount';
    qty := rec->>'quantity';
    kind_fa := case rec->>'kind'
      when 'receipt' then 'دریافت'
      when 'payment' then 'پرداخت'
      when 'add' then 'افزودن'
      when 'withdraw' then 'برداشت'
      when 'cash' then 'دخل'
      when 'counterparty' then 'طرف حساب نقدی'
      when 'customer' then 'مشتری'
      when 'vendor' then 'فروشنده'
      when 'worker' then 'کارگر'
      when 'other' then 'سایر'
      when 'product' then 'کالای تولید شده'
      when 'raw' then 'مواد خام'
      when 'contract' then 'کانتراتی'
      when 'salaried' then 'ثابت'
      else null
    end;
    dtl := concat_ws(
      ' · ',
      nullif(rec->>'notes', ''),
      case when amt is not null and amt <> '' then ('مبلغ ' || amt) else null end,
      case when qty is not null and qty <> '' then ('تعداد ' || qty) else null end,
      kind_fa
    );

    insert into activity_log (user_id, area, action, title, detail, before_data, after_data)
    values (
      uid, tg_table_name, act, ttl, coalesce(dtl, ''),
      case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'image' - 'payload' - 'role_code_supervisor' - 'role_code_accountant' - 'role_code_seller' end,
      case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'image' - 'payload' - 'role_code_supervisor' - 'role_code_accountant' - 'role_code_seller' end
    );
  exception when others then
    -- The log never blocks the business change, but the failure is visible
    -- in the database logs instead of vanishing.
    raise warning 'hesabdar activity log failed on %: %', tg_table_name, sqlerrm;
  end;
  return coalesce(new, old);
end;
$$;

-- Any mute rows left over from the old mechanism are cleared.
delete from activity_log_mute;
