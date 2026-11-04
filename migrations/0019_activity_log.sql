-- دفتر عملکرد جدا از داده‌های محاسباتی. حذف این ردیف‌ها روی موجودی و حساب‌ها اثر ندارد.
create table if not exists activity_log (
  id serial primary key,
  user_id text not null,
  area text not null,
  action text not null,
  title text not null,
  detail text not null default '',
  occurred_at timestamptz not null default now()
);
create index if not exists activity_log_user_idx on activity_log (user_id, occurred_at desc);

create table if not exists activity_log_mute (
  user_id text primary key
);

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

drop trigger if exists activity_log_sale_invoices on sale_invoices;
create trigger activity_log_sale_invoices
after insert or update or delete on sale_invoices
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_purchase_invoices on purchase_invoices;
create trigger activity_log_purchase_invoices
after insert or update or delete on purchase_invoices
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_expenses on expenses;
create trigger activity_log_expenses
after insert or update or delete on expenses
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_recurring_expenses on recurring_expenses;
create trigger activity_log_recurring_expenses
after insert or update or delete on recurring_expenses
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_party_payments on party_payments;
create trigger activity_log_party_payments
after insert or update or delete on party_payments
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_worker_payments on worker_payments;
create trigger activity_log_worker_payments
after insert or update or delete on worker_payments
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_transfers on transfers;
create trigger activity_log_transfers
after insert or update or delete on transfers
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_capital_moves on capital_moves;
create trigger activity_log_capital_moves
after insert or update or delete on capital_moves
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_opening_cash on opening_cash;
create trigger activity_log_opening_cash
after insert or update or delete on opening_cash
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_opening_stock on opening_stock;
create trigger activity_log_opening_stock
after insert or update or delete on opening_stock
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_work_orders on work_orders;
create trigger activity_log_work_orders
after insert or update or delete on work_orders
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_work_deliveries on work_deliveries;
create trigger activity_log_work_deliveries
after insert or update or delete on work_deliveries
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_items on items;
create trigger activity_log_items
after insert or update or delete on items
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_parties on parties;
create trigger activity_log_parties
after insert or update or delete on parties
for each row execute procedure hesabdar_activity_log_row();

drop trigger if exists activity_log_accounts on accounts;
create trigger activity_log_accounts
after insert or update or delete on accounts
for each row execute procedure hesabdar_activity_log_row();

insert into activity_log (user_id, area, action, title, detail, occurred_at)
select user_id, 'sale_invoices', 'ثبت', coalesce(nullif(invoice_no, ''), 'فروش'), coalesce(notes, ''), coalesce(created_at, occurred_on::timestamptz)
from sale_invoices
where not exists (select 1 from activity_log a where a.user_id = sale_invoices.user_id and a.area = 'sale_invoices' limit 1);

insert into activity_log (user_id, area, action, title, detail, occurred_at)
select user_id, 'purchase_invoices', 'ثبت', coalesce(nullif(invoice_no, ''), 'خرید'), coalesce(notes, ''), coalesce(created_at, occurred_on::timestamptz)
from purchase_invoices
where not exists (select 1 from activity_log a where a.user_id = purchase_invoices.user_id and a.area = 'purchase_invoices' limit 1);

insert into activity_log (user_id, area, action, title, detail, occurred_at)
select user_id, 'expenses', 'ثبت', title, concat_ws(' · ', nullif(notes, ''), 'مبلغ ' || amount::text), occurred_on::timestamptz
from expenses
where not exists (select 1 from activity_log a where a.user_id = expenses.user_id and a.area = 'expenses' limit 1);

insert into activity_log (user_id, area, action, title, detail, occurred_at)
select user_id, 'party_payments', 'ثبت', coalesce(nullif(receipt_no, ''), 'پرداخت'), concat_ws(' · ', nullif(notes, ''), kind, 'مبلغ ' || amount::text), occurred_on::timestamptz
from party_payments
where not exists (select 1 from activity_log a where a.user_id = party_payments.user_id and a.area = 'party_payments' limit 1);

insert into activity_log (user_id, area, action, title, detail, occurred_at)
select user_id, 'transfers', 'ثبت', 'انتقال', coalesce(notes, ''), occurred_on::timestamptz
from transfers
where not exists (select 1 from activity_log a where a.user_id = transfers.user_id and a.area = 'transfers' limit 1);

insert into activity_log (user_id, area, action, title, detail, occurred_at)
select user_id, 'capital_moves', 'ثبت', kind, concat_ws(' · ', nullif(notes, ''), 'مبلغ ' || amount::text), occurred_on::timestamptz
from capital_moves
where not exists (select 1 from activity_log a where a.user_id = capital_moves.user_id and a.area = 'capital_moves' limit 1);

insert into activity_log (user_id, area, action, title, detail, occurred_at)
select user_id, 'work_orders', 'ثبت', product_name, concat_ws(' · ', nullif(notes, ''), 'تعداد ' || quantity::text), coalesce(created_at, occurred_on::timestamptz)
from work_orders
where not exists (select 1 from activity_log a where a.user_id = work_orders.user_id and a.area = 'work_orders' limit 1);
