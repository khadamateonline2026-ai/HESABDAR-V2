-- SEC-04: role tokens carry the workspace's role-PIN version; changing or
-- resetting any role PIN bumps it, which invalidates every issued role token.
alter table app_settings add column if not exists role_pin_version integer not null default 1;
