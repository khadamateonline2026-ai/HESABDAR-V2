alter table app_settings add column if not exists card_tint boolean not null default true;
alter table app_settings add column if not exists accent_color text not null default '#8a6a2f';
alter table app_settings add column if not exists danger_color text not null default '#8f3a32';
