-- WhatsApp daily LLM analysis and rolling account score.
-- Run this in Supabase SQL Editor after 001_wa_schema.sql.

create table if not exists wa_account_scores (
  account_id          text primary key,
  account_name        text,
  base_score          numeric not null default 70 check (base_score between 0 and 100),
  current_score       numeric not null default 70 check (current_score between 0 and 100),
  total_delta         numeric not null default 0,
  last_analyzed_date  date,
  last_message_at     timestamptz,
  rolling_summary     text,
  updated_at          timestamptz not null default now()
);

comment on table wa_account_scores is 'Base score and cumulative WhatsApp-derived score by account.';
comment on column wa_account_scores.base_score is 'Manual starting score. Daily analyses add/subtract from this.';
comment on column wa_account_scores.current_score is 'Clamped score after applying daily WhatsApp deltas.';

create table if not exists wa_daily_analysis (
  id                 bigserial primary key,
  account_id         text not null,
  analysis_date      date not null,
  group_names        text[] not null default '{}',
  message_count      integer not null default 0,
  first_message_at   timestamptz,
  last_message_at    timestamptz,
  previous_score     numeric check (previous_score between 0 and 100),
  score_delta        numeric not null default 0 check (score_delta between -10 and 10),
  new_score          numeric check (new_score between 0 and 100),
  sentiment          text not null default 'neutral',
  satisfaction       text not null default 'unknown',
  risk_level         text not null default 'low',
  summary            text,
  positive_signals   jsonb not null default '[]'::jsonb,
  negative_signals   jsonb not null default '[]'::jsonb,
  action_items       jsonb not null default '[]'::jsonb,
  evidence           jsonb not null default '[]'::jsonb,
  model              text,
  raw_analysis       jsonb,
  analyzed_at        timestamptz not null default now(),
  unique (account_id, analysis_date)
);

create index if not exists wa_daily_analysis_account_date
  on wa_daily_analysis (account_id, analysis_date desc);

create index if not exists wa_daily_analysis_date
  on wa_daily_analysis (analysis_date desc);

alter table wa_account_scores enable row level security;
alter table wa_daily_analysis enable row level security;

drop policy if exists "public read wa_account_scores" on wa_account_scores;
create policy "public read wa_account_scores"
  on wa_account_scores for select using (true);

drop policy if exists "public read wa_daily_analysis" on wa_daily_analysis;
create policy "public read wa_daily_analysis"
  on wa_daily_analysis for select using (true);

drop policy if exists "service write wa_account_scores" on wa_account_scores;
create policy "service write wa_account_scores"
  on wa_account_scores for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service write wa_daily_analysis" on wa_daily_analysis;
create policy "service write wa_daily_analysis"
  on wa_daily_analysis for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
