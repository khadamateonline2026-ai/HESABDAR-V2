-- Production pipeline stages; worker assignment; work-order handoff; expense-as-debt
create table if not exists production_stages (
  id serial primary key,
  user_id text not null,
  name text not null,
  sort_order int not null default 0
);
create index if not exists production_stages_user_id_idx on production_stages (user_id);

alter table parties add column if not exists stage_id int references production_stages(id) on delete set null;

alter table work_orders add column if not exists root_id int;
alter table work_orders add column if not exists stage_id int;

alter table expenses add column if not exists as_debt boolean not null default false;

alter table recurring_expenses add column if not exists account_id int references accounts(id) on delete set null;
