-- Purchase price on catalog items; extra consumption (overheads) on products;
-- opening-stock sale price + unit cost (قیمت تمام‌شد)
alter table items add column if not exists purchase_price numeric not null default 0;

alter table opening_stock add column if not exists sale_price numeric not null default 0;
alter table opening_stock add column if not exists unit_cost numeric not null default 0;

update opening_stock
set unit_cost = case when quantity > 1e-9 then value_base / quantity else 0 end
where unit_cost = 0;

create table if not exists item_overheads (
  id serial primary key,
  user_id text not null,
  item_id int not null references items(id) on delete cascade,
  title text not null,
  amount numeric not null default 0
);
create index if not exists item_overheads_user_id_idx on item_overheads (user_id);
create index if not exists item_overheads_item_id_idx on item_overheads (item_id);
