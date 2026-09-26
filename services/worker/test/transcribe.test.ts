import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LIMITS, ListenerInput } from "@briefcast/shared";
import {
  pickEpisodes, transcribeNew,
  type FeedEpisode, type PodcastSource, type TranscriptRow, type TranscriptSave, type TranscriptStore,
} from "../src/jobs/transcribe";
import { collect } from "../src/pipeline/collect";
import { notesKey } from "../src/pipeline/transcript";
import { runEpisode } from "../src/pipeline/run";
import { MockLlm } from "../src/providers/mockLlm";
import { MockStt } from "../src/providers/stt";
import { MockTts } from "../src/providers/tts";
import type { LlmClient } from "../src/providers/llm";

const here = dirname(fileURLToPath(import.meta.url));
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const ep = (key: string, day: number, extra: Partial<FeedEpisode> = {}): FeedEpisode => ({
  key, title: key, publishedAt: `2026-09-${String(day).padStart(2, "0")}T05:00:00Z`, audioUrl: `https://x/${key}.mp3`, ...extra,
});
const row = (key: string, day: number, extra: Partial<TranscriptRow> = {}): TranscriptRow => ({
  source_id: "p", episode_key: key, status: "done", attempts: 1, published_at: `2026-09-${String(day).padStart(2, "0")}T05:00:00Z`, ...extra,
});

describe("pickEpisodes", () => {
  const feed = [ep("e1", 1), ep("e5", 5), ep("e3", 3), ep("e4", 4), ep("e2", 2)];

  it("takes the last 2 episodes the first time a show is followed", () => {
    expect(pickEpisodes(feed, []).map((e) => e.key)).toEqual(["e5", "e4"]);
  });

  it("then takes only episodes newer than the newest one we have", () => {
    expect(pickEpisodes([ep("e6", 6), ...feed], [row("e5", 5), row("e4", 4)]).map((e) => e.key)).toEqual(["e6"]);
    expect(pickEpisodes(feed, [row("e5", 5), row("e4", 4)])).toEqual([]);
  });

  it("tries a failed episode again, up to the limit", () => {
    expect(pickEpisodes(feed, [row("e5", 5, { status: "failed", attempts: 1 }), row("e4", 4)]).map((e) => e.key)).toEqual(["e5"]);
    expect(pickEpisodes(feed, [row("e5", 5, { status: "failed", attempts: LIMITS.maxTranscribeAttempts }), row("e4", 4)])).toEqual([]);
  });

  it("never goes deep into the back catalog", () => {
    const many = Array.from({ length: 30 }, (_, i) => ep(`n${i + 1}`, i + 1));
    expect(pickEpisodes(many, [row("old", 0, { published_at: null })]).length).toBeLessThanOrEqual(LIMITS.maxNewEpisodesPerShowPerRun);
  });

  it("skips items with no audio and no transcript", () => {
    expect(pickEpisodes([ep("e1", 1, { audioUrl: undefined })], [])).toEqual([]);
  });
});

class MemoryStore implements TranscriptStore {
  rows: TranscriptSave[] = [];
  minutesToday = 0;
  constructor(public podcasts: PodcastSource[]) {}
  async followedPodcasts() { return this.podcasts; }
  async transcriptRows(ids: string[]) { return this.rows.filter((r) => ids.includes(r.source_id)); }
  async audioMinutesSince() { return this.minutesToday + this.rows.reduce((a, r) => a + r.audio_minutes, 0); }
  async saveTranscript(r: TranscriptSave) {
    this.rows = [...this.rows.filter((x) => !(x.source_id === r.source_id && x.episode_key === r.episode_key)), r];
  }
}

// ffmpeg work is slow on small CI machines, so these tests get more time.
describe.skipIf(!hasFfmpeg)("transcribeNew (real audio files, fake speech-to-text)", { timeout: 60_000 }, () => {
  let dir: string;
  const fx = (f: string) => pathToFileURL(join(dir, f)).href;

  function writeFeed(items: { title: string; day: number; audio?: string; transcript?: string }[]) {
    const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel><title>P</title>${items
      .map((i) => `<item><title>${i.title}</title><link>https://example.com/${encodeURIComponent(i.title)}</link>
        <pubDate>${new Date(`2026-09-${String(i.day).padStart(2, "0")}T05:00:00Z`).toUTCString()}</pubDate>
        <description>Show notes for ${i.title}.</description>
        ${i.audio ? `<enclosure url="${i.audio}" type="audio/mpeg" length="1"/>` : ""}
        ${i.transcript ? `<podcast:transcript url="${i.transcript}" type="text/vtt"/>` : ""}</item>`)
      .join("")}</channel></rss>`;
    writeFileSync(join(dir, "feed.xml"), xml);
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "briefcast-tx-"));
    // 21 minutes of silence: speech-to-text gets it in 3 parts (10 + 10 + 1 minutes)
    execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "1260", "-b:a", "8k", join(dir, "long.mp3")]);
    copyFileSync(join(here, "fixtures/transcripts/ai-agents.vtt"), join(dir, "ep.vtt"));
  });

  const podcast = () => ({ id: "pod-1", title: "Sample Operators Podcast", feedUrl: fx("feed.xml") });
  const deps = () => ({ llm: new MockLlm(), stt: new MockStt() });
  const later = () => Date.now() + 60_000;

  it("does the last 2 episodes first, then only new ones", async () => {
    writeFeed([
      { title: "Old", day: 20, audio: fx("long.mp3") },
      { title: "With feed transcript", day: 22, audio: fx("long.mp3"), transcript: fx("ep.vtt") },
      { title: "Audio only", day: 23, audio: fx("long.mp3") },
    ]);
    const store = new MemoryStore([podcast()]);
    const d = deps();
    const first = await transcribeNew(store, d, { deadline: later() });
    expect(first).toMatchObject({ done: 2, failed: 0 });
    const byTitle = Object.fromEntries(store.rows.map((r) => [r.title, r]));
    expect(byTitle["Old"]).toBeUndefined();
    expect(byTitle["With feed transcript"]).toMatchObject({ origin: "feed", audio_minutes: 0, status: "done" });
    expect(byTitle["With feed transcript"]!.notes).toContain("rebuilt our search API");
    // even a short transcript goes through the notes step, so ads never reach the writer
    expect(d.llm.calls.filter((c) => c.step === "digest")).toHaveLength(2);
    expect(byTitle["Audio only"]).toMatchObject({ origin: "speech_to_text", status: "done", partial: false });
    expect(byTitle["Audio only"]!.audio_minutes).toBeCloseTo(21, 0);
    expect(d.stt.files).toHaveLength(3);
    // 21 minutes of talk is long, so it was turned into short notes
    expect(byTitle["Audio only"]!.notes!.split(/\s+/).length).toBeLessThanOrEqual(800);

    // nothing new: nothing to do
    expect(await transcribeNew(store, d, { deadline: later() })).toMatchObject({ done: 0, failed: 0 });

    // a new episode arrives
    writeFeed([
      { title: "With feed transcript", day: 22, audio: fx("long.mp3"), transcript: fx("ep.vtt") },
      { title: "Audio only", day: 23, audio: fx("long.mp3") },
      { title: "Brand new", day: 25, audio: fx("long.mp3") },
    ]);
    expect(await transcribeNew(store, d, { deadline: later() })).toMatchObject({ done: 1 });
    expect(store.rows.map((r) => r.title).sort()).toEqual(["Audio only", "Brand new", "With feed transcript"]);
  });

  it("saves a failed episode and tries it again next time", async () => {
    writeFeed([{ title: "Broken", day: 24, audio: fx("missing.mp3") }]);
    const store = new MemoryStore([podcast()]);
    for (let n = 1; n <= LIMITS.maxTranscribeAttempts + 1; n++) await transcribeNew(store, deps(), { deadline: later() });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: "failed", attempts: LIMITS.maxTranscribeAttempts });
    expect(store.rows[0]!.error).toBeTruthy();
  });

  it("stops speech-to-text at the daily limit, but still uses free feed transcripts", async () => {
    writeFeed([
      { title: "With feed transcript", day: 22, audio: fx("long.mp3"), transcript: fx("ep.vtt") },
      { title: "Audio only", day: 23, audio: fx("long.mp3") },
    ]);
    const store = new MemoryStore([podcast()]);
    store.minutesToday = LIMITS.maxAudioMinutesPerDay;
    const d = deps();
    await transcribeNew(store, d, { deadline: later() });
    expect(store.rows.map((r) => r.title)).toEqual(["With feed transcript"]);
    expect(d.stt.files).toHaveLength(0);
  });

  it("stops at the deadline and lets the worker make episodes in between", async () => {
    writeFeed([{ title: "A", day: 22, audio: fx("long.mp3") }, { title: "B", day: 23, audio: fx("long.mp3") }]);
    const store = new MemoryStore([podcast()]);
    let between = 0;
    await transcribeNew(store, deps(), { deadline: later(), between: async () => void between++ });
    expect(between).toBe(2);
    const late = new MemoryStore([podcast()]);
    expect(await transcribeNew(late, deps(), { deadline: Date.now() - 1 })).toMatchObject({ done: 0 });
  });
});

describe("episode pipeline with saved notes", () => {
  it("uses the saved notes instead of the show notes", async () => {
    const feedUrl = pathToFileURL(join(here, "fixtures/podcast.rss.xml")).href;
    const src = { id: "pod-1", kind: "podcast" as const, title: "Sample Operators Podcast", feedUrl, trust: 1 };
    const items = await collect([src], { now: new Date("2026-09-24T08:00:00Z"), lookbackDays: 7 });
    const target = items.find((i) => i.title.includes("small teams"))!;
    const notes = "Guest: Small teams with AI agents shipped a new booking flow in two weeks. " + "More detail here. ".repeat(20);

    const seen: { basis: string; text: string }[] = [];
    const base = new MockLlm();
    const llm: LlmClient = {
      async json(step, req, cost) {
        const d = req.data as { items?: { basis: string; text: string }[] };
        if (step === "write" && d.items) seen.push(...d.items);
        return base.json(step, req, cost);
      },
    };
    const l = ListenerInput.parse({
      displayName: "Test", context: "COO.", interests: [{ label: "AI agents", weight: "a_lot" }], sources: [src],
    });
    await runEpisode(l, {
      llm, tts: new MockTts(), now: new Date("2026-09-24T08:00:00Z"),
      storedNotes: async () => new Map([[notesKey(target), { notes, partial: false }]]),
    });
    expect(seen.some((i) => i.basis === "transcript" && i.text.includes("shipped a new booking flow"))).toBe(true);
  });

  it("still makes the episode when the notes lookup fails", async () => {
    const feedUrl = pathToFileURL(join(here, "fixtures/podcast.rss.xml")).href;
    const src = { id: "pod-1", kind: "podcast" as const, title: "Sample Operators Podcast", feedUrl, trust: 1 };
    const l = ListenerInput.parse({ displayName: "Test", context: "COO.", interests: [{ label: "AI agents", weight: "a_lot" }], sources: [src] });
    const r = await runEpisode(l, {
      llm: new MockLlm(), tts: new MockTts(), now: new Date("2026-09-24T08:00:00Z"),
      storedNotes: async () => { throw new Error("relation episode_transcripts does not exist"); },
    });
    expect(r.sections.length).toBeGreaterThan(0);
  });
});
