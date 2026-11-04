create table if not exists cloud_backups (
  id serial primary key,
  user_id text not null,
  label text not null,
  kind text not null default 'manual',
  payload text not null,
  created_at timestamptz not null default now()
);
create index if not exists cloud_backups_user_id_idx on cloud_backups (user_id);
