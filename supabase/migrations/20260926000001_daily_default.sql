-- Briefcast is a daily podcast, so new listeners get an episode every day.
-- "Weekdays" (Monday to Friday) is still a choice in Settings.
-- Existing listeners keep what they have.
alter table podcast_settings alter column frequency set default 'daily';
