-- Panel de administrador — datos manuales que el dashboard superpone sobre el
-- snapshot del sync de Drive. Todo se escribe vía la ruta serverless /api/admin
-- (service_role + ADMIN_TOKEN); el navegador solo LEE con la llave publishable.
--
-- Idea: el sync de Drive sigue siendo la fuente automática, pero un admin puede
-- (1) dar de alta clientes que aún no tienen carpeta, (2) forzar el status,
-- (3) fijar objetivos, (4) vincular la columna del Sheet, el grupo de WhatsApp
-- y (5) mapear número↔nombre. Las tablas aquí NUNCA las toca el roster sync,
-- así que un alta manual sobrevive a los crawls.
--
-- Correr en el SQL Editor de Supabase después de 019.

-- 1) Clientes creados a mano (sin carpeta de Drive todavía) -------------------
create table if not exists manual_accounts (
  account_number  text primary key,                 -- "46", "47", ...
  client_name     text not null,                     -- "ARRENDO SERV"
  folder_title    text,                              -- "46. ARRENDO SERV" (opcional)
  tier            text,                              -- top|medio|bajo|otra|inactiva|null
  tipo            text,                              -- Fee|Intercambio|Proyecto|...
  ingreso_mxn     numeric,                           -- fee mensual si aplica
  responsable     text,                              -- consultor responsable (etiqueta)
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table manual_accounts is
  'Clientes dados de alta manualmente en el panel admin (aún sin carpeta de Drive). El dashboard los mergea al roster.';

-- 2) Override de status de cuenta ---------------------------------------------
create table if not exists account_status_overrides (
  account_number  text primary key,
  status          text not null,                     -- active|active_new|active_crisis_high|active_litigation|onboarding|paused|concluded|terminated_early|event_single|historical
  note            text,
  set_by          text,
  updated_at      timestamptz not null default now()
);

comment on table account_status_overrides is
  'Status manual de una cuenta; gana sobre el derivedStatus del sync de Drive.';

-- 3) Objetivos manuales (cuando el contrato no los trae) ----------------------
create table if not exists account_objectives (
  account_number  text primary key,
  objetivos       jsonb not null default '[]'::jsonb,  -- ["Contener la conversación adversa", ...]
  set_by          text,
  updated_at      timestamptz not null default now()
);

comment on table account_objectives is
  'Objetivos fijados a mano; el dashboard los usa si drive_account_intel.objetivos viene vacío.';

-- 4) Vínculo con la columna cliente del Sheet de medios -----------------------
--    (alimenta el CO real: publicaciones ejecutadas vs meta)
create table if not exists account_sheet_links (
  id            bigint generated always as identity primary key,
  account_number text not null,
  sheet_id       text,                               -- opcional: qué Sheet
  sheet_value    text not null,                      -- valor exacto de la columna "cliente" en el Sheet
  set_by         text,
  updated_at     timestamptz not null default now(),
  unique (account_number, sheet_value)
);

comment on table account_sheet_links is
  'Alias explícito columna-del-Sheet ↔ cuenta, para que sync_media_sheet mapee bien las publicaciones.';

-- 5) Vínculo con grupos de WhatsApp -------------------------------------------
create table if not exists account_wa_links (
  id            bigint generated always as identity primary key,
  account_number text not null,
  wa_group_name  text not null,                      -- nombre del grupo de WhatsApp
  wa_group_id    text,                               -- jid/id si se conoce
  set_by         text,
  updated_at     timestamptz not null default now(),
  unique (account_number, wa_group_name)
);

comment on table account_wa_links is
  'Mapa grupo de WhatsApp ↔ cuenta (reemplaza/complementa account_crosswalk manual).';

-- 6) Número de WhatsApp ↔ nombre de persona -----------------------------------
create table if not exists wa_number_names (
  phone         text primary key,                    -- E.164 normalizado, ej. "5215512345678"
  display_name  text not null,
  account_number text,                               -- opcional: a qué cuenta pertenece
  role          text,                                -- cliente|consultor|otro
  set_by        text,
  updated_at    timestamptz not null default now()
);

comment on table wa_number_names is
  'Identidad de un número de WhatsApp (número↔nombre) para atribuir mensajes en el survey.';

-- RLS: lectura pública (dashboard con anon key), escritura solo service_role ---
do $$
declare t text;
begin
  foreach t in array array[
    'manual_accounts','account_status_overrides','account_objectives',
    'account_sheet_links','account_wa_links','wa_number_names'
  ] loop
    execute format('alter table %I enable row level security;', t);

    execute format('drop policy if exists "public read %1$s" on %1$s;', t);
    execute format('create policy "public read %1$s" on %1$s for select using (true);', t);

    execute format('drop policy if exists "service write %1$s" on %1$s;', t);
    execute format($p$create policy "service write %1$s" on %1$s for all
                     using (auth.role() = 'service_role')
                     with check (auth.role() = 'service_role');$p$, t);

    execute format('grant select on %I to anon, authenticated, service_role;', t);
    execute format('grant insert, update, delete on %I to service_role;', t);
  end loop;
end $$;
