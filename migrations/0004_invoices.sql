-- Multi-line purchase/sale invoices, receipts, extra company phone

alter table companies add column if not exists phone3 text;

create table if not exists purchase_invoices (
  id serial primary key,
  user_id text not null,
  vendor_id int references parties(id) on delete set null,
  invoice_no text not null,
  occurred_on date not null,
  expected_on date,
  currency_id int not null references currencies(id),
  fx_enabled boolean not null default false,
  fx_rate numeric not null default 1,
  paid_amount numeric not null default 0,
  account_id int references accounts(id) on delete set null,
  notes text,
  receive_status text not null default 'in_transit',
  created_at timestamptz not null default now()
);
create index if not exists purchase_invoices_user_id_idx on purchase_invoices (user_id);

create table if not exists sale_invoices (
  id serial primary key,
  user_id text not null,
  customer_id int references parties(id) on delete set null,
  invoice_no text not null,
  occurred_on date not null,
  currency_id int not null references currencies(id),
  fx_enabled boolean not null default false,
  fx_rate numeric not null default 1,
  received_amount numeric not null default 0,
  account_id int references accounts(id) on delete set null,
  notes text,
  kind text not null default 'product',
  created_at timestamptz not null default now()
);
create index if not exists sale_invoices_user_id_idx on sale_invoices (user_id);

alter table purchases add column if not exists invoice_id int references purchase_invoices(id) on delete cascade;
alter table purchases add column if not exists received_qty numeric;
alter table purchases add column if not exists line_no int default 1;

alter table sales add column if not exists invoice_id int references sale_invoices(id) on delete cascade;
alter table sales add column if not exists line_no int default 1;

alter table party_payments add column if not exists purchase_invoice_id int references purchase_invoices(id) on delete set null;
alter table party_payments add column if not exists sale_invoice_id int references sale_invoices(id) on delete set null;

alter table purchase_invoices add column if not exists src_line_id int;
alter table sale_invoices add column if not exists src_line_id int;

insert into purchase_invoices (
  user_id, vendor_id, invoice_no, occurred_on, expected_on, currency_id,
  fx_enabled, fx_rate, paid_amount, account_id, notes, receive_status, src_line_id
)
select
  p.user_id, p.vendor_id,
  'B-' || p.id::text,
  p.occurred_on, p.occurred_on, p.currency_id,
  false, 1,
  p.quantity * p.unit_price,
  p.account_id, p.notes, 'arrived', p.id
from purchases p
where p.invoice_id is null;

update purchases p
set invoice_id = i.id,
    received_qty = p.quantity,
    line_no = 1,
    invoice_no = i.invoice_no
from purchase_invoices i
where i.src_line_id = p.id and p.invoice_id is null;

insert into sale_invoices (
  user_id, customer_id, invoice_no, occurred_on, currency_id,
  fx_enabled, fx_rate, received_amount, account_id, notes, kind, src_line_id
)
select
  s.user_id, s.customer_id,
  'S-' || s.id::text,
  s.occurred_on, s.currency_id,
  false, 1,
  s.quantity * s.unit_price,
  s.account_id, s.notes,
  case when i.kind = 'raw' then 'raw' else 'product' end,
  s.id
from sales s
left join items i on i.id = s.item_id
where s.invoice_id is null;

update sales s
set invoice_id = i.id,
    line_no = 1,
    invoice_no = i.invoice_no
from sale_invoices i
where i.src_line_id = s.id and s.invoice_id is null;

insert into party_payments (
  user_id, party_id, kind, amount, currency_id, account_id, receipt_no, occurred_on, notes, purchase_invoice_id
)
select
  i.user_id, i.vendor_id, 'payment', i.paid_amount, i.currency_id, i.account_id,
  'ق-' || i.invoice_no, i.occurred_on, 'پرداخت فاکتور خرید', i.id
from purchase_invoices i
where i.paid_amount > 0 and i.vendor_id is not null
  and not exists (
    select 1 from party_payments p where p.purchase_invoice_id = i.id
  );

insert into party_payments (
  user_id, party_id, kind, amount, currency_id, account_id, receipt_no, occurred_on, notes, sale_invoice_id
)
select
  i.user_id, i.customer_id, 'receipt', i.received_amount, i.currency_id, i.account_id,
  'ق-' || i.invoice_no, i.occurred_on, 'دریافت فاکتور فروش', i.id
from sale_invoices i
where i.received_amount > 0 and i.customer_id is not null
  and not exists (
    select 1 from party_payments p where p.sale_invoice_id = i.id
  );

update purchases set received_qty = quantity where received_qty is null;

alter table purchase_invoices drop column if exists src_line_id;
alter table sale_invoices drop column if exists src_line_id;
