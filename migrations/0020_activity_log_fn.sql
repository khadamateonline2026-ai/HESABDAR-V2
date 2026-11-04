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
    if exists (select 1 from activity_log_mute where user_id = uid) then
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
      tg_table_name
    );

    amt := rec->>'amount';
    qty := rec->>'quantity';
    dtl := concat_ws(
      ' · ',
      nullif(rec->>'notes', ''),
      case when amt is not null and amt <> '' then ('مبلغ ' || amt) else null end,
      case when qty is not null and qty <> '' then ('تعداد ' || qty) else null end,
      nullif(rec->>'kind', '')
    );

    insert into activity_log (user_id, area, action, title, detail)
    values (uid, tg_table_name, act, ttl, coalesce(dtl, ''));
  exception when others then
    null;
  end;
  return coalesce(new, old);
end;
$$;
