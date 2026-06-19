-- Store task-level origin evidence for Monday, frontend, and chatbot use.

alter table wa_tasks
  add column if not exists evidence_speaker text,
  add column if not exists evidence_quote text,
  add column if not exists evidence_reason text,
  add column if not exists monday_created_at timestamptz;

comment on column wa_tasks.evidence_speaker is 'Who said or triggered the task, inferred by the LLM from WhatsApp transcript.';
comment on column wa_tasks.evidence_quote is 'Short WhatsApp quote that supports the task.';
comment on column wa_tasks.evidence_reason is 'Why the quote became a task.';
comment on column wa_tasks.monday_created_at is 'Creation timestamp from Monday item.';
