alter table app_settings alter column role_code_supervisor set default '';
alter table app_settings alter column role_code_accountant set default '';
alter table app_settings alter column role_code_seller set default '';
alter table app_settings add column if not exists role_reset_hash text;
alter table app_settings add column if not exists role_reset_exp timestamptz;
