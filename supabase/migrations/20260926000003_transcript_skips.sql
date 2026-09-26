-- Briefcast schema: podcast episodes the worker decided not to transcribe.
-- Speech-to-text costs money, so a cheap model first scores each new episode for the people who
-- follow the show. Low scores are saved as 'skipped' so they are not checked again every hour.

alter table episode_transcripts drop constraint episode_transcripts_status_check;
alter table episode_transcripts add constraint episode_transcripts_status_check
  check (status in ('done', 'failed', 'skipped'));
alter table episode_transcripts add column value smallint;    -- 0-10 score from the check, null when not scored
alter table episode_transcripts add column reason text;       -- why it was picked or skipped (no personal data)
