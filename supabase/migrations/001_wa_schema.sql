-- Blackwell Semaforo - WhatsApp/Baileys + shared dashboard state.
-- Run in Supabase SQL Editor before starting wa_listener.

-- wa_groups maps a WhatsApp group JID to a Semaforo account.
create table if not exists wa_groups (
  id          bigserial primary key,
  jid         text not null unique,       -- Example: 120363158461854769@g.us
  name        text not null,
  account_id  text not null,              -- Example: 01, 02, 40
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table wa_groups is 'Maps WhatsApp group JIDs to Semaforo accounts.';
comment on column wa_groups.jid is 'WhatsApp group JID from Baileys msg.key.remoteJid.';


-- wa_messages stores Baileys messages.
-- Normalized fields make querying easy; JSONB fields preserve the original
-- Baileys payload for future media, reaction, quoted-message, and metadata work.
create table if not exists wa_messages (
  id                 bigserial primary key,

  -- Baileys key fields.
  msg_id             text not null,        -- msg.key.id
  remote_jid         text not null,        -- msg.key.remoteJid
  group_jid          text not null,        -- same as remote_jid for group chats
  from_me            boolean not null default false,
  participant_jid    text,                 -- msg.key.participant

  -- Semaforo mapping.
  account_id         text not null,
  group_name         text,

  -- Sender/display fields.
  push_name          text,                 -- msg.pushName
  author             text,                 -- normalized participant/user id

  -- Derived/searchable fields.
  body               text,                 -- text, caption, or reaction text
  msg_type           text not null default 'unknown',
  sent_at            timestamptz not null,
  message_timestamp  bigint,               -- epoch seconds from Baileys
  status             integer,              -- msg.status if Baileys provides it
  broadcast          boolean,

  -- Raw Baileys payloads.
  key                jsonb not null,        -- msg.key
  message            jsonb,                -- msg.message
  raw                jsonb not null,        -- full Baileys message object
  source             text not null default 'baileys',

  created_at         timestamptz not null default now(),
  constraint wa_messages_dedup unique (msg_id, remote_jid)
);

create index if not exists wa_messages_account_sent
  on wa_messages (account_id, sent_at desc);

create index if not exists wa_messages_group_sent
  on wa_messages (group_jid, sent_at desc);

create index if not exists wa_messages_remote_sent
  on wa_messages (remote_jid, sent_at desc);

create index if not exists wa_messages_type_sent
  on wa_messages (msg_type, sent_at desc);

comment on table wa_messages is 'WhatsApp messages captured from Baileys, including raw JSONB payloads.';
comment on column wa_messages.key is 'Original Baileys msg.key object.';
comment on column wa_messages.message is 'Original Baileys msg.message object.';
comment on column wa_messages.raw is 'Full Baileys message as received by the listener.';


-- wa_analysis stores incremental analysis state per account.
create table if not exists wa_analysis (
  account_id       text primary key,
  last_msg_ts      timestamptz,
  rolling_summary  text,
  msg_count_total  integer not null default 0,
  sc_signals       jsonb,
  updated_at       timestamptz not null default now()
);

comment on table wa_analysis is 'Incremental WhatsApp analysis watermark and rolling summary per account.';


-- score_overrides replaces browser-local score edits.
create table if not exists score_overrides (
  account_id     text primary key,
  account_name   text,
  co             numeric check (co between 0 and 100),
  pq             numeric check (pq between 0 and 100),
  sc             numeric check (sc between 0 and 100),
  reason         text,
  note           text,
  set_by         text,
  updated_by     text,
  override_date  date,
  updated_at     timestamptz not null default now()
);

comment on table score_overrides is 'Manual CO/PQ/SC overrides shared by all dashboard users.';


-- account_notes stores account-level notes.
create table if not exists account_notes (
  id          bigserial primary key,
  account_id  text not null,
  body        text not null,
  author      text,
  created_at  timestamptz not null default now()
);

create index if not exists account_notes_account
  on account_notes (account_id, created_at desc);

comment on table account_notes is 'Account notes shared by the team.';


-- Row Level Security.
alter table wa_groups        enable row level security;
alter table wa_messages      enable row level security;
alter table wa_analysis      enable row level security;
alter table score_overrides  enable row level security;
alter table account_notes    enable row level security;

-- Public dashboard reads.
drop policy if exists "public read wa_groups" on wa_groups;
create policy "public read wa_groups"
  on wa_groups for select using (true);

drop policy if exists "public read wa_messages" on wa_messages;
create policy "public read wa_messages"
  on wa_messages for select using (true);

drop policy if exists "public read wa_analysis" on wa_analysis;
create policy "public read wa_analysis"
  on wa_analysis for select using (true);

drop policy if exists "public read score_overrides" on score_overrides;
create policy "public read score_overrides"
  on score_overrides for select using (true);

drop policy if exists "public read account_notes" on account_notes;
create policy "public read account_notes"
  on account_notes for select using (true);

-- Server writes from service_role only for WhatsApp ingestion/analysis.
drop policy if exists "service write wa_groups" on wa_groups;
create policy "service write wa_groups"
  on wa_groups for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service write wa_messages" on wa_messages;
create policy "service write wa_messages"
  on wa_messages for insert with check (auth.role() = 'service_role');

drop policy if exists "service write wa_analysis" on wa_analysis;
create policy "service write wa_analysis"
  on wa_analysis for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Dashboard writes. Keep these open because the current dashboard uses anon.
drop policy if exists "anon write score_overrides" on score_overrides;
create policy "anon write score_overrides"
  on score_overrides for all using (true) with check (true);

drop policy if exists "anon write account_notes" on account_notes;
create policy "anon write account_notes"
  on account_notes for all using (true) with check (true);
