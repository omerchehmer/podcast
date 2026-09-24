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
