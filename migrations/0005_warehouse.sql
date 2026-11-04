-- Item photos, min stock, category kind, BOM, work orders

alter table items add column if not exists image text;
alter table items add column if not exists min_qty numeric not null default 0;

alter table item_categories add column if not exists kind text not null default 'product';

insert into item_categories (user_id, name, kind)
select distinct ic.user_id, 'عمومی', 'raw'
from item_categories ic
where not exists (
  select 1 from item_categories x
  where x.user_id = ic.user_id and x.kind = 'raw'
);

create table if not exists bom_lines (
  id serial primary key,
  user_id text not null,
  product_id int not null references items(id) on delete cascade,
  raw_item_id int not null references items(id) on delete restrict,
  quantity numeric not null,
  unique (user_id, product_id, raw_item_id)
);
create index if not exists bom_lines_user_id_idx on bom_lines (user_id);
create index if not exists bom_lines_product_id_idx on bom_lines (product_id);

create table if not exists work_orders (
  id serial primary key,
  user_id text not null,
  worker_id int references parties(id) on delete set null,
  product_id int not null references items(id),
  product_name text not null,
  quantity numeric not null,
  delivered_qty numeric not null default 0,
  occurred_on date not null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists work_orders_user_id_idx on work_orders (user_id);

create table if not exists work_order_alloc (
  id serial primary key,
  user_id text not null,
  work_order_id int not null references work_orders(id) on delete cascade,
  raw_item_id int not null references items(id),
  raw_item_name text not null,
  qty_per_unit numeric not null,
  allocated_qty numeric not null
);
create index if not exists work_order_alloc_user_id_idx on work_order_alloc (user_id);
create index if not exists work_order_alloc_order_idx on work_order_alloc (work_order_id);

create table if not exists work_deliveries (
  id serial primary key,
  user_id text not null,
  work_order_id int not null references work_orders(id) on delete cascade,
  quantity numeric not null,
  occurred_on date not null,
  notes text
);
create index if not exists work_deliveries_user_id_idx on work_deliveries (user_id);
