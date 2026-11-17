-- SEC-01: a row may only reference rows of the same workspace (user_id).
--
-- Server functions took account/currency/contact/item/... ids from the client
-- and inserted them without checking the owner, so ids of another workspace
-- (sequential serials) could be linked and their names/balances read back
-- through joins. The app now checks ownership before writing (ownership.ts);
-- this trigger is the database-level safety net for every code path.
--
-- One generic function; each table's trigger passes (column, referenced
-- table) pairs. It is a DEFERRABLE INITIALLY DEFERRED constraint trigger, so
-- it runs at COMMIT: restores and self-references (work_orders.root_id = id)
-- that insert rows in any order inside one transaction still pass.
-- Existing production data was checked before this migration: 0 cross-owner
-- references.

create or replace function hesabdar_same_owner() returns trigger
language plpgsql as $$
declare
  i int := 0;
  col text;
  ref text;
  v text;
  uid text;
  ok boolean;
  newj jsonb := to_jsonb(new);
  oldj jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
begin
  uid := newj->>'user_id';
  while i < tg_nargs loop
    col := tg_argv[i];
    ref := tg_argv[i + 1];
    v := newj->>col;
    if v is not null and (
      oldj is null or v is distinct from oldj->>col or uid is distinct from oldj->>'user_id'
    ) then
      execute format('select exists (select 1 from %I where id = $1::bigint and user_id is not distinct from $2)', ref)
        into ok using v, uid;
      if not ok then
        raise exception 'ارجاع نامعتبر: % (شناسه %) به این حساب تعلق ندارد', col, v
          using errcode = '23503';
      end if;
    end if;
    i := i + 2;
  end loop;
  return null;
end;
$$;

do $$
declare
  t record;
  args text;
  extra text[][];
  e text[];
begin
  for t in
    select c.relname as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind = 'r'
      and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = c.relname and column_name = 'user_id')
  loop
    -- single-column FKs from this table to another workspace table's id
    select string_agg(format('%L, %L', a.attname, rc.relname), ', ' order by a.attname)
      into args
    from pg_constraint k
    join pg_class rc on rc.oid = k.confrelid
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    join pg_attribute ra on ra.attrelid = k.confrelid and ra.attnum = k.confkey[1]
    where k.contype = 'f' and k.conrelid = (quote_ident(t.tbl))::regclass
      and array_length(k.conkey, 1) = 1 and ra.attname = 'id' and a.attname <> 'user_id'
      and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = rc.relname and column_name = 'user_id');
    -- id columns that have no FK constraint
    extra := case t.tbl
      when 'party_payments' then array[array['applied_sale_id', 'sale_invoices']]
      when 'sale_invoices' then array[array['refund_account_id', 'accounts']]
      when 'work_orders' then array[array['root_id', 'work_orders'], array['stage_id', 'production_stages']]
      else null
    end;
    if extra is not null then
      foreach e slice 1 in array extra loop
        if args is null or position(quote_literal(e[1]) in args) = 0 then
          args := concat_ws(', ', args, format('%L, %L', e[1], e[2]));
        end if;
      end loop;
    end if;
    execute format('drop trigger if exists hesabdar_same_owner on %I', t.tbl);
    if args is not null then
      execute format(
        'create constraint trigger hesabdar_same_owner after insert or update on %I '
        'deferrable initially deferred for each row execute function hesabdar_same_owner(%s)',
        t.tbl, args
      );
    end if;
  end loop;
end;
$$;
