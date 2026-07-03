-- Publication quality (PQ) analysis for media links.
-- Run after 007_account_publications_co.sql.

create table if not exists publication_quality_analyses (
  id                         bigserial primary key,
  account_id                 text not null,
  account_name               text,
  sheet_client_name          text,
  media_name                 text,
  publication_date           date,
  publication_year           integer,
  publication_month          integer,
  url                        text not null unique,

  article_title              text,
  article_excerpt            text,
  matched_aliases            jsonb not null default '[]'::jsonb,
  title_match                boolean not null default false,
  body_match                 boolean not null default false,
  title_evidence             text,
  body_evidence              text,

  tier                       text,
  tier_points                numeric check (tier_points between 0 and 50),
  editorial_quality          text,
  editorial_points           numeric check (editorial_points between 0 and 30),
  focus                      text,
  focus_points               numeric check (focus_points between 0 and 20),
  content_score              numeric check (content_score between 0 and 50),
  pq_score                   numeric check (pq_score between 0 and 100),
  status                     text not null default 'needs_tier',

  evidence                   jsonb not null default '[]'::jsonb,
  raw_analysis               jsonb not null default '{}'::jsonb,
  model                      text,
  analyzed_at                timestamptz not null default now(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index if not exists publication_quality_account_period
  on publication_quality_analyses (account_id, publication_year desc, publication_month desc);

create table if not exists publication_quality_scores (
  account_id                 text not null,
  account_name               text,
  period_year                integer not null,
  period_month               integer not null,
  publication_count          integer not null default 0,
  analyzed_count             integer not null default 0,
  scored_count               integer not null default 0,
  pq_score                   numeric check (pq_score between 0 and 100),
  status                     text not null default 'needs_tier',
  updated_at                 timestamptz not null default now(),

  primary key (account_id, period_year, period_month)
);

alter table publication_quality_analyses enable row level security;
alter table publication_quality_scores enable row level security;

drop policy if exists "public read publication_quality_analyses" on publication_quality_analyses;
create policy "public read publication_quality_analyses"
  on publication_quality_analyses for select using (true);

drop policy if exists "public read publication_quality_scores" on publication_quality_scores;
create policy "public read publication_quality_scores"
  on publication_quality_scores for select using (true);

drop policy if exists "service write publication_quality_analyses" on publication_quality_analyses;
create policy "service write publication_quality_analyses"
  on publication_quality_analyses for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service write publication_quality_scores" on publication_quality_scores;
create policy "service write publication_quality_scores"
  on publication_quality_scores for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on publication_quality_analyses to anon, authenticated, service_role;
grant insert, update, delete on publication_quality_analyses to service_role;
grant usage, select on sequence publication_quality_analyses_id_seq to service_role;

grant select on publication_quality_scores to anon, authenticated, service_role;
grant insert, update, delete on publication_quality_scores to service_role;
