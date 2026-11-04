-- Recurring expense cadence (weekly / monthly / quarterly / semiannual / yearly)

alter table recurring_expenses
  add column if not exists cadence text not null default 'monthly';
