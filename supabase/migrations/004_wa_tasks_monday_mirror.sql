-- Normalized WhatsApp action items with Monday.com mirror fields.
-- Run after 002/003 wa_daily_analysis migrations.

create table if not exists wa_tasks (
  id                         bigserial primary key,
  analysis_id                bigint references wa_daily_analysis(id) on delete cascade,
  account_id                 text not null,
  group_jid                  text,
  group_name                 text,
  analysis_date              date not null,

  action                     text not null,
  owner                      text,
  owner_type                 text,
  urgency                    text,
  due_date                   date,
  work_type                  text,
  client_label               text,

  monday_item_id             text unique,
  monday_item_name           text,
  monday_sync_key            text unique,
  monday_status              text,
  monday_due_date            date,
  monday_responsible_text    text,
  monday_work_type           text,
  monday_client_label        text,
  monday_updated_at          timestamptz,
  last_synced_to_monday_at   timestamptz,
  last_synced_from_monday_at timestamptz,

  raw_action                 jsonb not null default '{}'::jsonb,
  raw_monday                 jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index if not exists wa_tasks_analysis_date
  on wa_tasks (analysis_date desc);

create index if not exists wa_tasks_group_date
  on wa_tasks (group_jid, analysis_date desc);

create index if not exists wa_tasks_monday_item_id
  on wa_tasks (monday_item_id);

alter table wa_tasks enable row level security;

drop policy if exists "public read wa_tasks" on wa_tasks;
create policy "public read wa_tasks"
  on wa_tasks for select using (true);

drop policy if exists "service write wa_tasks" on wa_tasks;
create policy "service write wa_tasks"
  on wa_tasks for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on wa_tasks to anon, authenticated, service_role;
grant insert, update, delete on wa_tasks to service_role;
grant usage, select on sequence wa_tasks_id_seq to service_role;
