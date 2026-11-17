-- ACC-06: worker payments can carry their own currency and a frozen rate to
-- the base currency. Existing rows keep currency_id = null, meaning the base
-- currency (how they were always treated), so no amount changes.
alter table worker_payments add column if not exists currency_id int references currencies(id) on delete restrict;
alter table worker_payments add column if not exists fx_rate numeric;
alter table worker_payments drop constraint if exists worker_payments_fx_rate_check;
alter table worker_payments add constraint worker_payments_fx_rate_check check (fx_rate is null or fx_rate > 0);

drop trigger if exists hesabdar_same_owner on worker_payments;
create constraint trigger hesabdar_same_owner after insert or update on worker_payments
  deferrable initially deferred for each row
  execute function hesabdar_same_owner('account_id', 'accounts', 'currency_id', 'currencies', 'worker_id', 'parties');
