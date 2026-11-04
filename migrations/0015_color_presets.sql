alter table app_settings add column if not exists color_presets text not null default '[]';
