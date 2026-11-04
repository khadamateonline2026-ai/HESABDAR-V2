-- Work-order handoff to another worker (null to_worker_id = deliver to warehouse)
alter table work_deliveries add column if not exists to_worker_id int references parties(id) on delete set null;
alter table work_deliveries add column if not exists to_work_order_id int references work_orders(id) on delete set null;
