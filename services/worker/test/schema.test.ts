import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser, createUser } from "./helpers/db";

let db: PGlite;
let alice: string;
let bob: string;

async function makeEpisode(userId: string, at = "2026-09-25T04:30:00Z") {
  const r = await db.query<{ id: string }>(
    `insert into episodes (user_id, scheduled_for, episode_type, format, tone, target_seconds)
     values ($1, $2, 'mix', 'solo', 'direct', 900) returning id`,
    [userId, at],
  );
  return r.rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db);
  bob = await createUser(db);
});

describe("new user setup", () => {
  it("creates profile, settings and preference rows on sign-up", async () => {
    const r = await db.query(`select
      (select count(*) from profiles where user_id = $1) as p,
      (select count(*) from podcast_settings where user_id = $1) as s,
      (select count(*) from preference_state where user_id = $1) as ps`, [alice]);
    expect(r.rows[0]).toEqual({ p: 1, s: 1, ps: 1 });
  });

  it("seeds categories and voices", async () => {
    const c = await db.query<{ n: number }>(`select count(*)::int as n from topic_categories`);
    const v = await db.query<{ n: number }>(`select count(*)::int as n from voices`);
    expect(c.rows[0]!.n).toBeGreaterThan(5);
    expect(v.rows[0]!.n).toBeGreaterThanOrEqual(5);
  });
});

describe("row level security", () => {
  it("a user sees only their own episodes", async () => {
    await makeEpisode(alice, "2026-09-20T04:30:00Z");
    await makeEpisode(bob, "2026-09-20T04:30:00Z");
    const seen = await asUser(db, alice, () => db.query<{ user_id: string }>(`select user_id from episodes`));
    expect(seen.rows.length).toBeGreaterThan(0);
    expect(seen.rows.every((r) => r.user_id === alice)).toBe(true);
  });

  it("a user cannot create episodes (backend only)", async () => {
    await expect(
      asUser(db, alice, () =>
        db.query(`insert into episodes (user_id, scheduled_for, episode_type, format, tone, target_seconds)
                  values ($1, now(), 'mix', 'solo', 'direct', 60)`, [alice]),
      ),
    ).rejects.toThrow();
  });

  it("a user cannot change another user's settings", async () => {
    const r = await asUser(db, alice, () =>
      db.query(`update podcast_settings set length_minutes = 30 where user_id = $1`, [bob]),
    );
    expect(r.affectedRows).toBe(0);
  });

  it("a user cannot write feedback on someone else's behalf", async () => {
    const ep = await makeEpisode(bob, "2026-09-21T04:30:00Z");
    await expect(
      asUser(db, alice, () => db.query(`insert into feedback (episode_id, user_id, stars) values ($1, $2, 1)`, [ep, bob])),
    ).rejects.toThrow();
  });

  it("users cannot read the cost log", async () => {
    await db.query(`insert into cost_log (step, provider, model, usd) values ('write', 'anthropic', 'x', 0.1)`);
    const r = await asUser(db, alice, () => db.query(`select * from cost_log`));
    expect(r.rows.length).toBe(0);
  });

  it("private newsletter items are hidden from other users", async () => {
    const s = await db.query<{ id: string }>(
      `insert into sources (kind, title, owner_user_id) values ('newsletter_email', 'Inbox', $1) returning id`, [bob]);
    await db.query(`insert into source_items (source_id, owner_user_id, title, content_hash) values ($1, $2, 'Secret', 'h1')`,
      [s.rows[0]!.id, bob]);
    const r = await asUser(db, alice, () => db.query(`select * from source_items where title = 'Secret'`));
    expect(r.rows.length).toBe(0);
  });
});

describe("account deletion", () => {
  it("deleting the auth user removes all their data", async () => {
    const carol = await createUser(db);
    const ep = await makeEpisode(carol);
    await db.query(`insert into feedback (episode_id, user_id, stars) values ($1, $2, 5)`, [ep, carol]);
    await db.query(`insert into interests (user_id, label) values ($1, 'AI')`, [carol]);
    await db.query(`delete from auth.users where id = $1`, [carol]);
    const r = await db.query<{ n: number }>(`select
      (select count(*) from episodes where user_id = $1) +
      (select count(*) from feedback where user_id = $1) +
      (select count(*) from interests where user_id = $1) +
      (select count(*) from profiles where user_id = $1) as n`, [carol]);
    expect(Number(r.rows[0]!.n)).toBe(0);
  });
});

describe("scheduling", () => {
  async function setupScheduledUser(opts: { tz: string; time: string; frequency?: string; days?: number[]; paid?: boolean }) {
    const u = await createUser(db);
    await db.query(`update profiles set time_zone = $2, onboarding_done_at = now() where user_id = $1`, [u, opts.tz]);
    await db.query(`update podcast_settings set delivery_time = $2, frequency = $3, custom_days = $4 where user_id = $1`,
      [u, opts.time, opts.frequency ?? "daily", opts.days ?? []]);
    if (opts.paid !== false) {
      await db.query(`insert into subscriptions (user_id, rc_app_user_id, status) values ($1, $2, 'trialing')`, [u, u]);
    }
    return u;
  }
  const due = async (now: string, userId: string) =>
    (await db.query<{ scheduled_for: Date }>(
      `select scheduled_for from due_episode_slots($1::timestamptz, interval '60 minutes') where user_id = $2`, [now, userId])).rows;

  it("finds a slot in the user's time zone", async () => {
    // 07:30 in Jerusalem on 25 Sep 2026 (UTC+3) = 04:30 UTC
    const u = await setupScheduledUser({ tz: "Asia/Jerusalem", time: "07:30" });
    const rows = await due("2026-09-25T03:45:00Z", u);
    expect(rows.map((r) => new Date(r.scheduled_for).toISOString())).toEqual(["2026-09-25T04:30:00.000Z"]);
    expect(await due("2026-09-25T02:00:00Z", u)).toEqual([]); // too early
  });

  it("skips weekends for weekday users", async () => {
    // 26 Sep 2026 is a Saturday
    const u = await setupScheduledUser({ tz: "UTC", time: "08:00", frequency: "weekdays" });
    expect(await due("2026-09-26T07:30:00Z", u)).toEqual([]);
    expect((await due("2026-09-28T07:30:00Z", u)).length).toBe(1); // Monday
  });

  it("respects custom days", async () => {
    const u = await setupScheduledUser({ tz: "UTC", time: "08:00", frequency: "custom", days: [3] }); // Wednesdays
    expect(await due("2026-09-29T07:30:00Z", u)).toEqual([]); // Tuesday
    expect((await due("2026-09-30T07:30:00Z", u)).length).toBe(1); // Wednesday
  });

  it("handles a slot just after midnight (tomorrow in local time)", async () => {
    const u = await setupScheduledUser({ tz: "UTC", time: "00:15" });
    expect((await due("2026-09-24T23:30:00Z", u)).length).toBe(1);
  });

  it("does not schedule users without a trial or subscription", async () => {
    const u = await setupScheduledUser({ tz: "UTC", time: "08:00", paid: false });
    expect(await due("2026-09-25T07:30:00Z", u)).toEqual([]);
  });

  it("creates each episode once, and turns a 'go deeper' tap into a deep dive", async () => {
    const u = await setupScheduledUser({ tz: "UTC", time: "09:00" });
    // earlier episode with a segment the user asked to go deeper on
    const ep = await makeEpisode(u, "2026-09-24T09:00:00Z");
    const seg = await db.query<{ id: string }>(
      `insert into episode_segments (episode_id, idx, kind, title) values ($1, 1, 'idea', 'Pricing power') returning id`, [ep]);
    const fb = await db.query<{ id: string }>(`insert into feedback (episode_id, user_id, stars) values ($1, $2, 4) returning id`, [ep, u]);
    await db.query(`insert into segment_feedback (feedback_id, segment_id, go_deeper) values ($1, $2, true)`,
      [fb.rows[0]!.id, seg.rows[0]!.id]);

    const first = await db.query<{ user_id: string; episode_type: string; trigger: string }>(
      `select * from create_due_episodes('2026-09-25T08:30:00Z', interval '60 minutes')`);
    const mine = first.rows.filter((r) => r.user_id === u);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.episode_type).toBe("deep_dive");
    expect(mine[0]!.trigger).toBe("deep_dive_request");

    const again = await db.query<{ user_id: string }>(
      `select * from create_due_episodes('2026-09-25T08:35:00Z', interval '60 minutes')`);
    expect(again.rows.filter((r) => r.user_id === u)).toHaveLength(0);
  });
});
