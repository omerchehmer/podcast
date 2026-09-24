/**
 * Demo numbers: are friends listening, giving feedback, asking to go deeper? What does it cost?
 *   pnpm demo:stats
 * Shows user ids only (no names or profiles).
 */
import { serviceClient } from "../db/repo";

const db = serviceClient();
const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

const { data: episodes } = await db.from("episodes").select("id, user_id, status, actual_seconds, cost_usd, created_at").gte("created_at", since);
const { data: events } = await db.from("listen_events").select("episode_id, user_id, position_sec, at").gte("at", since);
const { data: feedback } = await db.from("feedback").select("episode_id, stars, segment_feedback(go_deeper)").gte("created_at", since);

const ready = (episodes ?? []).filter((e) => e.status === "ready");
const failed = (episodes ?? []).filter((e) => e.status === "failed");
const maxPos = new Map<string, number>();
for (const ev of events ?? []) maxPos.set(ev.episode_id, Math.max(maxPos.get(ev.episode_id) ?? 0, ev.position_sec ?? 0));
const started = ready.filter((e) => maxPos.has(e.id));
const listenThrough = started.map((e) => Math.min(1, (maxPos.get(e.id) ?? 0) / Math.max(1, e.actual_seconds ?? 1)));
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const fbEpisodes = new Set((feedback ?? []).map((f) => f.episode_id));
const deeper = (feedback ?? []).filter((f) => (f.segment_feedback as { go_deeper: boolean }[]).some((s) => s.go_deeper)).length;
const activeUsers = (days: number) =>
  new Set((events ?? []).filter((e) => new Date(e.at).getTime() > Date.now() - days * 86_400_000).map((e) => e.user_id)).size;
const users = new Set((episodes ?? []).map((e) => e.user_id)).size;

console.log(`
Last 30 days
  Users with episodes:     ${users}
  Listened in last 7 days: ${activeUsers(7)}
  Episodes made / failed:  ${ready.length} / ${failed.length}
  Episodes started:        ${started.length} (${pct(started.length / Math.max(1, ready.length))} of ready)
  Avg listen-through:      ${pct(avg(listenThrough))}
  Feedback rate:           ${pct(fbEpisodes.size / Math.max(1, ready.length))}
  Avg stars:               ${avg((feedback ?? []).map((f) => f.stars).filter((s): s is number => !!s)).toFixed(1)}
  "Go deeper" rate:        ${pct(deeper / Math.max(1, fbEpisodes.size))} of feedback
  Avg cost per episode:    $${avg(ready.map((e) => Number(e.cost_usd))).toFixed(3)}
  Total AI cost:           $${(episodes ?? []).reduce((a, e) => a + Number(e.cost_usd), 0).toFixed(2)}
`);
