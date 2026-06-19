-- Add chatbot-friendly speaker identity fields to raw WhatsApp messages.
-- The raw Baileys payload remains in key/message/raw; these columns make
-- "who said what" easy to query without reparsing JSON or phone maps.

alter table wa_messages
  add column if not exists speaker_name text,
  add column if not exists speaker_team text,
  add column if not exists speaker_label text;

create index if not exists wa_messages_speaker_team_sent
  on wa_messages (speaker_team, sent_at desc);

comment on column wa_messages.speaker_name is 'Resolved sender name from data/wa_participants.json or WhatsApp push_name.';
comment on column wa_messages.speaker_team is 'Resolved sender team, for example Blackwell or Cliente.';
comment on column wa_messages.speaker_label is 'Display label such as "Daniel (Blackwell)" for chatbot/front usage.';

grant select on wa_messages to anon, authenticated, service_role;
grant insert, update on wa_messages to service_role;
