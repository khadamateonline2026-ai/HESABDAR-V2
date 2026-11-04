-- Vendor prepayments, salaried workers, recurring party, production overheads, tint strength

alter table parties add column if not exists employment text not null default 'contract';
alter table parties add column if not exists salary numeric not null default 0;

alter table recurring_expenses add column if not exists party_id int references parties(id) on delete set null;
alter table recurring_expenses add column if not exists worker_id int references parties(id) on delete cascade;

alter table worker_payments add column if not exists account_id int references accounts(id) on delete set null;

alter table app_settings add column if not exists card_tint_strength numeric not null default 40;

create table if not exists production_overhead_types (
  id serial primary key,
  user_id text not null,
  title text not null,
  amount numeric not null default 0
);
create index if not exists production_overhead_types_user_id_idx on production_overhead_types (user_id);
