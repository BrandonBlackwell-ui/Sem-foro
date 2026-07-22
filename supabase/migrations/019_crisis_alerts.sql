-- Sistema de alertas de crisis (Nivel 3+): estado por cuenta + outbox de envíos.
-- El documento de crisis se genera con las metodologías (R3/Lehane/Agente IA), se envía a
-- los CONSULTORES (nunca al cliente) vía Baileys, y se cierra tras 48h de calma.

-- Nivel de crisis 0..4 por análisis diario (lo produce el LLM del wa_daily_analyzer).
alter table wa_daily_analysis add column if not exists crisis_level int;

-- Estado de crisis por cuenta (máquina de estados).
create table if not exists crisis_state (
  account_id          text primary key,
  account_name        text,
  status              text not null default 'none',   -- none | active | deescalating | closed
  level               int  not null default 0,        -- nivel actual 0..4
  peak_level          int  not null default 0,        -- nivel máximo alcanzado en esta crisis
  crisis_signature    text,                            -- firma de la crisis (dedup/continuidad)
  opened_at           timestamptz,
  last_escalation_at  timestamptz,                     -- última subida de nivel
  last_active_at      timestamptz,                     -- última vez con nivel >= 3
  last_reeval_at      timestamptz,                     -- para throttle del portero
  last_digest_on      date,                            -- último día que se mandó digest
  closed_at           timestamptz,
  updated_at          timestamptz not null default now()
);

-- Outbox: cada fila es un mensaje a enviar por WhatsApp (lo consume el wa_listener).
create table if not exists crisis_alerts (
  id            bigint generated always as identity primary key,
  account_id    text not null,
  account_name  text,
  kind          text not null,                          -- escalation | digest | closure
  level         int,
  title         text,
  document      text not null,
  to_phones     text[] not null default '{}',
  status        text not null default 'pending',        -- pending | sent | failed | skipped
  dedup_key     text unique,                            -- evita duplicados (misma crisis/día)
  attempts      int  not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);

create index if not exists crisis_alerts_pending_idx on crisis_alerts (created_at) where status = 'pending';

-- Las tablas creadas por SQL directo no heredan los privilegios de la API REST (service_role).
-- El wa_listener accede vía REST con el service key, así que hay que otorgarlos explícitamente.
grant select, insert, update on public.crisis_state  to service_role;
grant select, insert, update on public.crisis_alerts to service_role;
