-- Two faster voices for listeners who find the others slow (pace text lives in packages/shared/src/config/ai.ts).
insert into voices (id, provider, provider_voice_id, name, description, preview_path, words_per_minute) values
  ('nova', 'openai', 'nova', 'Nova', 'Quick and energetic', 'voices/nova.mp3', 195),
  ('echo', 'openai', 'echo', 'Echo', 'Fast and sharp', 'voices/echo.mp3', 195)
on conflict (id) do nothing;
