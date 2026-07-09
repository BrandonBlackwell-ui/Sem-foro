-- Client roster mirrored from the canonical Google Drive folder
-- (root 1lC48ni6Rg4e_uGtASQfC-QdBd3647LJ_). Refreshed twice a day by the
-- drive_roster_sync GitHub Action. "If there's a folder, there's a project."
-- The dashboard reads this (Supabase-first) to label the Cuentas list with
-- client names + status, replacing the stale static accounts_status.json.
-- Run this in Supabase SQL Editor after 012.

create table if not exists drive_account_roster (
  account_number  text primary key,        -- "01".."45" (folder number)
  folder_id       text,
  folder_title    text,                     -- raw Drive name: "45. INOVAMEDIK /proyecto concluido"
  client_name     text,                     -- cleaned: "INOVAMEDIK"
  status          text not null default 'active',  -- active|concluded|paused|terminated_early|event_single|historical
  status_label    text,                     -- "Concluido" / "Pausa" / ... (null when active)
  modified_time   timestamptz,              -- Drive folder modifiedTime
  synced_at       timestamptz not null default now()
);

comment on table drive_account_roster is
  'Client roster crawled from Google Drive twice daily. Source of truth for which clients exist and their status.';

alter table drive_account_roster enable row level security;

drop policy if exists "public read drive_account_roster" on drive_account_roster;
create policy "public read drive_account_roster"
  on drive_account_roster for select using (true);

drop policy if exists "service write drive_account_roster" on drive_account_roster;
create policy "service write drive_account_roster"
  on drive_account_roster for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on drive_account_roster to anon, authenticated, service_role;
grant insert, update, delete on drive_account_roster to service_role;
