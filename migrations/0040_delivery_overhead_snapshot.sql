-- سربار تولید: «سایر مصارف» هر واحد، هنگام تحویل به گدام روی همان تحویل ثابت می‌شود
-- تا تغییر بعدی سربار، قیمت تمام‌شد و سود فروش‌های قبلی را تغییر ندهد.
-- تحویل‌های موجود با سربار فعلی پر می‌شوند، پس هیچ عددی هنگام انتشار تغییر نمی‌کند.
alter table work_deliveries add column if not exists overhead_per_unit_base numeric;

update work_deliveries d
set overhead_per_unit_base = coalesce((
  select sum(h.amount)
  from work_orders o
  join item_overheads h on h.item_id = o.product_id and h.user_id = o.user_id
  where o.id = d.work_order_id and o.user_id = d.user_id
), 0)
where d.overhead_per_unit_base is null;
