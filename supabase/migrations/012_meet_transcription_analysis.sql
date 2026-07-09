-- Meet/session transcription analysis (survey + session score + action items)
-- produced by the Gemini-notes email pipeline (/api/import-gemini-email).
-- Replaces the static checklist.json `scores[period].transcripciones` source so
-- the survey/session data lives in Supabase and the dashboard reads it live.
-- Run this in Supabase SQL Editor after 011.

create table if not exists meet_transcription_analyses (
  id                     bigserial primary key,

  account_id             text not null,
  account_name           text,
  period                 text not null,               -- YYYY-MM
  meeting_title          text,
  meeting_date           timestamptz,

  -- Deduplication: sha256 of normalized (subject + body). Stable across
  -- mailboxes, so the same Gemini email forwarded by several teammates —
  -- or re-sent on another day — is analyzed (and billed) only once.
  dedup_key              text not null unique,

  -- Session (SC) signals
  sesion_score           integer,
  attended               boolean,
  attended_on_time       boolean,
  participation_level    text,
  positive_comments      boolean,
  shared_strategic_info  boolean,
  negative_signals       boolean,
  negative_detail        text,
  tone                   text,

  -- Survey (question_a / question_b) as produced by the LLM
  survey                 jsonb,
  -- Structured action items extracted by the LLM (also mirrored into wa_tasks)
  action_items           jsonb not null default '[]'::jsonb,
  checklist              jsonb not null default '[]'::jsonb,
  reasoning              text,

  source                 text not null default 'gemini_meet_email',
  email_message_id       text,
  email_thread_id        text,
  email_from             text,

  model                  text,
  raw_analysis           jsonb,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table meet_transcription_analyses is
  'Meet/session transcription analysis (survey + sesion_score + action items) from Gemini notes emails. Deduped by content hash before the LLM is called.';
comment on column meet_transcription_analyses.dedup_key is
  'sha256 of normalized (subject + body). Unique — blocks re-analysis of the same notes across mailboxes and days.';
comment on column meet_transcription_analyses.period is 'Meeting month in YYYY-MM (America/Mexico_City).';

create index if not exists meet_transcription_analyses_account_period
  on meet_transcription_analyses (account_id, period desc);

create index if not exists meet_transcription_analyses_created
  on meet_transcription_analyses (created_at desc);

alter table meet_transcription_analyses enable row level security;

drop policy if exists "public read meet_transcription_analyses" on meet_transcription_analyses;
create policy "public read meet_transcription_analyses"
  on meet_transcription_analyses for select using (true);

drop policy if exists "service write meet_transcription_analyses" on meet_transcription_analyses;
create policy "service write meet_transcription_analyses"
  on meet_transcription_analyses for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on meet_transcription_analyses to anon, authenticated, service_role;
grant insert, update, delete on meet_transcription_analyses to service_role;
grant usage, select on sequence meet_transcription_analyses_id_seq to service_role;
