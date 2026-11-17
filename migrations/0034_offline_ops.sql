-- STR-04: idempotency keys for offline-queued writes. The client gives every
-- queued save a random key (x-hesabdar-op); the server claims it inside the
-- same transaction as the write, so a replay of an operation that already
-- committed returns the stored result instead of writing a second time.
create table if not exists offline_ops (
  user_id text not null,
  op_key text not null,
  result text,
  created_at timestamptz not null default now(),
  primary key (user_id, op_key)
);
create index if not exists offline_ops_created_idx on offline_ops (user_id, created_at);
