-- Deliverable types for publication quality (BW-07-SEM-0002).
-- Adds the "tipo de entregable" leido de la columna Servicio del Sheet, su badge
-- y el puntaje ancla por tipo. Aditiva y no destructiva. Run after 016.
--
-- deliverable_type : tipo canonico (columna_opinion, entrevista, foro_panel,
--                    vinculacion, nota). Origen: columna Servicio del Sheet o,
--                    si viene vacia, inferido del link.
-- note_type        : variante final (exclusiva, cliente_titulo, cliente_cuerpo,
--                    mencion, vinculacion_con_resultado, o = deliverable_type).
-- badge            : etiqueta visible en el dashboard.
-- type_source      : 'sheet' | 'inferred' | 'default' | 'empty'.
-- is_managed       : gestion Blackwell confirmada por definicion (Hallazgo 01).

alter table publication_quality_analyses
  add column if not exists deliverable_type text,
  add column if not exists note_type        text,
  add column if not exists badge            text,
  add column if not exists type_source      text,
  add column if not exists is_managed       boolean not null default true;

create index if not exists publication_quality_deliverable_type
  on publication_quality_analyses (deliverable_type);

-- Los grants de tabla (008) ya cubren las columnas nuevas para select/insert/update.
