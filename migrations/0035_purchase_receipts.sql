-- ACC-09: every (partial) receipt of a purchase line is recorded with its own
-- quantity, warehouse and date instead of overwriting purchases.warehouse_name.
-- purchases.received_qty stays as the running total (= sum of receipts).
create table if not exists purchase_receipts (
  id serial primary key,
  user_id text not null,
  purchase_id int not null references purchases(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  warehouse_name text not null default '',
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists purchase_receipts_purchase_idx on purchase_receipts (user_id, purchase_id);

drop trigger if exists hesabdar_same_owner on purchase_receipts;
create constraint trigger hesabdar_same_owner after insert or update on purchase_receipts
  deferrable initially deferred for each row execute function hesabdar_same_owner('purchase_id', 'purchases');

-- Existing receipts: one row per line with what was already received, in the
-- warehouse recorded on the line (the only information that exists).
insert into purchase_receipts (user_id, purchase_id, quantity, warehouse_name, occurred_on)
select p.user_id, p.id, p.received_qty, coalesce(p.warehouse_name, ''), p.occurred_on
from purchases p
where p.received_qty > 0
  and not exists (select 1 from purchase_receipts r where r.purchase_id = p.id);
