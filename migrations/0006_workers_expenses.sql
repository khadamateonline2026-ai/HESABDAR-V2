-- Work-order invoice numbers, worker payments, expense categories, recurring expenses

alter table work_orders add column if not exists invoice_no text;
update work_orders set invoice_no = 'W-' || id::text where invoice_no is null or invoice_no = '';

create table if not exists worker_payments (
  id serial primary key,
  user_id text not null,
  worker_id int not null references parties(id) on delete cascade,
  amount numeric not null,
  occurred_on date not null,
  notes text,
  invoice_no text not null
);
create index if not exists worker_payments_user_id_idx on worker_payments (user_id);
create index if not exists worker_payments_worker_idx on worker_payments (worker_id);

create table if not exists expense_categories (
  id serial primary key,
  user_id text not null,
  name text not null,
  kind text not null default 'misc' check (kind in ('misc', 'recurring'))
);
create index if not exists expense_categories_user_id_idx on expense_categories (user_id);

insert into expense_categories (user_id, name, kind)
select c.user_id, 'عمومی', 'misc'
from companies c
where not exists (
  select 1 from expense_categories x where x.user_id = c.user_id and x.kind = 'misc'
);

insert into expense_categories (user_id, name, kind)
select c.user_id, 'عمومی', 'recurring'
from companies c
where not exists (
  select 1 from expense_categories x where x.user_id = c.user_id and x.kind = 'recurring'
);

alter table expenses add column if not exists category_id int references expense_categories(id) on delete set null;
alter table expenses add column if not exists party_id int references parties(id) on delete set null;

create table if not exists recurring_expenses (
  id serial primary key,
  user_id text not null,
  title text not null,
  amount numeric not null,
  currency_id int not null references currencies(id),
  category_id int references expense_categories(id) on delete set null,
  start_on date not null,
  notes text
);
create index if not exists recurring_expenses_user_id_idx on recurring_expenses (user_id);

create table if not exists recurring_periods (
  id serial primary key,
  user_id text not null,
  recurring_id int not null references recurring_expenses(id) on delete cascade,
  period text not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid')),
  paid_on date,
  expense_id int references expenses(id) on delete set null,
  unique (user_id, recurring_id, period)
);
create index if not exists recurring_periods_user_id_idx on recurring_periods (user_id);
