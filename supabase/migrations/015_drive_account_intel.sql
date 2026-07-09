-- Inteligencia documental por cliente, extraída de la carpeta de Drive:
-- inventario de documentos + análisis LLM de los contratos (vigencias, objetivos,
-- montos, entregables comprometidos para el CO, faltantes documentales).
-- Poblada por el análisis de contratos (scripts locales / futuro workflow).
-- Correr en SQL Editor después de 011 (folios).

create table if not exists drive_account_intel (
  account_number         text primary key,          -- "01".."45"
  project_uid            text references blackwell_projects(project_uid),
  client_name            text,
  folder_title           text,

  -- inventario
  docs_total             integer,
  subfolders             jsonb not null default '[]'::jsonb,
  contract_docs          jsonb not null default '[]'::jsonb,  -- [{path, modified}]
  analyzed_docs          jsonb not null default '[]'::jsonb,  -- [{name, kind, modified}]

  -- análisis del contrato (LLM)
  resumen                text,
  tiene_contrato_firmado boolean,
  tipo_acuerdo           text,           -- contrato|ODC|propuesta|convenio_intercambio|anexo
  vigencia_inicio        date,
  vigencia_fin           date,
  monto                  text,
  periodicidad_pago      text,
  objetivos              jsonb not null default '[]'::jsonb,
  servicios              jsonb not null default '[]'::jsonb,
  meta_entregables       text,           -- entregables/mes comprometidos (insumo del CO)
  contratos_previos      jsonb not null default '[]'::jsonb,
  renovacion             text,
  faltantes              jsonb not null default '[]'::jsonb,  -- huecos documentales
  notas                  text,

  intel                  jsonb,          -- salida completa del LLM (respaldo)
  model                  text,
  synced_at              timestamptz not null default now()
);

comment on table drive_account_intel is
  'Inventario + análisis LLM de los documentos de cada carpeta de cliente en Drive (contratos, vigencias, objetivos, faltantes).';
comment on column drive_account_intel.meta_entregables is
  'Entregables comprometidos por periodo según contrato/propuesta — insumo para la meta del CO.';

alter table drive_account_intel enable row level security;

drop policy if exists "public read drive_account_intel" on drive_account_intel;
create policy "public read drive_account_intel"
  on drive_account_intel for select using (true);

drop policy if exists "service write drive_account_intel" on drive_account_intel;
create policy "service write drive_account_intel"
  on drive_account_intel for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on drive_account_intel to anon, authenticated, service_role;
grant insert, update, delete on drive_account_intel to service_role;
