# Account Setup Guide (step by step, for first-timers)

This guide explains how to create every account the app needs. Do them in the order below. Some take
weeks to be approved, so start those first.

**Golden rules**
1. **Never paste a key or password into a chat** (including this one). Keys go only into the
   places this guide shows.
2. Use a **password manager** (1Password or Bitwarden). Save every password and key there.
3. Use **one business email** for all accounts (for example `omer@briefcast.app`), not your
   Travelier email. This is a separate venture, so keep it fully separate.
4. Turn on **two-factor login (2FA)** on every account.
5. Set a **monthly spending limit** on every pay-per-use service (Anthropic, OpenAI).

---

## Order and time needed

| # | What | Time for you | Waiting time | Cost | Needed for |
|---|---|---|---|---|---|
| 0 | Company + D-U-N-S number | 1–2 hours | **up to 2–4 weeks** | depends on country | Apple account |
| 1 | Check the name, buy a domain | 30 min | none | about $10–20 / year | Email, newsletter address |
| 2 | Business email | 20 min | none | about $7 / month | All accounts |
| 3 | Anthropic API key | 10 min | none | pay per use (start with $20) | Step 2 of the build (now) |
| 4 | OpenAI API key | 10 min | none | pay per use (start with $10) | Step 2 of the build (now) |
| 5 | Supabase project | 15 min | none | free, then $25 / month | Step 4 of the build |
| 6 | Apple Developer account | 30 min | **1–14 days after D-U-N-S** | $99 / year | TestFlight, App Store |
| 7 | CarPlay permission request | 10 min | **weeks** | free | CarPlay |
| 8 | Expo account | 5 min | none | free to start | Building the app |
| 9 | RevenueCat | 30 min | none | free until you earn more | Step 9 of the build |
| 10 | Podcast Index key | 5 min | a few minutes | free | Podcast search |

Prices change. Check each site before you pay.

**This week:** do steps 0, 1, 2, 3 and 4. With steps 3 and 4 done, I can make real test episodes for you.

---

## Step 0 — Company and D-U-N-S number (start today, it is the slowest)

**Why:** Apple lets a company publish apps under the company name. For this, Apple needs a
**D-U-N-S number** (a free company ID from Dun & Bradstreet). You can also publish as a private
person, but then your personal name shows on the App Store as the seller. That is hard to change later.

**Before you start:** since you work at Travelier, check your employment contract for rules on side
businesses and who owns what you build (IP). Ask a lawyer if it is not clear. It is much cheaper to fix
this now than after launch.

1. Form the company (with your lawyer or accountant, in the country you choose).
2. Go to Apple's D-U-N-S lookup page: search "Apple D-U-N-S lookup" or open
   `developer.apple.com/enroll/duns-lookup`.
3. Search for your company. If it is not listed, request a new number on that page (it is free).
4. Wait for the email with the number. It can take up to about 30 days. Save the number.

---

## Step 1 — Check the name and buy a domain

"Briefcast" is only a working name. Before you pay for anything with the name in it:

1. Search the App Store for "Briefcast" and similar names.
2. Search trademarks: `tmsearch.uspto.gov` (USA) and `euipo.europa.eu/eSearch` (EU).
3. If it is free, buy the domain. I suggest **Cloudflare Registrar** (`dash.cloudflare.com` → sign up →
   "Domain Registration" → "Register Domains"). It sells at cost price and makes the newsletter email
   setup easy later.
4. Buy only one domain for now (for example `.app` or `.com`).

Tell me the domain in chat (a domain is not secret). I will use it for the newsletter addresses,
for example `name-123@in.yourdomain.app`.

---

## Step 2 — Business email

1. Go to `workspace.google.com` → "Get started".
2. Use your new domain. Follow the steps to verify it (Google gives you DNS records; in Cloudflare go to
   your domain → "DNS" → "Add record" and copy them in).
3. Create `you@yourdomain` and also `support@yourdomain` (the App Store needs a support contact).

---

## Step 3 — Anthropic API key (Claude, for writing the episodes)

1. Open `console.anthropic.com` and sign up with your business email.
2. Create an organization with the company name.
3. Go to **Billing** → add a card → buy **$20** of credits.
4. Go to **Limits** (or "Spend limits") → set a monthly limit, for example **$50**.
5. Go to **API Keys** → **Create Key** → name it `briefcast-dev`. Copy the key (it starts with
   `sk-ant-`). **You can see it only once**, so save it in your password manager right away.

Later, for the live app, we create a second key named `briefcast-prod`. Keep test and live keys separate.

---

## Step 4 — OpenAI API key (for the voices)

1. Open `platform.openai.com` and sign up with your business email.
2. **Settings → Billing** → add a card → add **$10** of credits.
3. **Settings → Limits** → set a monthly budget, for example **$30**.
4. **Settings → Projects** → create a project named `briefcast`.
5. **API keys** → **Create new secret key** → choose the `briefcast` project → name it `briefcast-dev`.
   Copy it (it starts with `sk-`) and save it in your password manager.

---

## Where to put the keys so I can use them

I am working in a cloud workspace. You add the keys to its settings, not to the chat:

1. In this session, open the **environment menu** in the title bar → **Edit**.
2. Add these **environment variables** (name = value):
   - `ANTHROPIC_API_KEY` = your Anthropic key
   - `OPENAI_API_KEY` = your OpenAI key
3. In the same screen, under **Network access**, allow these hosts (or choose full access, because the
   worker must read RSS feeds from many websites):
   `api.openai.com`, `*.supabase.co`, `api.podcastindex.org`, `itunes.apple.com`, and the RSS feeds you
   want in test episodes.
4. Start a **new session**. It will have the keys. Tell me "keys are added" and I will run a real episode.

---

## Step 5 — Supabase (database, login, file storage)

1. Open `supabase.com` → **Start your project** → sign up (with GitHub is easiest).
2. Create an **organization** named after the company. Plan: **Free** for now.
3. **New project**:
   - Name: `briefcast-dev`
   - Database password: click **Generate**, then save it in your password manager.
   - Region: close to most of your users (for example Frankfurt for Europe / Israel).
4. Wait about 2 minutes for it to start.
5. Go to **Project Settings → API**. You will see:
   - **Project URL** (not secret)
   - **anon / public key** (not secret; it goes inside the app)
   - **service_role key** (**very secret**; it can read all data. Only the worker uses it.)
6. Add them as environment variables, the same way as in the section above:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`.

Before real users arrive, upgrade to **Pro ($25 / month)**: free projects pause when not used, and Pro
gives daily backups.

---

## Step 6 — Apple Developer account (after you have the D-U-N-S number)

1. On an iPhone or Mac, make sure your **Apple Account** uses your business email and has 2FA on.
   (Best to create a new Apple Account for the company, not your personal one.)
2. Install the **Apple Developer** app on the iPhone (or go to `developer.apple.com/programs/enroll`).
3. Tap **Enroll now** → choose **Organization** → enter the company name, D-U-N-S number, website
   (your domain), and your role. You must have the legal right to sign for the company.
4. Pay **$99 / year**.
5. Apple may call you to confirm. Approval takes from 1 day to 2 weeks.
6. After approval, open `appstoreconnect.apple.com`:
   - **Business** (or "Agreements, Tax, and Banking") → accept the **Paid Apps** agreement, add a bank
     account and tax forms. **Subscriptions do not work until this is done.**
   - **Users and Access** → invite teammates only when needed.

I will guide you through creating the app record and the bundle ID when we reach that step.

## Step 7 — CarPlay permission (right after step 6)

1. Go to `developer.apple.com/contact/carplay` (or search "CarPlay entitlement request").
2. Choose the **audio** app type. Describe the app in one or two sentences, for example:
   "A personal daily audio briefing. Users listen to their own AI-generated episodes while driving."
3. Submit and wait. Apple answers by email. Until then, audio still plays in the car through Bluetooth
   and the normal controls.

## Step 8 — Expo account

1. Go to `expo.dev` → **Sign up** with your business email.
2. Create an **organization** with the company name.
3. That is all for now. I will connect the project when we build the app (step 4 of the build).

## Step 9 — RevenueCat (subscriptions) — only after step 6

1. Go to `app.revenuecat.com` → sign up.
2. Create a project `Briefcast`.
3. I will guide you step by step when we get there (it needs the app to exist in App Store Connect).

## Step 10 — Podcast Index key (podcast search)

1. Go to `api.podcastindex.org` → **Sign up for an API key**.
2. You get an **API Key** and an **API Secret** by email.
3. Add them as environment variables: `PODCASTINDEX_API_KEY` and `PODCASTINDEX_API_SECRET`.

---

## Monthly cost at the start

| Item | Cost |
|---|---|
| Apple Developer | $99 / year (about $8 / month) |
| Domain | about $1–2 / month |
| Business email | about $7 / month |
| Supabase | $0 now, $25 / month before launch |
| Anthropic + OpenAI | about $0.30–0.50 per 20-minute episode. 20 test users × 20 episodes a month ≈ $150–200 |
| Worker hosting (Fly.io or Cloud Run) | about $5–20 / month |
| Expo, RevenueCat, Podcast Index | $0 at the start |

**Total before launch: about $50–60 / month plus episode costs.**
