-- Migration 010: Account Milestones Repositories
-- Safe to run multiple times.

create table if not exists account_milestones (
  id                    bigserial primary key,
  account_id            text not null,
  account_name          text,
  event_date            date not null,
  event_type            text not null, -- 'crisis', 'oportunidad', 'hito', 'cambio_estrategico'
  title                 text not null,
  description           text,
  impact_level          text not null default 'medium', -- 'low', 'medium', 'high'
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists account_milestones_account_date
  on account_milestones (account_id, event_date desc);

alter table account_milestones enable row level security;

drop policy if exists "public read account_milestones" on account_milestones;
create policy "public read account_milestones"
  on account_milestones for select using (true);

drop policy if exists "service write account_milestones" on account_milestones;
create policy "service write account_milestones"
  on account_milestones for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on account_milestones to anon, authenticated, service_role;
grant insert, update, delete on account_milestones to service_role;
grant usage, select on sequence account_milestones_id_seq to service_role;
