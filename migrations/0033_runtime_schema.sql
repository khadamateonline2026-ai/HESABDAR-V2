-- STR-01: schema that the app used to create at request time (27 ALTER/CREATE
-- calls spread over 12 handlers). A fresh database now has every column and
-- table after migrations alone, whatever page is opened first. Types and
-- defaults match production exactly; everything is IF NOT EXISTS, so this is
-- a no-op on production.

alter table sale_invoices add column if not exists closed boolean not null default false;
alter table sale_invoices add column if not exists received_fx_rate double precision not null default 0;
alter table sale_invoices add column if not exists refund_amount double precision not null default 0;
alter table sale_invoices add column if not exists refund_account_id bigint;
alter table sale_invoices add column if not exists cash_included_base double precision not null default 0;

alter table party_payments add column if not exists applied_sale_id bigint;
alter table party_payments add column if not exists fx_rate numeric not null default 0;

alter table work_deliveries add column if not exists wage_per_unit numeric;

alter table warehouses add column if not exists shop_only boolean not null default false;

alter table app_settings add column if not exists role_reset_hash text;
alter table app_settings add column if not exists role_reset_exp timestamptz;
alter table app_settings add column if not exists role_codes_hashed boolean not null default false;
alter table app_settings add column if not exists color_presets text not null default '[]';
alter table app_settings add column if not exists list_color text not null default '#3a2433';
alter table app_settings add column if not exists font_family text not null default 'Vazirmatn';
alter table app_settings add column if not exists production_enabled boolean not null default true;

create table if not exists cloud_backups (
  id serial primary key,
  user_id text not null,
  label text not null,
  kind text not null default 'manual',
  payload text not null,
  created_at timestamptz not null default now()
);

-- party categories may also belong to workers / other contacts
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'party_categories_kind_check'
      and pg_get_constraintdef(oid) like '%worker%' and pg_get_constraintdef(oid) like '%other%'
  ) then
    alter table party_categories drop constraint if exists party_categories_kind_check;
    alter table party_categories add constraint party_categories_kind_check
      check (kind in ('customer', 'vendor', 'worker', 'other'));
  end if;
end;
$$;
