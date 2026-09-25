import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser, createUser } from "./helpers/db";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`insert into invite_codes (code, max_uses) values ('FRIENDS1', 2)`);
  await db.exec(`grant execute on function redeem_invite(text), request_episode_now(), add_source(source_kind, text, text, text) to authenticated`);
});

const redeem = (uid: string, code: string) =>
  asUser(db, uid, async () => (await db.query<{ ok: boolean }>(`select redeem_invite($1) as ok`, [code])).rows[0]!.ok);
const requestNow = (uid: string) =>
  asUser(db, uid, async () => (await db.query<{ id: string }>(`select request_episode_now() as id`)).rows[0]!.id);

describe("invite codes", () => {
  it("gives access with a valid code, ignores case, and respects max uses", async () => {
    const a = await createUser(db), b = await createUser(db), c = await createUser(db);
    expect(await redeem(a, "friends1")).toBe(true);
    expect(await redeem(b, " FRIENDS1 ")).toBe(true);
    expect(await redeem(c, "FRIENDS1")).toBe(false); // used up
    expect(await redeem(c, "WRONG")).toBe(false);
    const r = await db.query<{ access_override: boolean }>(`select access_override from profiles where user_id = $1`, [a]);
    expect(r.rows[0]!.access_override).toBe(true);
  });

  it("users cannot read invite codes", async () => {
    const u = await createUser(db);
    const r = await asUser(db, u, () => db.query(`select * from invite_codes`));
    expect(r.rows).toHaveLength(0);
  });
});

describe("make an episode now", () => {
  it("first episode is free; later ones need access; one job at a time", async () => {
    const u = await createUser(db);
    const first = await requestNow(u);
    const row = await db.query<{ trigger: string; status: string }>(`select trigger, status from episodes where id = $1`, [first]);
    expect(row.rows[0]).toEqual({ trigger: "first", status: "queued" });

    await expect(requestNow(u)).rejects.toThrow(/already being made/);
    await db.query(`update episodes set status = 'ready' where id = $1`, [first]);
    await expect(requestNow(u)).rejects.toThrow(/no access/);

    await db.query(`insert into invite_codes (code) values ('SOLO')`);
    await redeem(u, "SOLO");
    const second = await requestNow(u);
    const r2 = await db.query<{ trigger: string }>(`select trigger from episodes where id = $1`, [second]);
    expect(r2.rows[0]!.trigger).toBe("manual");
  });

  it("stops after 3 on-demand episodes per day", async () => {
    const u = await createUser(db);
    await db.query(`update profiles set access_override = true where user_id = $1`, [u]);
    for (let i = 0; i < 3; i++) {
      const id = await requestNow(u);
      await db.query(`update episodes set status = 'ready' where id = $1`, [id]);
    }
    await expect(requestNow(u)).rejects.toThrow(/daily limit/);
  });
});

describe("adding sources", () => {
  it("shares public feeds in the catalog and keeps books private", async () => {
    const a = await createUser(db), b = await createUser(db);
    const add = (uid: string, kind: string, title: string, feed: string | null) =>
      asUser(db, uid, async () => (await db.query<{ id: string }>(`select add_source($1::source_kind, $2, null, $3) as id`, [kind, title, feed])).rows[0]!.id);
    const s1 = await add(a, "rss", "Blog", "https://blog.example.com/feed");
    const s2 = await add(b, "rss", "Blog", "https://blog.example.com/feed");
    expect(s1).toBe(s2); // one catalog row, fetched once for everyone
    const book = await add(a, "book", "Multipliers", null);
    const seen = await asUser(db, b, () => db.query(`select * from sources where id = $1`, [book]));
    expect(seen.rows).toHaveLength(0);
    await expect(add(a, "rss", "Bad", "javascript:alert(1)")).rejects.toThrow(/http/);
  });
});

describe("discovery sources", () => {
  const fill = async (uid: string, upTo = 6) =>
    (await db.query<{ n: number }>(`select add_discovery_sources($1, $2, 0.6) as n`, [uid, upTo])).rows[0]!.n;
  const mine = async (uid: string) =>
    (await db.query<{ title: string; added_by: string; trust: number; muted: boolean }>(
      `select s.title, us.added_by, us.trust, us.muted from user_sources us join sources s on s.id = us.source_id
       where us.user_id = $1 order by s.title`, [uid])).rows;
  const interest = (uid: string, cat: string, weight: string) =>
    db.query(`insert into interests (user_id, category_id, label, user_weight) values ($1, $2, $2, $3::interest_weight)`, [uid, cat, weight]);

  // Own topics and sources, so the tests do not depend on the real catalog.
  beforeAll(async () => {
    await db.exec(`
      insert into topic_categories (id, name) values ('t_trips', 'Trips'), ('t_plans', 'Plans'), ('t_bots', 'Bots');
      insert into sources (kind, title, feed_url, is_discovery, discovery_categories) values
        ('rss', 'Trips A', 'https://a.example.com/feed', true, '{t_trips}'),
        ('podcast', 'Trips B', 'https://b.example.com/feed', true, '{t_trips}'),
        ('rss', 'Plans C', 'https://c.example.com/feed', true, '{t_plans}'),
        ('rss', 'Plans and Bots D', 'https://d.example.com/feed', true, '{t_plans,t_bots}');
      insert into sources (kind, title, is_discovery, discovery_categories) values ('book', 'Trips Book', true, '{t_trips}');
    `);
  });

  it("adds matching feeds with lower trust, skips avoided topics and books, and does not repeat", async () => {
    const u = await createUser(db);
    await interest(u, "t_trips", "a_lot");
    await interest(u, "t_plans", "some");
    await interest(u, "t_bots", "avoid");
    expect(await fill(u)).toBe(3);
    const rows = await mine(u);
    // "Plans and Bots D" touches an avoided topic. Books have no feed, so they are only suggested in the app.
    expect(rows.map((r) => r.title)).toEqual(["Plans C", "Trips A", "Trips B"]);
    expect(rows.every((r) => r.added_by === "system" && Math.abs(r.trust - 0.6) < 1e-6)).toBe(true);
    expect(await fill(u)).toBe(0);
  });

  it("only fills the gap, best matches first, and never adds back a source the user removed", async () => {
    const u = await createUser(db);
    await interest(u, "t_trips", "a_lot");
    await interest(u, "t_plans", "a_little");
    const own = (await db.query<{ id: string }>(`insert into sources (kind, title, feed_url) values ('rss', 'Own', 'https://own.example.com/feed') returning id`)).rows[0]!.id;
    await db.query(`insert into user_sources (user_id, source_id) values ($1, $2)`, [u, own]);
    expect(await fill(u, 1)).toBe(0); // already has enough
    expect(await fill(u, 2)).toBe(1);
    const system = async () => (await mine(u)).filter((r) => r.added_by === "system").map((r) => r.title);
    expect((await system())[0]).toMatch(/^Trips/); // "a lot" beats "a little"
    await db.query(`update user_sources set muted = true where user_id = $1 and added_by = 'system'`, [u]);
    expect(await fill(u, 2)).toBe(1); // the other trips source, not the muted one
    expect((await mine(u)).filter((r) => r.muted)).toHaveLength(1);
    expect(await fill(u, 3)).toBe(1); // then the weaker match
    expect((await system()).filter((t) => t.startsWith("Plans"))).toHaveLength(1);
  });

  it("the catalog has podcasts, websites and books, and users can see them all", async () => {
    const u = await createUser(db);
    const r = await asUser(db, u, () => db.query<{ kind: string; n: number }>(
      `select kind::text, count(*)::int as n from sources where is_discovery and title not like 'Trips%' and title not like 'Plans%' group by kind order by kind`));
    expect(Object.fromEntries(r.rows.map((x) => [x.kind, x.n]))).toEqual({ book: 22, podcast: 21, rss: 10 });
  });

  it("users cannot call it", async () => {
    const u = await createUser(db);
    await expect(asUser(db, u, () => fill(u))).rejects.toThrow(/permission/);
  });
});

describe("job claiming", () => {
  it("claims each queued episode once, and requeues stuck jobs", async () => {
    const u = await createUser(db);
    await db.query(`insert into episodes (user_id, scheduled_for, episode_type, format, tone, target_seconds)
                    values ($1, now(), 'mix', 'solo', 'direct', 600)`, [u]);
    const claimed: string[] = [];
    for (;;) {
      const r = await db.query<{ id: string; status: string }>(`select * from claim_next_episode()`);
      if (r.rows.length === 0) break;
      expect(r.rows[0]!.status).toBe("collecting");
      claimed.push(r.rows[0]!.id);
    }
    expect(new Set(claimed).size).toBe(claimed.length);

    const id = claimed.at(-1)!;
    await db.query(`update episodes set updated_at = now() - interval '1 hour' where id = $1`, [id]);
    // the updated_at trigger would reset the time, so disable it for this test update
    await db.exec(`alter table episodes disable trigger t_episodes_updated`);
    await db.query(`update episodes set updated_at = now() - interval '1 hour' where id = $1`, [id]);
    await db.exec(`alter table episodes enable trigger t_episodes_updated`);
    await db.query(`select requeue_stale_episodes()`);
    const r = await db.query<{ status: string }>(`select status from episodes where id = $1`, [id]);
    expect(r.rows[0]!.status).toBe("queued");
  });

  it("test users with access get scheduled episodes without a subscription", async () => {
    const u = await createUser(db);
    await db.query(`update profiles set access_override = true, onboarding_done_at = now(), time_zone = 'UTC' where user_id = $1`, [u]);
    await db.query(`update podcast_settings set delivery_time = '09:00', frequency = 'daily' where user_id = $1`, [u]);
    const r = await db.query(`select * from due_episode_slots('2026-09-25T08:30:00Z', interval '60 minutes') where user_id = $1`, [u]);
    expect(r.rows).toHaveLength(1);
  });
});
