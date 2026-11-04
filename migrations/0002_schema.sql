-- دفتر حساب — per-user business schema
create table if not exists profiles (
  user_id text primary key,
  display_name text not null,
  role text not null check (role in ('supervisor', 'accountant', 'seller')),
  created_at timestamptz not null default now()
);

create table if not exists companies (
  user_id text primary key,
  name text not null default 'شرکت من',
  logo text,
  license_no text,
  tin text,
  address text,
  phone1 text,
  phone2 text,
  email text,
  updated_at timestamptz not null default now()
);

create table if not exists currencies (
  id serial primary key,
  user_id text not null,
  name text not null,
  symbol text not null,
  rate_to_base numeric not null default 1,
  unique (user_id, name)
);
create index if not exists currencies_user_id_idx on currencies (user_id);

create table if not exists units (
  id serial primary key,
  user_id text not null,
  name text not null,
  unique (user_id, name)
);
create index if not exists units_user_id_idx on units (user_id);

create table if not exists job_types (
  id serial primary key,
  user_id text not null,
  name text not null,
  unique (user_id, name)
);
create index if not exists job_types_user_id_idx on job_types (user_id);

create table if not exists wage_rates (
  id serial primary key,
  user_id text not null,
  job_type_id int not null references job_types(id) on delete cascade,
  product_model text not null default '',
  wage_per_unit numeric not null default 0,
  registered_at date not null,
  notes text
);
create index if not exists wage_rates_user_id_idx on wage_rates (user_id);

create table if not exists party_categories (
  id serial primary key,
  user_id text not null,
  kind text not null check (kind in ('customer', 'vendor', 'worker', 'other')),
  name text not null
);
create index if not exists party_categories_user_id_idx on party_categories (user_id);

create table if not exists parties (
  id serial primary key,
  user_id text not null,
  kind text not null check (kind in ('customer', 'vendor', 'worker', 'other')),
  name text not null,
  phone text,
  category_id int references party_categories(id) on delete set null,
  notes text,
  job_type_id int references job_types(id) on delete set null,
  start_date date,
  address text,
  currency_id int references currencies(id) on delete set null
);
create index if not exists parties_user_id_idx on parties (user_id);

create table if not exists item_categories (
  id serial primary key,
  user_id text not null,
  name text not null
);
create index if not exists item_categories_user_id_idx on item_categories (user_id);

create table if not exists item_types (
  id serial primary key,
  user_id text not null,
  name text not null
);
create index if not exists item_types_user_id_idx on item_types (user_id);

create table if not exists items (
  id serial primary key,
  user_id text not null,
  name text not null,
  type_id int references item_types(id) on delete set null,
  category_id int references item_categories(id) on delete set null,
  unit_id int references units(id) on delete set null,
  kind text not null default 'product' check (kind in ('product', 'raw'))
);
create index if not exists items_user_id_idx on items (user_id);

create table if not exists warehouses (
  id serial primary key,
  user_id text not null,
  name text not null
);
create index if not exists warehouses_user_id_idx on warehouses (user_id);

create table if not exists accounts (
  id serial primary key,
  user_id text not null,
  name text not null,
  currency_id int not null references currencies(id),
  opening_balance numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists accounts_user_id_idx on accounts (user_id);

create table if not exists transfers (
  id serial primary key,
  user_id text not null,
  from_account_id int not null references accounts(id),
  to_account_id int not null references accounts(id),
  amount numeric not null,
  occurred_on date not null,
  notes text
);
create index if not exists transfers_user_id_idx on transfers (user_id);

create table if not exists capital_moves (
  id serial primary key,
  user_id text not null,
  kind text not null check (kind in ('add', 'withdraw')),
  account_id int not null references accounts(id),
  currency_id int not null references currencies(id),
  amount numeric not null,
  occurred_on date not null,
  notes text
);
create index if not exists capital_moves_user_id_idx on capital_moves (user_id);

create table if not exists opening_cash (
  id serial primary key,
  user_id text not null,
  account_id int not null references accounts(id),
  currency_id int not null references currencies(id),
  amount numeric not null,
  occurred_on date not null,
  notes text
);
create index if not exists opening_cash_user_id_idx on opening_cash (user_id);

create table if not exists opening_stock (
  id serial primary key,
  user_id text not null,
  kind text not null check (kind in ('finished', 'raw')),
  item_name text not null,
  warehouse_name text not null,
  quantity numeric not null,
  value_base numeric not null,
  occurred_on date not null,
  notes text
);
create index if not exists opening_stock_user_id_idx on opening_stock (user_id);

create table if not exists purchases (
  id serial primary key,
  user_id text not null,
  vendor_id int references parties(id) on delete set null,
  item_id int references items(id) on delete set null,
  item_name text not null,
  quantity numeric not null,
  unit_id int references units(id) on delete set null,
  unit_price numeric not null,
  currency_id int not null references currencies(id),
  account_id int references accounts(id) on delete set null,
  warehouse_name text,
  occurred_on date not null,
  notes text
);
create index if not exists purchases_user_id_idx on purchases (user_id);

create table if not exists sales (
  id serial primary key,
  user_id text not null,
  customer_id int references parties(id) on delete set null,
  item_id int references items(id) on delete set null,
  item_name text not null,
  quantity numeric not null,
  unit_id int references units(id) on delete set null,
  unit_price numeric not null,
  currency_id int not null references currencies(id),
  account_id int references accounts(id) on delete set null,
  occurred_on date not null,
  notes text
);
create index if not exists sales_user_id_idx on sales (user_id);

create table if not exists expenses (
  id serial primary key,
  user_id text not null,
  title text not null,
  amount numeric not null,
  currency_id int not null references currencies(id),
  account_id int references accounts(id) on delete set null,
  occurred_on date not null,
  notes text
);
create index if not exists expenses_user_id_idx on expenses (user_id);
