-- Propaga el folio de cliente (blackwell_projects.project_uid, ej. CO29) a las
-- tablas de cliente como columna de ENLACE, para saber a qué cliente pertenece
-- cada registro (tareas, análisis, CO/Sheets, roster, etc.) sin reemplazar las
-- PKs actuales. Backfill por número.
--
-- Idempotente y tolerante: cada tabla se procesa sólo si existe (to_regclass),
-- así no truena si alguna migración previa (p. ej. 007) no se corrió. Se puede
-- re-correr completo las veces que haga falta.
-- Requisito: correr PRIMERO 011_blackwell_project_uid.sql. Correr en SQL Editor.

do $$
declare
  t record;
  -- tabla -> columna con el número de cuenta ("01".."45")
  targets text[][] := array[
    ['wa_account_scores',            'account_id'],
    ['wa_daily_analysis',            'account_id'],
    ['wa_tasks',                     'account_id'],
    ['meet_transcription_analyses',  'account_id'],
    ['account_publications',         'account_id'],
    ['account_operational_scores',   'account_id'],
    ['publication_quality_analyses', 'account_id'],
    ['publication_quality_scores',   'account_id'],
    ['drive_account_roster',         'account_number']
  ];
  i int;
  tbl text;
  col text;
begin
  for i in 1 .. array_length(targets, 1) loop
    tbl := targets[i][1];
    col := targets[i][2];

    if to_regclass('public.' || tbl) is null then
      raise notice 'Skipping % (no existe)', tbl;
      continue;
    end if;

    -- 1) columna de enlace
    execute format(
      'alter table %I add column if not exists project_uid text references blackwell_projects(project_uid)',
      tbl
    );

    -- 2) backfill por número (sólo filas con clave numérica)
    execute format(
      'update %1$I x set project_uid = bp.project_uid
         from blackwell_projects bp
        where x.project_uid is null
          and x.%2$I ~ ''^[0-9]+$''
          and bp.project_number::int = x.%2$I::int',
      tbl, col
    );

    -- 3) índice
    execute format(
      'create index if not exists %I on %I (project_uid)',
      tbl || '_project_uid', tbl
    );

    raise notice 'OK % (enlazado por %)', tbl, col;
  end loop;
end $$;
