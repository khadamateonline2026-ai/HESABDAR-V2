-- ACC-01: freeze exchange rates on every money movement.
--
-- Account balances used to convert old transfers, capital moves, opening cash,
-- expenses, receipts/payments and worker payments with TODAY's rate from the
-- currency settings, so editing a rate silently changed past balances (e.g. a
-- 100 USD transfer into an AFN till showed 7000, then 8000 after the rate went
-- from 70 to 80; a 100 USD receipt into a USD till showed 87.5 USD).
--
-- New columns hold the currency's rate_to_base AT POSTING TIME:
--   *.fx_rate       rate of the row's own currency (capital, opening, expenses)
--   *.account_rate  rate of the account's currency (all account-moving rows)
--   transfers.from_rate / to_rate  rates of the two accounts' currencies
-- A BEFORE INSERT/UPDATE trigger fills them when they are NULL, and refreshes
-- them only when the row's currency/account itself changes — every code path
-- (and restores of old backups) gets the same rule.
--
-- Backfill: no historical rates were ever stored, so existing rows get the
-- current rate_to_base — exactly the rate the app used to show them today. All
-- balances are therefore unchanged by this migration; they simply stop moving
-- when a rate is edited later.

alter table transfers add column if not exists from_rate numeric;
alter table transfers add column if not exists to_rate numeric;
alter table capital_moves add column if not exists fx_rate numeric;
alter table capital_moves add column if not exists account_rate numeric;
alter table opening_cash add column if not exists fx_rate numeric;
alter table opening_cash add column if not exists account_rate numeric;
alter table expenses add column if not exists fx_rate numeric;
alter table expenses add column if not exists account_rate numeric;
alter table party_payments add column if not exists account_rate numeric;
alter table worker_payments add column if not exists account_rate numeric;

create or replace function hesabdar_currency_rate(cur int) returns numeric
language sql stable as $$
  select coalesce(nullif(rate_to_base, 0), 1) from currencies where id = cur
$$;

create or replace function hesabdar_account_rate(acc int) returns numeric
language sql stable as $$
  select coalesce(nullif(c.rate_to_base, 0), 1)
  from accounts a join currencies c on c.id = a.currency_id
  where a.id = acc
$$;

create or replace function hesabdar_snapshot_rates() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'transfers' then
    if new.from_rate is null or (tg_op = 'UPDATE' and new.from_account_id is distinct from old.from_account_id) then
      new.from_rate := hesabdar_account_rate(new.from_account_id);
    end if;
    if new.to_rate is null or (tg_op = 'UPDATE' and new.to_account_id is distinct from old.to_account_id) then
      new.to_rate := hesabdar_account_rate(new.to_account_id);
    end if;
    return new;
  end if;
  if tg_table_name in ('capital_moves', 'opening_cash', 'expenses') then
    if new.fx_rate is null or (tg_op = 'UPDATE' and new.currency_id is distinct from old.currency_id) then
      new.fx_rate := hesabdar_currency_rate(new.currency_id);
    end if;
  end if;
  if new.account_id is null then
    new.account_rate := null;
  elsif new.account_rate is null or (tg_op = 'UPDATE' and new.account_id is distinct from old.account_id) then
    new.account_rate := hesabdar_account_rate(new.account_id);
  end if;
  return new;
end;
$$;

drop trigger if exists hesabdar_rates_transfers on transfers;
create trigger hesabdar_rates_transfers before insert or update on transfers
  for each row execute function hesabdar_snapshot_rates();
drop trigger if exists hesabdar_rates_capital on capital_moves;
create trigger hesabdar_rates_capital before insert or update on capital_moves
  for each row execute function hesabdar_snapshot_rates();
drop trigger if exists hesabdar_rates_opening on opening_cash;
create trigger hesabdar_rates_opening before insert or update on opening_cash
  for each row execute function hesabdar_snapshot_rates();
drop trigger if exists hesabdar_rates_expenses on expenses;
create trigger hesabdar_rates_expenses before insert or update on expenses
  for each row execute function hesabdar_snapshot_rates();
drop trigger if exists hesabdar_rates_party_payments on party_payments;
create trigger hesabdar_rates_party_payments before insert or update on party_payments
  for each row execute function hesabdar_snapshot_rates();
drop trigger if exists hesabdar_rates_worker_payments on worker_payments;
create trigger hesabdar_rates_worker_payments before insert or update on worker_payments
  for each row execute function hesabdar_snapshot_rates();

-- Backfill (current rates = what the app showed until now; see header).
-- Mute the activity-log trigger for these technical updates so the history
-- page does not fill with "ویرایش" entries; only users muted here are unmuted.
create temp table _mig0029_mute on commit drop as
  select distinct u.user_id from (
    select user_id from transfers union select user_id from capital_moves
    union select user_id from opening_cash union select user_id from expenses
    union select user_id from party_payments union select user_id from worker_payments
  ) u
  where not exists (select 1 from activity_log_mute m where m.user_id = u.user_id);
insert into activity_log_mute (user_id) select user_id from _mig0029_mute on conflict do nothing;
update transfers set from_rate = hesabdar_account_rate(from_account_id) where from_rate is null;
update transfers set to_rate = hesabdar_account_rate(to_account_id) where to_rate is null;
update capital_moves set fx_rate = hesabdar_currency_rate(currency_id) where fx_rate is null;
update opening_cash set fx_rate = hesabdar_currency_rate(currency_id) where fx_rate is null;
update expenses set fx_rate = hesabdar_currency_rate(currency_id) where fx_rate is null;
update capital_moves set account_rate = hesabdar_account_rate(account_id) where account_rate is null and account_id is not null;
update opening_cash set account_rate = hesabdar_account_rate(account_id) where account_rate is null and account_id is not null;
update expenses set account_rate = hesabdar_account_rate(account_id) where account_rate is null and account_id is not null;
update party_payments set account_rate = hesabdar_account_rate(account_id) where account_rate is null and account_id is not null;
update worker_payments set account_rate = hesabdar_account_rate(account_id) where account_rate is null and account_id is not null;
delete from activity_log_mute where user_id in (select user_id from _mig0029_mute);
