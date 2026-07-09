-- Registro permanente de cada correo de notas de Gemini que llega al endpoint
-- /api/import-gemini-email desde los Apps Script del equipo. Un renglón por
-- correo recibido (incluidos duplicados y errores), para auditar qué meets
-- llegan, de quién y qué pasó con cada uno.
-- Correr en SQL Editor.

create table if not exists gemini_email_log (
  id                 bigserial primary key,
  received_at        timestamptz not null default now(),

  subject            text,
  meeting_title      text,
  email_from         text,           -- buzón del compañero cuyo Apps Script lo envió
  email_to           text,
  email_date         timestamptz,    -- fecha del correo original
  email_message_id   text,
  email_thread_id    text,

  matched_account_id text,
  project_uid        text,
  matched_account_name text,
  match_method       text,           -- folio(XX##) | alias | score(N) | default

  outcome            text not null,  -- analyzed | duplicate_skipped | llm_fallback_regex | error
  llm_used           boolean,
  survey_detected    boolean,
  sesion_score       integer,
  tasks_inserted     integer,
  error              text
);

comment on table gemini_email_log is
  'Bitácora de correos de notas de Gemini recibidos por /api/import-gemini-email: quién los mandó, a qué cliente se asignaron y qué resultado tuvieron.';

create index if not exists gemini_email_log_received on gemini_email_log (received_at desc);
create index if not exists gemini_email_log_account on gemini_email_log (matched_account_id, received_at desc);

alter table gemini_email_log enable row level security;

drop policy if exists "public read gemini_email_log" on gemini_email_log;
create policy "public read gemini_email_log"
  on gemini_email_log for select using (true);

drop policy if exists "service write gemini_email_log" on gemini_email_log;
create policy "service write gemini_email_log"
  on gemini_email_log for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on gemini_email_log to anon, authenticated, service_role;
grant insert, update, delete on gemini_email_log to service_role;
grant usage, select on sequence gemini_email_log_id_seq to service_role;
