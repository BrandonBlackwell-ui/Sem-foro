-- Make daily WhatsApp analysis group-scoped.
-- Safe to run after 002_wa_daily_analysis.sql.

alter table wa_daily_analysis
  add column if not exists group_jid text,
  add column if not exists group_name text;

update wa_daily_analysis
set group_name = coalesce(group_name, group_names[1])
where group_name is null;

-- Existing installs from 002 had one row per account/day.
-- New analyzer writes one row per account/group/day.
alter table wa_daily_analysis
  drop constraint if exists wa_daily_analysis_account_id_analysis_date_key;

create unique index if not exists wa_daily_analysis_account_group_date_key
  on wa_daily_analysis (account_id, group_jid, analysis_date)
  where group_jid is not null;

create index if not exists wa_daily_analysis_group_date
  on wa_daily_analysis (group_jid, analysis_date desc);
