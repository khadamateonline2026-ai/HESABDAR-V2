alter table accounts add column if not exists kind text not null default 'cash';
update accounts set kind = 'cash' where kind is null or kind = '';
