-- Meta mensual de publicaciones (número), calculada por IA barata a partir del texto
-- libre de meta_entregables (el regex del front podía fallar). El dashboard usa este
-- número para el CO y cae al regex solo si está null.
alter table drive_account_intel add column if not exists meta_monthly int;
