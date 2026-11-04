-- V2 security: role PIN lockout columns + document that role codes must be hashed at app layer.
alter table app_settings add column if not exists role_fail_count integer not null default 0;
alter table app_settings add column if not exists role_lock_until timestamptz;
alter table app_settings add column if not exists role_codes_hashed boolean not null default false;
