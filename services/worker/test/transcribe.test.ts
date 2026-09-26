import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LIMITS, ListenerInput } from "@briefcast/shared";
import {
  pickEpisodes, ruleSkip, transcribeNew,
  type FeedEpisode, type PodcastSource, type TranscribeDeps, type TranscribeOptions, type TranscriptRow, type TranscriptSave, type TranscriptStore,
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

describe("ruleSkip", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  const aud = (lookbackDays: number) => ({ followers: 1, lookbackDays, interests: [], avoid: [], trust: 1 });
  it("skips episodes older than the longest look-back of the followers", () => {
    expect(ruleSkip(ep("e", 22), aud(2), now)).toMatch(/too old/);
    expect(ruleSkip(ep("e", 22), aud(7), now)).toBeNull();
  });
  it("skips trailers and very short episodes", () => {
    expect(ruleSkip(ep("Season 3 trailer", 26), aud(2), now)).toMatch(/trailer/);
    expect(ruleSkip(ep("e", 26, { durationMin: 2 }), aud(2), now)).toMatch(/short/);
    expect(ruleSkip(ep("e", 26, { durationMin: 40 }), aud(2), now)).toBeNull();
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

  function writeFeed(items: { title: string; day: number; audio?: string; transcript?: string; duration?: string }[]) {
    const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel><title>P</title>${items
      .map((i) => `<item><title>${i.title}</title><link>https://example.com/${encodeURIComponent(i.title)}</link>
        <pubDate>${new Date(`2026-09-${String(i.day).padStart(2, "0")}T05:00:00Z`).toUTCString()}</pubDate>
        <description>Show notes for ${i.title}.</description>
        ${i.audio ? `<enclosure url="${i.audio}" type="audio/mpeg" length="1"/>` : ""}
        ${i.transcript ? `<podcast:transcript url="${i.transcript}" type="text/vtt"/>` : ""}
        ${i.duration ? `<itunes:duration>${i.duration}</itunes:duration>` : ""}</item>`)
      .join("")}</channel></rss>`;
    writeFileSync(join(dir, "feed.xml"), xml);
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "briefcast-tx-"));
    // 21 minutes of silence: speech-to-text gets it in 3 parts (10 + 10 + 1 minutes)
    execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "1260", "-b:a", "8k", join(dir, "long.mp3")]);
    copyFileSync(join(here, "fixtures/transcripts/ai-agents.vtt"), join(dir, "ep.vtt"));
  });

  const podcast = (lookbackDays = 7) => ({
    id: "pod-1", title: "Sample Operators Podcast", feedUrl: fx("feed.xml"),
    audience: { followers: 2, lookbackDays, interests: [{ label: "AI agents", weight: 1.6 }], avoid: ["celebrity gossip"], trust: 1 },
  });
  const deps = () => ({ llm: new MockLlm(), stt: new MockStt() });
  const NOW = new Date("2026-09-26T12:00:00Z");
  const later = () => Date.now() + 60_000;
  const run = (store: TranscriptStore, d: TranscribeDeps, extra: Partial<TranscribeOptions> = {}) =>
    transcribeNew(store, d, { deadline: later(), now: NOW, ...extra });

  it("does the last 2 episodes first, then only new ones", async () => {
    writeFeed([
      { title: "Old", day: 20, audio: fx("long.mp3") },
      { title: "With feed transcript", day: 22, audio: fx("long.mp3"), transcript: fx("ep.vtt") },
      { title: "AI agents audio only", day: 23, audio: fx("long.mp3") },
    ]);
    const store = new MemoryStore([podcast()]);
    const d = deps();
    const first = await run(store, d);
    expect(first).toMatchObject({ done: 2, failed: 0 });
    const byTitle = Object.fromEntries(store.rows.map((r) => [r.title, r]));
    expect(byTitle["Old"]).toBeUndefined();
    expect(byTitle["With feed transcript"]).toMatchObject({ origin: "feed", audio_minutes: 0, status: "done" });
    expect(byTitle["With feed transcript"]!.notes).toContain("rebuilt our search API");
    // even a short transcript goes through the notes step, so ads never reach the writer
    expect(d.llm.calls.filter((c) => c.step === "digest")).toHaveLength(2);
    expect(byTitle["AI agents audio only"]).toMatchObject({ origin: "speech_to_text", status: "done", partial: false });
    expect(byTitle["AI agents audio only"]!.audio_minutes).toBeCloseTo(21, 0);
    expect(d.stt.files).toHaveLength(3);
    // 21 minutes of talk is long, so it was turned into short notes
    expect(byTitle["AI agents audio only"]!.notes!.split(/\s+/).length).toBeLessThanOrEqual(800);

    // nothing new: nothing to do
    expect(await run(store, d)).toMatchObject({ done: 0, failed: 0 });

    // a new episode arrives
    writeFeed([
      { title: "With feed transcript", day: 22, audio: fx("long.mp3"), transcript: fx("ep.vtt") },
      { title: "AI agents audio only", day: 23, audio: fx("long.mp3") },
      { title: "Brand new AI agents talk", day: 25, audio: fx("long.mp3") },
    ]);
    expect(await run(store, d)).toMatchObject({ done: 1 });
    expect(store.rows.map((r) => r.title).sort()).toEqual(["AI agents audio only", "Brand new AI agents talk", "With feed transcript"]);
  });

  it("saves a failed episode and tries it again next time", async () => {
    writeFeed([{ title: "Broken AI agents", day: 24, audio: fx("missing.mp3") }]);
    const store = new MemoryStore([podcast()]);
    for (let n = 1; n <= LIMITS.maxTranscribeAttempts + 1; n++) await run(store, deps());
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: "failed", attempts: LIMITS.maxTranscribeAttempts });
    expect(store.rows[0]!.error).toBeTruthy();
  });

  it("stops speech-to-text at the daily limit, but still uses free feed transcripts", async () => {
    writeFeed([
      { title: "With feed transcript", day: 22, audio: fx("long.mp3"), transcript: fx("ep.vtt") },
      { title: "AI agents audio only", day: 23, audio: fx("long.mp3") },
    ]);
    const store = new MemoryStore([podcast()]);
    store.minutesToday = LIMITS.maxAudioMinutesPerDay;
    const d = deps();
    await run(store, d);
    expect(store.rows.map((r) => r.title)).toEqual(["With feed transcript"]);
    expect(d.stt.files).toHaveLength(0);
  });

  it("skips episodes the followers would not care about, and does not check them again", async () => {
    writeFeed([
      { title: "Celebrity gossip roundup", day: 24, audio: fx("long.mp3") },
      { title: "How AI agents book travel", day: 25, audio: fx("long.mp3") },
    ]);
    const store = new MemoryStore([podcast()]);
    const d = deps();
    expect(await run(store, d)).toMatchObject({ checked: 2, skipped: 1, done: 1 });
    const gossip = store.rows.find((r) => r.title.startsWith("Celebrity"))!;
    expect(gossip).toMatchObject({ status: "skipped", value: 2, audio_minutes: 0, notes: null });
    expect(d.stt.files).toHaveLength(3); // only the AI agents episode was transcribed
    const checks = d.llm.calls.filter((c) => c.step === "triage").length;
    await run(store, d);
    expect(d.llm.calls.filter((c) => c.step === "triage").length).toBe(checks);
  });

  it("skips old episodes and trailers for free, without asking the model", async () => {
    writeFeed([
      { title: "AI agents deep dive", day: 20, audio: fx("long.mp3") },
      { title: "AI agents season 2", day: 25, audio: fx("long.mp3"), duration: "1:30" },
    ]);
    const store = new MemoryStore([podcast(2)]);
    const d = deps();
    expect(await run(store, d)).toMatchObject({ skipped: 2, done: 0 });
    expect(store.rows.map((r) => r.reason).sort()).toEqual(["older than 2 days, too old for any briefing", "very short: trailer or teaser"]);
    expect(d.llm.calls.filter((c) => c.step === "triage")).toHaveLength(0);
    expect(d.stt.files).toHaveLength(0);
  });

  it("spends the daily budget on the most useful episode first", async () => {
    writeFeed([{ title: "AI agents A", day: 24, audio: fx("long.mp3") }, { title: "AI agents B", day: 25, audio: fx("long.mp3") }]);
    const base = new MockLlm();
    const llm: LlmClient = {
      async json(step, req, cost) {
        if (step !== "triage") return base.json(step, req, cost);
        const eps = (req.data as { shows: { episodes: { id: string; title: string }[] }[] }).shows.flatMap((x) => x.episodes);
        return { episodes: eps.map((e) => ({ id: e.id, value: e.title.endsWith("A") ? 9 : 7, reason: "test" })) } as never;
      },
    };
    const store = new MemoryStore([podcast()]);
    store.minutesToday = LIMITS.maxAudioMinutesPerDay - 1;
    await run(store, { llm, stt: new MockStt() });
    expect(store.rows.map((r) => [r.title, r.status])).toEqual([["AI agents A", "done"]]);
  });

  it("uses a keyword check when the model check fails", async () => {
    writeFeed([
      { title: "Celebrity gossip roundup", day: 24, audio: fx("long.mp3") },
      { title: "How AI agents book travel", day: 25, audio: fx("long.mp3") },
    ]);
    const base = new MockLlm();
    const llm: LlmClient = {
      async json(step, req, cost) {
        if (step === "triage") throw new Error("model down");
        return base.json(step, req, cost);
      },
    };
    const store = new MemoryStore([podcast()]);
    await run(store, { llm, stt: new MockStt() });
    expect(Object.fromEntries(store.rows.map((r) => [r.title, r.status]))).toEqual({
      "Celebrity gossip roundup": "skipped", "How AI agents book travel": "done",
    });
  });

  it("stops at the deadline and lets the worker make episodes in between", async () => {
    writeFeed([{ title: "AI agents A", day: 22, audio: fx("long.mp3") }, { title: "AI agents B", day: 23, audio: fx("long.mp3") }]);
    const store = new MemoryStore([podcast()]);
    let between = 0;
    await run(store, deps(), { between: async () => void between++ });
    expect(between).toBe(2);
    const late = new MemoryStore([podcast()]);
    expect(await run(late, deps(), { deadline: Date.now() - 1 })).toMatchObject({ done: 0 });
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
