-- Daily account diagnosis through Blackwell methodology lenses.
-- Safe to run multiple times; it does not delete existing data.

create table if not exists account_methodology_daily_analysis (
  id                    bigserial primary key,
  account_id            text not null,
  account_name          text,
  analysis_date          date not null,
  overall_status         text,
  summary                text,
  methodology_bullets    jsonb not null default '[]'::jsonb,
  recommended_actions    jsonb not null default '[]'::jsonb,
  input_snapshot         jsonb not null default '{}'::jsonb,
  model                  text,
  analyzed_at            timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  unique (account_id, analysis_date)
);

create index if not exists account_methodology_daily_account_date
  on account_methodology_daily_analysis (account_id, analysis_date desc);

alter table account_methodology_daily_analysis enable row level security;

drop policy if exists "public read account_methodology_daily_analysis" on account_methodology_daily_analysis;
create policy "public read account_methodology_daily_analysis"
  on account_methodology_daily_analysis for select using (true);

drop policy if exists "service write account_methodology_daily_analysis" on account_methodology_daily_analysis;
create policy "service write account_methodology_daily_analysis"
  on account_methodology_daily_analysis for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on account_methodology_daily_analysis to anon, authenticated, service_role;
grant insert, update, delete on account_methodology_daily_analysis to service_role;
grant usage, select on sequence account_methodology_daily_analysis_id_seq to service_role;
