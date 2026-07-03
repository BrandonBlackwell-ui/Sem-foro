-- Operational compliance inputs from the media/publications Sheet.
-- Run this after the WhatsApp migrations.

create table if not exists account_publications (
  id                 bigserial primary key,
  account_id         text not null,
  account_name       text,
  sheet_client_name  text,
  source_sheet_id    text not null,
  source_sheet_gid   text,
  source_row_number  integer not null,

  media_name         text,
  provider           text,
  columnist          text,
  total              numeric,
  legal_name         text,
  publication_date   date,
  publication_year   integer,
  publication_month  integer,
  publication_month_name text,
  url                text,
  service            text,
  cost               numeric,
  cost_status        text,
  commission         numeric,
  commission_status  text,
  comments           text,
  raw_row            jsonb not null default '{}'::jsonb,
  synced_at          timestamptz not null default now(),

  unique (source_sheet_id, source_row_number)
);

create index if not exists account_publications_account_date
  on account_publications (account_id, publication_date desc);

create index if not exists account_publications_period
  on account_publications (publication_year desc, publication_month desc);

create table if not exists account_operational_scores (
  account_id                    text not null,
  account_name                  text,
  period_year                   integer not null,
  period_month                  integer not null,
  delivered_publications_count  integer not null default 0,
  committed_publications_count  integer,
  co_publications_score         numeric check (co_publications_score between 0 and 100),
  co_score                      numeric check (co_score between 0 and 100),
  status                        text not null default 'needs_commitment',
  source_sheet_id               text,
  source_sheet_gid              text,
  synced_at                     timestamptz not null default now(),

  primary key (account_id, period_year, period_month)
);

create index if not exists account_operational_scores_account_period
  on account_operational_scores (account_id, period_year desc, period_month desc);

alter table account_publications enable row level security;
alter table account_operational_scores enable row level security;

drop policy if exists "public read account_publications" on account_publications;
create policy "public read account_publications"
  on account_publications for select using (true);

drop policy if exists "public read account_operational_scores" on account_operational_scores;
create policy "public read account_operational_scores"
  on account_operational_scores for select using (true);

drop policy if exists "service write account_publications" on account_publications;
create policy "service write account_publications"
  on account_publications for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service write account_operational_scores" on account_operational_scores;
create policy "service write account_operational_scores"
  on account_operational_scores for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on account_publications to anon, authenticated, service_role;
grant insert, update, delete on account_publications to service_role;
grant usage, select on sequence account_publications_id_seq to service_role;

grant select on account_operational_scores to anon, authenticated, service_role;
grant insert, update, delete on account_operational_scores to service_role;
