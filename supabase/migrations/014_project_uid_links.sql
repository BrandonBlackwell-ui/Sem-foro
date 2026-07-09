-- Propaga el folio de cliente (blackwell_projects.project_uid, ej. CO29) a todas
-- las tablas de cliente como columna de ENLACE, para saber a qué cliente pertenece
-- cada registro (tareas, análisis, CO/Sheets, roster, etc.) sin reemplazar las
-- PKs actuales (que romperían el pipeline y el front). Backfill por número.
-- Requisitos: correr PRIMERO 011_blackwell_project_uid.sql. Correr en SQL Editor.

-- account_id es texto "01".."45"; enlazamos con project_number vía entero para
-- tolerar ceros a la izquierda. Sólo filas cuyo account_id es numérico.

-- wa_account_scores
alter table wa_account_scores add column if not exists project_uid text references blackwell_projects(project_uid);
update wa_account_scores x set project_uid = bp.project_uid
  from blackwell_projects bp
 where x.project_uid is null and x.account_id ~ '^[0-9]+$' and bp.project_number::int = x.account_id::int;
create index if not exists wa_account_scores_project_uid on wa_account_scores(project_uid);

-- wa_daily_analysis
alter table wa_daily_analysis add column if not exists project_uid text references blackwell_projects(project_uid);
update wa_daily_analysis x set project_uid = bp.project_uid
  from blackwell_projects bp
 where x.project_uid is null and x.account_id ~ '^[0-9]+$' and bp.project_number::int = x.account_id::int;
create index if not exists wa_daily_analysis_project_uid on wa_daily_analysis(project_uid);

-- wa_tasks (incluye la vinculación con Monday, que vive en esta misma tabla)
alter table wa_tasks add column if not exists project_uid text references blackwell_projects(project_uid);
update wa_tasks x set project_uid = bp.project_uid
  from blackwell_projects bp
 where x.project_uid is null and x.account_id ~ '^[0-9]+$' and bp.project_number::int = x.account_id::int;
create index if not exists wa_tasks_project_uid on wa_tasks(project_uid);

-- meet_transcription_analyses (survey + sesión)
alter table meet_transcription_analyses add column if not exists project_uid text references blackwell_projects(project_uid);
update meet_transcription_analyses x set project_uid = bp.project_uid
  from blackwell_projects bp
 where x.project_uid is null and x.account_id ~ '^[0-9]+$' and bp.project_number::int = x.account_id::int;
create index if not exists meet_transcription_analyses_project_uid on meet_transcription_analyses(project_uid);

-- account_publications (fuente Sheets / CO)
alter table account_publications add column if not exists project_uid text references blackwell_projects(project_uid);
update account_publications x set project_uid = bp.project_uid
  from blackwell_projects bp
 where x.project_uid is null and x.account_id ~ '^[0-9]+$' and bp.project_number::int = x.account_id::int;
create index if not exists account_publications_project_uid on account_publications(project_uid);

-- account_operational_scores (score CO)
alter table account_operational_scores add column if not exists project_uid text references blackwell_projects(project_uid);
update account_operational_scores x set project_uid = bp.project_uid
  from blackwell_projects bp
 where x.project_uid is null and x.account_id ~ '^[0-9]+$' and bp.project_number::int = x.account_id::int;

-- publication_quality (PQ)
alter table publication_quality_analyses add column if not exists project_uid text references blackwell_projects(project_uid);
update publication_quality_analyses x set project_uid = bp.project_uid
  from blackwell_projects bp
 where x.project_uid is null and x.account_id ~ '^[0-9]+$' and bp.project_number::int = x.account_id::int;

alter table publication_quality_scores add column if not exists project_uid text references blackwell_projects(project_uid);
update publication_quality_scores x set project_uid = bp.project_uid
  from blackwell_projects bp
 where x.project_uid is null and x.account_id ~ '^[0-9]+$' and bp.project_number::int = x.account_id::int;

-- drive_account_roster (usa account_number)
alter table drive_account_roster add column if not exists project_uid text references blackwell_projects(project_uid);
update drive_account_roster x set project_uid = bp.project_uid
  from blackwell_projects bp
 where x.project_uid is null and x.account_number ~ '^[0-9]+$' and bp.project_number::int = x.account_number::int;
