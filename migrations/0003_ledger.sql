-- Invoice numbers, document status, party receipts/payments, appearance, backups

alter table sales add column if not exists invoice_no text;
alter table sales add column if not exists status text not null default 'final';
alter table purchases add column if not exists invoice_no text;
alter table purchases add column if not exists status text not null default 'final';

update sales set invoice_no = 'فروش-' || id::text where invoice_no is null or invoice_no = '';
update purchases set invoice_no = 'خرید-' || id::text where invoice_no is null or invoice_no = '';

create table if not exists party_payments (
  id serial primary key,
  user_id text not null,
  party_id int not null references parties(id) on delete cascade,
  kind text not null,
  amount numeric not null,
  currency_id int not null references currencies(id),
  account_id int references accounts(id) on delete set null,
  receipt_no text not null,
  occurred_on date not null,
  notes text
);
create index if not exists party_payments_user_id_idx on party_payments (user_id);

create table if not exists app_settings (
  user_id text primary key,
  theme text not null default 'light',
  font_size int not null default 16,
  font_color text not null default '#1c1916',
  primary_color text not null default '#1b4d3e',
  bg_color text not null default '#f4f0e6',
  calendar text not null default 'jalali',
  role_code_supervisor text not null default '12345',
  role_code_accountant text not null default '102030',
  role_code_seller text not null default '54321'
);

create table if not exists staff_users (
  id serial primary key,
  user_id text not null,
  display_name text not null,
  role text not null,
  is_owner boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists staff_users_user_id_idx on staff_users (user_id);

create table if not exists data_backups (
  id serial primary key,
  user_id text not null,
  label text not null,
  payload text not null,
  created_at timestamptz not null default now()
);
create index if not exists data_backups_user_id_idx on data_backups (user_id);
