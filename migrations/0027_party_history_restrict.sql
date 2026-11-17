-- SEC-07: deleting a contact must never erase its financial history.
-- party_payments.party_id and worker_payments.worker_id were ON DELETE CASCADE,
-- so deleting a customer/vendor/worker silently deleted their receipts and
-- payments (and changed cash balances) while invoices remained. Switch both to
-- ON DELETE RESTRICT. The app also blocks such deletes with a Persian message;
-- this is the database-level safety net. No rows are changed by this migration.
do $$
declare
  r record;
begin
  for r in
    select con.conname, rel.relname, att.attname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and ns.nspname = current_schema()
      and con.confrelid = 'parties'::regclass
      and con.confdeltype = 'c'
      and (
        (rel.relname = 'party_payments' and att.attname = 'party_id')
        or (rel.relname = 'worker_payments' and att.attname = 'worker_id')
      )
  loop
    execute format('alter table %I drop constraint %I', r.relname, r.conname);
    execute format(
      'alter table %I add constraint %I foreign key (%I) references parties(id) on delete restrict',
      r.relname, r.conname, r.attname
    );
  end loop;
end $$;
