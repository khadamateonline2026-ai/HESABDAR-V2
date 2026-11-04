-- Sale default unit price on catalog items; recurring due at start or end of period
alter table items add column if not exists sale_price numeric not null default 0;

alter table recurring_expenses
  add column if not exists due_anchor text not null default 'start';
