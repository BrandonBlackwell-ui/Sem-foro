-- Surveys registrados a mano (cuando el análisis automático no los capturó, p.ej. los
-- que levantó Uriel). La vista "Survey por consultor" los lee con PRIORIDAD sobre
-- Meet/WhatsApp. Escala 0-100 por pregunta.
create table if not exists manual_surveys (
  account_id   text primary key,
  tipo_a       int,
  tipo_b       int,
  answer_a     text,
  answer_b     text,
  survey_date  date,
  set_by       text,
  updated_at   timestamptz not null default now()
);
grant select, insert, update on public.manual_surveys to service_role, anon, authenticated;
