# Demo Guide: test Briefcast with friends (no company needed)

Goal: find out, cheaply and quickly, **whether friends listen almost every day**, before you spend money
on a company, the Apple account and the full app.

## What the demo is

- A **mobile website**. Friends open a link on their phone. There is nothing to install.
  (Tip for them: Share → "Add to Home Screen", so it opens like an app.)
- They join with an **invite code** from you, so strangers cannot use your AI budget.
- Onboarding, daily episodes, player with chapters, transcript, sources, feedback with "Go deeper",
  and the learning loop are all included.
- **Not in the demo:** Apple login, payments, push notifications, newsletter forwarding, CarPlay, offline mode.

## What it costs

| Item | Cost |
|---|---|
| Supabase (database, login, file storage) | Free plan, no card |
| Cloudflare Pages (hosts the website) | Free, no card |
| GitHub Actions (makes the episodes) | Free minutes are enough for about 10 friends |
| Anthropic + OpenAI (writing and voice) | About $0.20 for a 10-minute episode, $0.30–0.50 for 15–20 minutes |

**Honest estimate:** 5 friends, weekdays, 10–15 minutes each → about **$25–40 a month**.
10 friends → about **$50–80 a month**. Set spend limits (below), so it can never be more than you choose.
Tip: start with 5 friends for 2 weeks. That is enough to learn a lot.

## Limits of a test version (tell your friends)

- The account lives in the browser on their phone. If they change phone or browser, or clear data, they
  start again. (Fine for a test. The real app will have a proper login.)
- Episodes arrive at about the chosen time (the worker runs every hour, and GitHub is sometimes late
  by 10–20 minutes).
- The first episode takes about 3–5 minutes after sign-up.

---

## Setup, step by step (about 1 hour)

You click through the websites. I do the technical parts (database and server functions) from here.

**Golden rule:** never paste a key into the chat. Keys go only where this guide says.

### Step 1 — Anthropic key (Claude writes the episodes)

1. Open `console.anthropic.com` → sign up (a personal email is fine for the demo).
2. **Billing** → add your card → buy **$20** of credits.
3. **Limits** → set a monthly spend limit, for example **$40**.
4. **API Keys** → **Create Key** → name it `briefcast-demo` → copy it into your password manager.
   You can see it only once.

### Step 2 — OpenAI key (the voices)

1. Open `platform.openai.com` → sign up.
2. **Settings → Billing** → add your card → add **$10**.
3. **Settings → Limits** → set a monthly budget, for example **$30**.
4. **API keys** → **Create new secret key** → name it `briefcast-demo` → save it in your password manager.

### Step 3 — Supabase project (free)

1. Open `supabase.com` → **Start your project** → sign in with GitHub.
2. **New project**: name `briefcast-demo`, click **Generate a password** and save it, choose a region
   close to you (for example Frankfurt). Plan: **Free**.
3. Turn on guest sign-in: **Authentication → Sign In / Providers → "Allow anonymous sign-ins"** → on → Save.
4. Collect these values (save them in your password manager):
   - **Project Settings → API**: `Project URL`, `anon public` key, `service_role` key (secret!)
   - **Project Settings → General**: `Reference ID` (not secret)
   - Your personal access token: click your avatar (top right) → **Account preferences → Access Tokens**
     → **Generate new token** → name it `briefcast-deploy`. (This lets me set up the database for you.)

### Step 4 — Make an encryption key

This key protects what friends write in "About you".
On a Mac, open **Terminal** and run:

```
openssl rand -base64 32
```

Save the result in your password manager as `CONTEXT_ENCRYPTION_KEY`. You will paste it in two places
(steps 5 and 6). Use the same value in both.

### Step 5 — Keys for the episode worker (GitHub)

1. Open the repository on GitHub → **Settings → Secrets and variables → Actions → New repository secret**.
2. Add these 5 secrets (name → value):
   - `ANTHROPIC_API_KEY` → from step 1
   - `OPENAI_API_KEY` → from step 2
   - `SUPABASE_URL` → Project URL from step 3
   - `SUPABASE_SERVICE_ROLE_KEY` → service_role key from step 3
   - `CONTEXT_ENCRYPTION_KEY` → from step 4
3. **Settings → General → Default branch**: check which branch it is. The hourly worker runs only on the
   default branch. Tell me the name, and I will make sure the worker file is there.

### Step 6 — Give me access to set up Supabase

In this Claude workspace: environment menu in the title bar → **Edit** → add environment variables:

- `SUPABASE_ACCESS_TOKEN` → the access token from step 3
- `SUPABASE_PROJECT_REF` → the Reference ID from step 3
- `SUPABASE_DB_PASSWORD` → the database password from step 3
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` → from step 3 (to create invite codes and read the stats)
- `CONTEXT_ENCRYPTION_KEY` → from step 4
- `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` → so I can make test episodes here too

Under **Network access**, allow: `api.supabase.com`, `*.supabase.co`, `api.openai.com`, and the RSS feed
websites (choosing full network access is easiest).

Then start a new session and tell me "demo keys are added". I will:
- create the database tables and security rules,
- deploy the 4 small server functions (profile encryption, podcast search, "make it now", delete account),
- make a test episode for you,
- create invite codes.

### Step 7 (optional) — Episodes right after sign-up

Without this step, a new episode waits for the next hourly run. With it, episodes start in about 1 minute.

1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token**.
2. Name `briefcast-kick`. Repository access: **Only select repositories** → this repo.
   Permissions → **Actions: Read and write**. Expiry: 90 days.
3. Add it in the Claude environment settings as `GITHUB_KICK_TOKEN`. I will store it as a Supabase secret.

### Step 8 — Put the website online (Cloudflare Pages, free)

1. Open `dash.cloudflare.com` → sign up.
2. **Workers & Pages → Create → Pages → Connect to Git** → choose this repository.
3. Build settings:
   - Framework preset: **None**
   - Build command: `pnpm install && pnpm --filter @briefcast/web build`
   - Build output directory: `apps/web/dist`
   - Environment variables: `VITE_SUPABASE_URL` = Project URL, `VITE_SUPABASE_ANON_KEY` = anon key.
     Also add `NODE_VERSION` = `22`.
4. **Save and Deploy**. You get a link like `https://briefcast-demo.pages.dev`.

### Step 9 — Invite friends

I create codes with `pnpm demo:invite --count 5`. Send each friend a personal link:

```
https://briefcast-demo.pages.dev/?invite=K7M2QX
```

A short message you can send:

> I am testing an idea: a short personal podcast every morning, made by AI for you, from sources you
> choose. It takes 5 minutes to set up. Would you try it for 2 weeks and tell me honestly what you think?
> Open this link on your phone: …

---

## What to measure (I show this with `pnpm demo:stats`)

| Number | Good sign after 2 weeks |
|---|---|
| Friends who listened in the last 7 days | at least 60% |
| Average listen-through (how much of each episode) | over 60% |
| Feedback rate | over 30% of episodes |
| "Go deeper" taps | any at all is a strong signal |
| Cost per episode | under $0.50 for 20 minutes |

Also ask 3 questions in person: *Did you listen on day 10 without a reminder? What did you skip? Would you
pay $10 a month?*

**Decision rule:** if at least half of your friends still listen in week 2 without reminders, go ahead with
the company, the Apple account and the iOS app. If not, fix the content first. The app screens will not
save weak episodes.

---

## Try the screens now, with no setup

Preview mode runs the full app with sample data, without any backend:

```bash
pnpm install
pnpm --filter @briefcast/web dev     # then open the link it prints
```
