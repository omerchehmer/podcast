/**
 * Podcast transcription job. Runs inside the hourly worker, after the episodes that are due.
 *
 * For every podcast at least one listener follows:
 *   - the first time: the last `backfillEpisodes` episodes
 *   - after that: every new episode
 * For each episode we get the text (the feed's own transcript when it has one, otherwise
 * speech-to-text on the audio), turn it into ~800 words of notes, and save the notes once for
 * all listeners. The full transcript is not stored.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIMITS, STT } from "@briefcast/shared";
import { download, durationMinutes, splitAudio } from "../lib/audio";
import { CostTracker } from "../lib/cost";
import { mapLimit } from "../lib/limit";
import { wordCount } from "../lib/text";
import { log } from "../lib/log";
import type { LlmClient } from "../providers/llm";
import type { SttClient } from "../providers/stt";
import { loadFeed, parseFeed, toCollected } from "../pipeline/collect";
import { loadTranscript, makeNotes, transcriptToText, type TranscriptLink } from "../pipeline/transcript";

export interface PodcastSource {
  id: string;
  title: string;
  feedUrl: string;
}

export interface TranscriptRow {
  source_id: string;
  episode_key: string;
  status: "done" | "failed";
  attempts: number;
  published_at: string | null;
}

export interface TranscriptSave {
  source_id: string;
  episode_key: string;
  title: string;
  audio_url: string | null;
  published_at: string | null;
  status: "done" | "failed";
  origin: "feed" | "speech_to_text" | null;
  notes: string | null;
  partial: boolean;
  words: number;
  audio_minutes: number;
  cost_usd: number;
  attempts: number;
  error: string | null;
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
    return { key: item.hash, title: item.title, publishedAt: item.publishedAt, audioUrl: raw.audioUrl, transcript: raw.transcript };
  });
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
    published_at: ep.publishedAt ?? null, attempts,
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
  const stats = { shows: podcasts.length, done: 0, failed: 0, minutes: 0, usd: 0 };
  if (podcasts.length === 0) return stats;

  let usedToday = await store.audioMinutesSince(new Date(now.getTime() - 24 * 3600_000).toISOString());
  const rows = await store.transcriptRows(podcasts.map((p) => p.id));

  for (const p of podcasts) {
    if (Date.now() > opts.deadline) break;
    let picks: FeedEpisode[];
    try {
      picks = pickEpisodes(await feedEpisodes(p), rows.filter((r) => r.source_id === p.id));
    } catch (e) {
      log.warn("podcast feed failed", { source: p.title, error: String(e) });
      continue;
    }
    for (const ep of picks) {
      if (Date.now() > opts.deadline) break;
      const allowAudio = usedToday < LIMITS.maxAudioMinutesPerDay;
      if (!allowAudio && !ep.transcript) continue; // wait for tomorrow's budget; do not count as a failed try
      const previous = rows.find((r) => r.source_id === p.id && r.episode_key === ep.key)?.attempts ?? 0;
      const row = await transcribeEpisode(p, ep, previous + 1, deps, allowAudio);
      await store.saveTranscript(row);
      usedToday += row.audio_minutes;
      stats.minutes += row.audio_minutes;
      stats.usd += row.cost_usd;
      stats[row.status === "done" ? "done" : "failed"]++;
      log.info("podcast episode transcribed", {
        source: p.title, status: row.status, origin: row.origin, minutes: row.audio_minutes, usd: row.cost_usd, error: row.error,
      });
      await opts.between?.();
    }
  }
  stats.usd = round4(stats.usd);
  return stats;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
