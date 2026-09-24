# Briefcast

A personal daily podcast for one listener: a thinking partner in audio, not a news summary.
(Briefcast is a working name. Change it in `packages/shared/src/config/app.ts`.)

- **Plan:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architecture, data model, screens, build steps
- **Demo for friends:** [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md) — test with friends first, no company needed
- **Accounts (full launch):** [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md) — every account and key, step by step

## What is in this repo

| Folder | What |
|---|---|
| `packages/shared` | Config (app name, prices, AI models, voices, limits) and shared types |
| `services/worker` | Episode pipeline: collect → rank → plan → write → check → voice. Has a CLI. |
| `supabase/migrations` | Database tables, security rules (RLS), scheduling, queue and cron |
| `supabase/seed.sql` | Topic categories, voices, starter discovery sources |
| `apps/web` | Demo web app (mobile website): onboarding, player, feedback. Preview mode without a backend. |
| `supabase/functions` | Edge Functions: profile encryption, podcast search, "make it now", delete account |
| `.github/workflows` | CI tests, and the hourly episode worker for the demo |
| `apps/mobile` | iOS app (Expo). Comes after the demo. |

## Requirements

- Node.js 22+ and pnpm 10 (`corepack enable`)
- For real audio: `ffmpeg` (`brew install ffmpeg` on Mac)

## Run the tests

```bash
pnpm install
pnpm test          # database rules + pipeline, all offline
pnpm typecheck
```

The database tests use PGlite (Postgres in WebAssembly), so no Docker or Supabase is needed.

## Make an episode on your computer

**Dry run, no keys needed** (checks the flow, length and cost estimate, with placeholder text):

```bash
pnpm episode --profile examples/profile.offline.json --mock
```

**Real episode** (needs `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`, see the setup guide):

```bash
cd services/worker
cp examples/profile.example.json my-profile.json   # edit it: your profile, interests, feeds
pnpm episode --profile my-profile.json             # full episode with audio
pnpm episode --profile my-profile.json --no-audio  # script only, cheaper while tuning prompts
pnpm episode --profile my-profile.json --format conversation --minutes 10
pnpm episode --profile my-profile.json --type deep_dive
```

The output goes to `services/worker/out/<time>/`:
- `script.md` — the script with chapters, sources and check findings (easy to read)
- `episode.json` — everything: plan, chapters, transcript, sources, cost per step
- `episode.mp3` — the audio (when ffmpeg is installed and voice is on)

Your profile file stays on your computer. `out/` and `.env` are in `.gitignore`.

## Try the demo app

```bash
pnpm --filter @briefcast/web dev
```

Without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` it runs in **preview mode** with sample data.
With them (see `apps/web/.env.example`) it uses the real backend.

## Worker commands (need Supabase keys)

```bash
pnpm --filter @briefcast/worker worker:run       # one run: due episodes, learning, queued episodes
pnpm --filter @briefcast/worker demo:invite --count 5
pnpm --filter @briefcast/worker demo:stats
```

## Where to change things

| To change | Edit |
|---|---|
| App name, domain, prices, trial | `packages/shared/src/config/app.ts` |
| Claude models per step, TTS provider, voices, prices for cost logs | `packages/shared/src/config/ai.ts` |
| Words per minute, length tolerance, cost cap, lookback days | `packages/shared/src/config/limits.ts` |
| What the episodes sound like | `services/worker/src/prompts/index.ts` |

## Database (Supabase)

```bash
supabase link --project-ref <your-project-ref>
supabase db push          # applies supabase/migrations
psql "$DATABASE_URL" -f supabase/seed.sql
```

## Build status

| Step | Status |
|---|---|
| 1. Repo, config, schema, RLS, seed | Done |
| 2. Pipeline CLI | Done (offline). Needs API keys for the first real episode |
| Demo: web app, worker job, learning loop, Edge Functions | Done (preview mode tested). Needs accounts to go live |
| 3. Quality round | Starts with the demo |
| iOS app, payments, App Store | After the demo decision |
