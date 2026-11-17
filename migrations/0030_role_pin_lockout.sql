-- SEC-03: persistent role-PIN brute-force protection.
-- The old limiter lived in process memory (reset on every serverless cold
-- start / instance) and never covered the accountant-code checks. Counters
-- now live in app_settings and are updated atomically by every PIN check.
alter table app_settings add column if not exists role_fail_count integer not null default 0;
alter table app_settings add column if not exists role_lock_until timestamptz;
alter table app_settings add column if not exists role_codes_hashed boolean not null default false;
-- progressive lockout: 15 min, 30, 60 … capped at 24 h; reset by a correct PIN
alter table app_settings add column if not exists role_lock_level integer not null default 0;
-- time of the last counted attempt (failures older than 15 min are forgotten)
alter table app_settings add column if not exists role_fail_at timestamptz;
alter table app_settings add column if not exists role_reset_hash text;
alter table app_settings add column if not exists role_reset_exp timestamptz;

-- Truthful flag: hashed only when every non-empty code is a scrypt hash.
update app_settings set role_codes_hashed = (
  (coalesce(role_code_supervisor, '') = '' or role_code_supervisor like 'scrypt$%')
  and (coalesce(role_code_accountant, '') = '' or role_code_accountant like 'scrypt$%')
  and (coalesce(role_code_seller, '') = '' or role_code_seller like 'scrypt$%')
);
