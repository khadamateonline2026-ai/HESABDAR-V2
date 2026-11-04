alter table party_payments add column if not exists fx_rate numeric not null default 0;
