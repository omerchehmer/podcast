/**
 * Podcast transcription job. Runs inside the hourly worker, after the episodes that are due.
 *
 * For every podcast at least one listener follows, look at:
 *   - the first time: the last `backfillEpisodes` episodes
 *   - after that: every new episode
 * Then decide which are worth it (speech-to-text costs money):
 *   1. free rules: skip episodes too old to be used in anyone's next briefing, and trailers
 *   2. feed transcripts are free, so they are always used
 *   3. the rest: one cheap model call scores every episode 0–10 for the people who follow the show;
 *      only episodes at `minTranscribeValue` or more are transcribed, best first
 * Skipped episodes are saved as "skipped", so they are not checked again.
 * For each chosen episode we get the text, turn it into ~800 words of notes, and save the notes
 * once for all listeners. The full transcript is not stored.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIMITS, STT } from "@briefcast/shared";
import { download, durationMinutes, splitAudio } from "../lib/audio";
import { CostTracker } from "../lib/cost";
import { mapLimit } from "../lib/limit";
import { keywords, wordCount } from "../lib/text";
import { log } from "../lib/log";
import type { LlmClient } from "../providers/llm";
import type { SttClient } from "../providers/stt";
import { loadFeed, parseFeed, toCollected } from "../pipeline/collect";
import { loadTranscript, makeNotes, transcriptToText, type TranscriptLink } from "../pipeline/transcript";
import { TRIAGE_SYSTEM } from "../prompts";
import { TranscribeTriage } from "../pipeline/schemas";

/** Who follows a show, in general terms only (no names, no profile text). */
export interface Audience {
  followers: number;
  /** Longest look-back of any follower, in days. Older episodes can never be used in a briefing. */
  lookbackDays: number;
  /** Interests summed over followers, strongest first. */
  interests: { label: string; weight: number }[];
  avoid: string[];
  /** Average trust in this show (0–1); goes down when listeners dislike it. */
  trust: number;
}

export interface PodcastSource {
  id: string;
  title: string;
  feedUrl: string;
  audience?: Audience;
}

export interface TranscriptRow {
  source_id: string;
  episode_key: string;
  status: "done" | "failed" | "skipped";
  attempts: number;
  published_at: string | null;
}

export interface TranscriptSave {
  source_id: string;
  episode_key: string;
  title: string;
  audio_url: string | null;
  published_at: string | null;
  status: "done" | "failed" | "skipped";
  origin: "feed" | "speech_to_text" | null;
  notes: string | null;
  partial: boolean;
  words: number;
  audio_minutes: number;
  cost_usd: number;
  attempts: number;
  error: string | null;
  /** 0–10 score from the check (null when not scored), and why it was picked or skipped. */
  value: number | null;
  reason: string | null;
}

/** The database calls this job needs (Repo implements them; tests use a small in-memory copy). */
export interface TranscriptStore {
  followedPodcasts(): Promise<PodcastSource[]>;
  transcriptRows(sourceIds: string[]): Promise<TranscriptRow[]>;
  audioMinutesSince(iso: string): Promise<number>;
  saveTranscript(row: TranscriptSave): Promise<void>;
}

export interface FeedEpisode {
  /** Same as the item hash in the episode pipeline, so saved notes can be found again. */
  key: string;
  title: string;
  publishedAt?: string;
  audioUrl?: string;
  transcript?: TranscriptLink;
  /** Short show notes (~60 words), for the value check. */
  summary?: string;
  durationMin?: number;
}

const time = (iso?: string | null) => (iso ? new Date(iso).getTime() : NaN);

/**
 * Which episodes of one show to transcribe in this run.
 * Only the newest few episodes of a feed are ever looked at, so we never crawl a show's back catalog.
 */
export function pickEpisodes(episodes: FeedEpisode[], rows: TranscriptRow[]): FeedEpisode[] {
  const usable = episodes
    .filter((e) => e.audioUrl || e.transcript)
    .sort((a, b) => (time(b.publishedAt) || 0) - (time(a.publishedAt) || 0))
    .slice(0, LIMITS.maxNewEpisodesPerShowPerRun);
  if (rows.length === 0) return usable.slice(0, LIMITS.backfillEpisodes);

  const known = new Map(rows.map((r) => [r.episode_key, r]));
  const newestKnown = Math.max(...rows.map((r) => time(r.published_at)).filter((t) => !isNaN(t)), -Infinity);
  return usable.filter((e) => {
    const row = known.get(e.key);
    if (row) return row.status === "failed" && row.attempts < LIMITS.maxTranscribeAttempts;
    return time(e.publishedAt) > newestKnown;
  });
}

export async function feedEpisodes(p: PodcastSource): Promise<FeedEpisode[]> {
  const source = { id: p.id, kind: "podcast" as const, title: p.title, feedUrl: p.feedUrl, trust: 1 };
  return parseFeed(await loadFeed(p.feedUrl)).map((raw) => {
    const item = toCollected(raw, source);
    return {
      key: item.hash, title: item.title, publishedAt: item.publishedAt, audioUrl: raw.audioUrl, transcript: raw.transcript,
      summary: item.summary, durationMin: raw.durationMin,
    };
  });
}

/** Free checks. Returns why to skip the episode, or null to keep it. */
export function ruleSkip(ep: FeedEpisode, audience: Audience | undefined, now: Date): string | null {
  const lookback = audience?.lookbackDays ?? LIMITS.lookbackDaysWeekly;
  const published = time(ep.publishedAt);
  if (!isNaN(published) && now.getTime() - published > lookback * 86_400_000) return `older than ${lookback} days, too old for any briefing`;
  if (ep.durationMin !== undefined && ep.durationMin < LIMITS.minEpisodeMinutes) return "very short: trailer or teaser";
  if (/\b(trailer|teaser|coming soon)\b/i.test(ep.title)) return "trailer or teaser";
  return null;
}

interface Candidate {
  p: PodcastSource;
  ep: FeedEpisode;
  attempts: number;
}

type Score = { value: number; reason: string };

/** Used when the model call fails: an interest word in the title or show notes is enough. */
function keywordScore(c: Candidate): Score {
  const kw = keywords(`${c.ep.title} ${c.ep.summary ?? ""}`);
  const avoid = (c.p.audience?.avoid ?? []).some((a) => [...keywords(a)].some((w) => kw.has(w)));
  const hit = (c.p.audience?.interests ?? []).some((i) => [...keywords(i.label)].some((w) => kw.has(w)));
  return avoid || !hit ? { value: 3, reason: "no interest match (keyword check)" } : { value: 7, reason: "interest match (keyword check)" };
}

/** One cheap model call scores all candidates of this run, grouped by show. */
export async function scoreEpisodes(cands: Candidate[], llm: LlmClient, cost: CostTracker, now: Date): Promise<Score[]> {
  if (cands.length === 0) return [];
  const ids = cands.map((_, i) => `E${i + 1}`);
  const shows = new Map<string, { show: string; audience: unknown; episodes: unknown[] }>();
  cands.forEach((c, i) => {
    const a = c.p.audience;
    const show = shows.get(c.p.id) ?? {
      show: c.p.title,
      audience: a
        ? { followers: a.followers, interests: a.interests.slice(0, 20), avoid: a.avoid, trust: Math.round(a.trust * 100) / 100 }
        : { followers: 1, interests: [], avoid: [], trust: 1 },
      episodes: [],
    };
    const age = time(c.ep.publishedAt);
    show.episodes.push({
      id: ids[i], title: c.ep.title, showNotes: c.ep.summary ?? "",
      minutes: c.ep.durationMin ? Math.round(c.ep.durationMin) : null,
      ageDays: isNaN(age) ? null : Math.round(((now.getTime() - age) / 86_400_000) * 10) / 10,
    });
    shows.set(c.p.id, show);
  });
  try {
    const out = await llm.json(
      "triage",
      {
        system: TRIAGE_SYSTEM,
        task: "Score every episode.",
        data: { shows: [...shows.values()] },
        schema: TranscribeTriage,
        maxTokens: 4000,
      },
      cost,
    );
    const byId = new Map(out.episodes.map((e) => [e.id, e]));
    return cands.map((c, i) => {
      const e = byId.get(ids[i]!);
      return e ? { value: Math.max(0, Math.min(10, Math.round(e.value))), reason: e.reason.slice(0, 200) } : keywordScore(c);
    });
  } catch (e) {
    log.warn("episode value check failed, using keywords", { error: String(e) });
    return cands.map(keywordScore);
  }
}

export interface TranscribeDeps {
  llm: LlmClient;
  stt: SttClient;
}

interface EpisodeText {
  text: string;
  origin: "feed" | "speech_to_text";
  minutes: number;
  cutShort: boolean;
}

async function feedText(ep: FeedEpisode): Promise<string | null> {
  if (!ep.transcript) return null;
  try {
    const text = transcriptToText(await loadTranscript(ep.transcript.url), ep.transcript.type);
    return wordCount(text) >= 50 ? text : null;
  } catch (e) {
    log.warn("feed transcript failed, using audio", { error: String(e) });
    return null;
  }
}

async function audioText(ep: FeedEpisode, stt: SttClient, cost: CostTracker, spent: { minutes: number }): Promise<EpisodeText> {
  if (!ep.audioUrl) throw new Error("no audio file");
  const dir = await mkdtemp(join(tmpdir(), "briefcast-stt-"));
  try {
    const file = join(dir, "episode");
    await download(ep.audioUrl, file);
    const total = await durationMinutes(file);
    const take = Math.min(total, LIMITS.maxAudioMinutesPerItem);
    const parts = await splitAudio(file, dir, take, STT.chunkMinutes);
    if (parts.length === 0) throw new Error("audio has no usable parts");
    const partMinutes = (i: number) => (i < parts.length - 1 ? STT.chunkMinutes : take - STT.chunkMinutes * (parts.length - 1));
    const texts = await mapLimit(parts, 3, async (part, i) => {
      const t = await stt.transcribe(part, partMinutes(i), cost);
      spent.minutes += partMinutes(i);
      return t;
    });
    return { text: texts.join(" ").replace(/\s+/g, " ").trim(), origin: "speech_to_text", minutes: take, cutShort: total > take };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Get the text of one episode and turn it into notes. Never throws: a failure is saved as a failed row. */
export async function transcribeEpisode(
  p: PodcastSource, ep: FeedEpisode, attempts: number, deps: TranscribeDeps, allowAudio: boolean,
): Promise<TranscriptSave> {
  const cost = new CostTracker();
  const spent = { minutes: 0 };
  const base = {
    source_id: p.id, episode_key: ep.key, title: ep.title, audio_url: ep.audioUrl ?? null,
    published_at: ep.publishedAt ?? null, attempts, value: null, reason: null,
  };
  try {
    const fromFeed = await feedText(ep);
    let got: EpisodeText;
    if (fromFeed) got = { text: fromFeed, origin: "feed", minutes: 0, cutShort: false };
    else if (allowAudio) got = await audioText(ep, deps.stt, cost, spent);
    else throw new Error("daily speech-to-text limit reached");
    if (wordCount(got.text) < 50) throw new Error("transcript is empty or too short");

    const notes = await makeNotes(got.text, { podcast: p.title, episode: ep.title }, { llm: deps.llm, cost }, { cutShort: got.cutShort, always: true });
    return {
      ...base, status: "done", origin: got.origin, notes: notes.notes, partial: notes.partial,
      words: wordCount(got.text), audio_minutes: round2(got.minutes), cost_usd: round4(cost.totalUsd), error: null,
    };
  } catch (e) {
    return {
      ...base, status: "failed", origin: null, notes: null, partial: false, words: 0,
      audio_minutes: round2(spent.minutes), cost_usd: round4(cost.totalUsd), error: String(e instanceof Error ? e.message : e).slice(0, 300),
    };
  }
}

export interface TranscribeOptions {
  now?: Date;
  /** Stop starting new episodes after this time (ms since epoch). */
  deadline: number;
  /** Called after each episode, so the worker can make an episode a listener just asked for. */
  between?: () => Promise<void>;
}

export async function transcribeNew(store: TranscriptStore, deps: TranscribeDeps, opts: TranscribeOptions) {
  const now = opts.now ?? new Date();
  const podcasts = await store.followedPodcasts();
  const stats = { shows: podcasts.length, checked: 0, skipped: 0, done: 0, failed: 0, minutes: 0, usd: 0 };
  if (podcasts.length === 0) return stats;

  let usedToday = await store.audioMinutesSince(new Date(now.getTime() - 24 * 3600_000).toISOString());
  const rows = await store.transcriptRows(podcasts.map((p) => p.id));

  // 1. New episodes of every followed show
  const cands: Candidate[] = [];
  for (const p of podcasts) {
    try {
      for (const ep of pickEpisodes(await feedEpisodes(p), rows.filter((r) => r.source_id === p.id))) {
        const previous = rows.find((r) => r.source_id === p.id && r.episode_key === ep.key)?.attempts ?? 0;
        cands.push({ p, ep, attempts: previous + 1 });
      }
    } catch (e) {
      log.warn("podcast feed failed", { source: p.title, error: String(e) });
    }
  }
  stats.checked = cands.length;

  // 2. Decide which are worth it
  const chosen: (Candidate & Score)[] = [];
  const skipped: (Candidate & { value: number | null; reason: string })[] = [];
  const toScore: Candidate[] = [];
  for (const c of cands) {
    const skip = ruleSkip(c.ep, c.p.audience, now);
    if (skip) skipped.push({ ...c, value: null, reason: skip });
    else if (c.ep.transcript) chosen.push({ ...c, value: 10, reason: "free transcript in the feed" });
    else toScore.push(c);
  }
  const triageCost = new CostTracker();
  const scores = await scoreEpisodes(toScore, deps.llm, triageCost, now);
  toScore.forEach((c, i) => {
    const s = scores[i]!;
    (s.value >= LIMITS.minTranscribeValue ? chosen : skipped).push({ ...c, ...s });
  });
  stats.usd += triageCost.totalUsd;

  for (const s of skipped) {
    await store.saveTranscript({
      source_id: s.p.id, episode_key: s.ep.key, title: s.ep.title, audio_url: s.ep.audioUrl ?? null,
      published_at: s.ep.publishedAt ?? null, status: "skipped", origin: null, notes: null, partial: false,
      words: 0, audio_minutes: 0, cost_usd: 0, attempts: s.attempts, error: null, value: s.value, reason: s.reason,
    });
    stats.skipped++;
  }

  // 3. Transcribe the chosen ones, best first, within the time and daily budget
  chosen.sort((a, b) => b.value - a.value);
  for (const c of chosen) {
    if (Date.now() > opts.deadline) break;
    const allowAudio = usedToday < LIMITS.maxAudioMinutesPerDay;
    if (!allowAudio && !c.ep.transcript) continue; // wait for tomorrow's budget; do not count as a failed try
    const row = { ...(await transcribeEpisode(c.p, c.ep, c.attempts, deps, allowAudio)), value: c.value, reason: c.reason };
    await store.saveTranscript(row);
    usedToday += row.audio_minutes;
    stats.minutes += row.audio_minutes;
    stats.usd += row.cost_usd;
    stats[row.status === "done" ? "done" : "failed"]++;
    log.info("podcast episode transcribed", {
      source: c.p.title, status: row.status, origin: row.origin, value: c.value, minutes: row.audio_minutes, usd: row.cost_usd, error: row.error,
    });
    await opts.between?.();
  }
  stats.usd = round4(stats.usd);
  return stats;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
