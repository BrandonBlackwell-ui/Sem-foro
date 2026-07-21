-- La llave de publication_quality_analyses era url ÚNICA GLOBAL: dos clientes con la
-- misma URL (nota que menciona a ambos, registrada dos veces en el Sheet) se PISABAN
-- el análisis y el pisado nunca se re-analizaba. Ahora la unicidad es por
-- (url, account_id): cada cliente conserva su propio análisis de la misma nota.
-- Run after 017.

alter table publication_quality_analyses
  drop constraint if exists publication_quality_analyses_url_key;

alter table publication_quality_analyses
  add constraint publication_quality_analyses_url_account_key unique (url, account_id);
