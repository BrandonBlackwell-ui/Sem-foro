-- Decaimiento por inactividad del grupo de WhatsApp (solo días laborales).
-- silent_streak = días hábiles consecutivos sin movimiento; last_silent_date evita
-- que las 5 corridas diarias del cron cuenten el mismo día más de una vez.
alter table wa_account_scores add column if not exists silent_streak int not null default 0;
alter table wa_account_scores add column if not exists last_silent_date date;
