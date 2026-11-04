-- Kept so existing environments that already applied this stay valid.
alter table profiles add column if not exists role_unlocked boolean not null default true;
