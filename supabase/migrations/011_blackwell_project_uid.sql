-- Stable short project IDs for Blackwell projects.
-- Keeps existing account_id values intact and adds project_uid as a secondary key.

create table if not exists blackwell_projects (
  project_uid     text primary key,
  project_number  text not null unique,
  project_name    text,
  status          text not null default 'unknown',
  status_note     text,
  folder_label    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint blackwell_projects_uid_format
    check (project_uid ~ '^[A-Z]{2}[0-9]{2}$')
);

comment on table blackwell_projects is 'Canonical Blackwell project registry. project_uid is a short stable ID such as TU01 or GC13.';
comment on column blackwell_projects.project_uid is 'Two-letter mnemonic plus the project number; does not replace account_id.';
comment on column blackwell_projects.project_number is 'Legacy numeric project/account slot used by the dashboard and WhatsApp pipeline.';

alter table wa_groups
  add column if not exists project_uid text references blackwell_projects(project_uid);

create index if not exists wa_groups_project_uid
  on wa_groups (project_uid);

insert into blackwell_projects (project_uid, project_number, project_name, status, status_note, folder_label)
values
  ('TU01', '01', 'TURBOFIN', 'active', null, '01. TURBOFIN'),
  ('MA02', '02', 'MAJA', 'active', null, '02. MAJA'),
  ('AD03', '03', 'ADUANAS', 'concluded', 'proyecto concluido', '03. ADUANAS/proyecto concluido'),
  ('ID04', '04', 'IDLAYR', 'concluded', 'proyecto concluido', '04. IDLAYR /proyecto concluido'),
  ('CR05', '05', 'CREDIX', 'active', null, '05. CREDIX'),
  ('RR06', '06', 'RR', 'active', null, '06. RR'),
  ('AP07', '07', 'APOLLO', 'active', null, '07. APOLLO'),
  ('UL08', '08', 'ULDIS', 'terminated_early', 'Terminacion Anticipada', '08. ULDIS/Terminacion Anticipada'),
  ('GA09', '09', 'GRUPO AZVI', 'active', null, '09. GRUPO AZVI'),
  ('JL10', '10', 'JACK LEVI', 'paused', 'Detenido', '10. JACK LEVI/ Detenido'),
  ('AD11', '11', 'ASCENSO Y DESCENSO', 'paused', 'Detenido', '11. ASCENSO Y DESCENSO/ Detenido'),
  ('MT12', '12', 'MTV', 'active', null, '12. MTV'),
  ('GC13', '13', 'GRUPO CIMA', 'active', null, '13. GRUPO CIMA'),
  ('DA14', '14', 'DALINDE', 'active', null, '14. DALINDE'),
  ('AL15', '15', 'ARMOR LIFE LAB', 'terminated_early', 'terminacion anticipada', '15.ARMOR LIFE LAB /terminacion anticipada'),
  ('MP16', '16', 'MAPELLY', 'concluded', 'proyecto concluido', '16. MAPELLY/proyecto concluido'),
  ('IR17', '17', 'IRUGAMI', 'active', null, '17. IRUGAMI'),
  ('ST18', '18', 'STPRM', 'active', null, '18. STPRM'),
  ('CM19', '19', 'Casa Mata', 'active', null, '19. Casa Mata'),
  ('VE20', '20', 'VERACRUZ', 'active', null, '20. VERACRUZ'),
  ('NU21', '21', 'Nuvoil', 'active', null, '21. Nuvoil'),
  ('TP22', '22', 'TOTALPLAY', 'concluded', 'Proyecto concluido', '22.TOTALPLAY / Proyecto concluido'),
  ('LU23', '23', 'LUCA', 'terminated_early', 'Terminacion Anticipada', '23. LUCA/Terminacion Anticipada'),
  ('GI24', '24', 'GICSA', 'concluded', 'Proyecto concluido', '24. GICSA /Proyecto concluido'),
  ('AN25', '25', 'ANDY', 'unknown', 'Not visible in provided screenshots; exists in local dashboard data.', '25. ANDY'),
  ('BV26', '26', 'BERNARDO V', 'active', null, '26. BERNARDO V'),
  ('CU27', '27', 'CUERNAVACA', 'active', null, '27. CUERNAVACA'),
  ('QU28', '28', 'QUERETARO', 'active', null, '28. QUERETARO'),
  ('CO29', '29', 'COAST OIL', 'active', null, '29. COAST OIL'),
  ('ER30', '30', 'ERICK RUBI', 'active', null, '30. ERICK RUBI'),
  ('SA31', '31', 'SASIL', 'concluded', 'proyecto concluido', '31. SASIL/proyecto concluido'),
  ('CJ32', '32', 'COJAB', 'concluded', 'proyecto concluido', '32. COJAB / proyecto concluido'),
  ('NE33', '33', 'NEZA', 'active', null, '33. NEZA'),
  ('SP34', '34', 'SUPPLY_PAY', 'active', null, '34. SUPPLY_PAY'),
  ('PA35', '35', 'PEPE AGUILAR', 'active', null, '35. PEPE AGUILAR'),
  ('PX36', '36', null, 'unknown', 'Not visible in provided screenshots.', null),
  ('LS37', '37', 'LEADSALES', 'concluded', 'Proyecto concluido', '37. LEADSALES / Proyecto concluido'),
  ('KP38', '38', 'KARPOWERSHIP', 'active', null, '38. KARPOWERSHIP'),
  ('IS39', '39', 'ISMERELY', 'active', null, '39. ISMERELY'),
  ('AU40', '40', 'AUSTRIA', 'active', null, '40. AUSTRIA'),
  ('IC41', '41', 'IFA CELTICS', 'active', null, '41. IFA CELTICS'),
  ('ML42', '42', 'MTV Linkedin', 'active', null, '42. MTV Linkedin'),
  ('IG43', '43', 'IRAN GUERRERO', 'active', null, '43. IRAN GUERRERO'),
  ('LL44', '44', 'LCH Luxury Travel', 'active', null, '44. LCH Luxury Travel'),
  ('IN45', '45', 'INOVAMEDIK', 'active', null, '45. INOVAMEDIK')
on conflict (project_uid) do update set
  project_number = excluded.project_number,
  project_name = excluded.project_name,
  status = excluded.status,
  status_note = excluded.status_note,
  folder_label = excluded.folder_label,
  updated_at = now();

update wa_groups as wg
set project_uid = bp.project_uid
from blackwell_projects as bp
where wg.account_id = bp.project_number
  and wg.account_id <> '00_UNMAPPED';

alter table blackwell_projects enable row level security;

drop policy if exists "public read blackwell_projects" on blackwell_projects;
create policy "public read blackwell_projects"
  on blackwell_projects for select using (true);

drop policy if exists "service write blackwell_projects" on blackwell_projects;
create policy "service write blackwell_projects"
  on blackwell_projects for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on blackwell_projects to anon, authenticated, service_role;
grant insert, update, delete on blackwell_projects to service_role;
