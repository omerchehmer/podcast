import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LIMITS, ListenerInput } from "@briefcast/shared";
import { collect, itemForLlm, parseFeed, type CollectedItem } from "../src/pipeline/collect";
import { addTranscripts, pickTranscript, transcriptToText } from "../src/pipeline/transcript";
import { runEpisode } from "../src/pipeline/run";
import { MockLlm } from "../src/providers/mockLlm";
import { MockTts } from "../src/providers/tts";
import { CostTracker } from "../src/lib/cost";
import type { LlmClient } from "../src/providers/llm";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date("2026-09-24T08:00:00Z");

/** The podcast fixture with real file:// links to the transcript fixtures. */
function podcastFeedUrl(): string {
  const xml = readFileSync(join(here, "fixtures/podcast.rss.xml"), "utf8")
    .replaceAll("{{FIXTURES}}", pathToFileURL(join(here, "fixtures")).href);
  const file = join(mkdtempSync(join(tmpdir(), "briefcast-")), "podcast.rss.xml");
  writeFileSync(file, xml);
  return pathToFileURL(file).href;
}

const source = (kind: "podcast" | "rss") => ({ kind, title: "Sample Operators Podcast", feedUrl: podcastFeedUrl(), trust: 1 });

describe("podcast feeds", () => {
  it("reads the audio file and picks the best transcript link", () => {
    const raw = parseFeed(readFileSync(join(here, "fixtures/podcast.rss.xml"), "utf8"));
    expect(raw[0]!.audio).toBe(true);
    expect(raw[0]!.transcript?.type).toBe("text/vtt");
  });

  it("marks podcast items as show notes, even in a feed added as plain RSS", async () => {
    for (const kind of ["podcast", "rss"] as const) {
      const items = await collect([source(kind)], { now: NOW, lookbackDays: 7 });
      expect(items.every((i) => i.basis === "show_notes")).toBe(true);
    }
  });

  it("keeps ordinary articles as text", async () => {
    const tech = pathToFileURL(join(here, "fixtures/tech.rss.xml")).href;
    const items = await collect([{ kind: "rss", title: "Tech", feedUrl: tech, trust: 1 }], { now: NOW, lookbackDays: 7 });
    expect(items.every((i) => i.basis === "text")).toBe(true);
  });
});

describe("transcriptToText", () => {
  it("cleans WebVTT and keeps speaker names once per turn", () => {
    const text = transcriptToText(readFileSync(join(here, "fixtures/transcripts/ai-agents.vtt"), "utf8"), "text/vtt");
    expect(text).not.toMatch(/-->|WEBVTT|NOTE|<v/);
    expect(text).toContain("Guest: Right now about two percent of our bookings come from AI agents. But that number doubled");
    expect(text.match(/Guest:/g)).toHaveLength(1);
  });

  it("cleans SRT", () => {
    const srt = "1\n00:00:01,000 --> 00:00:03,000\nAnna: Hello there.\n\n2\n00:00:03,000 --> 00:00:05,000\nWe start now.\n";
    expect(transcriptToText(srt, "application/x-subrip")).toBe("Anna: Hello there. We start now.");
  });

  it("reads Podcasting 2.0 JSON", () => {
    const json = JSON.stringify({ segments: [{ speaker: "Ben", body: "One." }, { speaker: "Ben", body: "Two." }, { speaker: "Ann", body: "Three." }] });
    expect(transcriptToText(json, "application/json")).toBe("Ben: One. Two.\nAnn: Three.");
  });

  it("prefers JSON or VTT over HTML", () => {
    expect(pickTranscript([{ url: "a", type: "text/html" }, { url: "b", type: "application/json" }])?.url).toBe("b");
    expect(pickTranscript([])).toBeUndefined();
  });
});

describe("addTranscripts", () => {
  it("uses the transcript when it loads, and keeps show notes when it does not", async () => {
    const items = (await collect([source("podcast")], { now: NOW, lookbackDays: 7 })).map((i, n) => ({ ...i, id: `S${n + 1}` }));
    const out = await addTranscripts(items);
    const withT = out.find((i) => i.url?.endsWith("ai-agents"))!;
    const without = out.find((i) => i.url?.endsWith("small-teams"))!;
    expect(withT.basis).toBe("transcript");
    expect(withT.excerpt).toContain("rebuilt our search API");
    expect(withT.transcriptPartial).toBe(false);
    expect(without.basis).toBe("show_notes");
    expect(without.excerpt).toBe("We talk about AI agents and why small teams win.");
  });

  it("only loads transcripts for the ids it is given", async () => {
    const items = (await collect([source("podcast")], { now: NOW, lookbackDays: 7 })).map((i, n) => ({ ...i, id: `S${n + 1}` }));
    const out = await addTranscripts(items, new Set(["S999"]));
    expect(out.every((i) => i.basis === "show_notes")).toBe(true);
  });

  it("marks a long transcript as partial", async () => {
    const dir = mkdtempSync(join(tmpdir(), "briefcast-"));
    writeFileSync(join(dir, "long.txt"), "word ".repeat(LIMITS.maxTranscriptWords + 100));
    const item: CollectedItem = {
      id: "S1", sourceTitle: "P", sourceKind: "podcast", trust: 1, title: "Long", summary: "s", excerpt: "s", hash: "h",
      basis: "show_notes", transcript: { url: pathToFileURL(join(dir, "long.txt")).href, type: "text/plain" },
    };
    const [out] = await addTranscripts([item]);
    expect(out!.transcriptPartial).toBe(true);
    expect(itemForLlm(out!, "excerpt").partial).toBe(true);
    // the short summary is still from the show notes
    expect(itemForLlm(out!, "summary").basis).toBe("show_notes");
  });
});

describe("long transcripts", () => {
  function longItem(words: number): CollectedItem {
    const dir = mkdtempSync(join(tmpdir(), "briefcast-"));
    writeFileSync(join(dir, "long.txt"), Array.from({ length: words }, (_, n) => `w${n}`).join(" "));
    return {
      id: "S1", sourceTitle: "P", sourceKind: "podcast", trust: 1, title: "Long", summary: "s", excerpt: "s", hash: "h",
      basis: "show_notes", transcript: { url: pathToFileURL(join(dir, "long.txt")).href, type: "text/plain" },
    };
  }

  it("turns a long transcript into short notes with one cheap call", async () => {
    const llm = new MockLlm();
    const [out] = await addTranscripts([longItem(LIMITS.digestAboveWords + 5000)], undefined, { llm, cost: new CostTracker() });
    expect(llm.calls.filter((c) => c.step === "digest")).toHaveLength(1);
    expect(out!.basis).toBe("transcript");
    expect(out!.transcriptPartial).toBe(false);
    expect(out!.excerpt.split(/\s+/).length).toBeLessThanOrEqual(800);
  });

  it("does not call the model for a short transcript", async () => {
    const llm = new MockLlm();
    const [out] = await addTranscripts([longItem(500)], undefined, { llm, cost: new CostTracker() });
    expect(llm.calls).toHaveLength(0);
    expect(out!.excerpt.split(/\s+/).length).toBe(500);
  });

  it("keeps the start of the transcript, marked partial, when the digest fails", async () => {
    const llm: LlmClient = { json: async () => { throw new Error("model down"); } };
    const [out] = await addTranscripts([longItem(LIMITS.digestAboveWords + 5000)], undefined, { llm, cost: new CostTracker() });
    expect(out!.basis).toBe("transcript");
    expect(out!.transcriptPartial).toBe(true);
    expect(out!.excerpt.split(/\s+/).length).toBeLessThanOrEqual(LIMITS.digestAboveWords + 1);
  });

  it("never sends more than the word limit to the digest", async () => {
    const llm = new MockLlm();
    await addTranscripts([longItem(LIMITS.maxTranscriptWords + 1000)], undefined, { llm, cost: new CostTracker() });
    const sent = String((llm.calls[0]!.data as { transcript: string }).transcript).split(/\s+/).filter((w) => w !== "…");
    expect(sent.length).toBe(LIMITS.maxTranscriptWords);
    expect((llm.calls[0]!.data as { partial: boolean }).partial).toBe(true);
  });
});

describe("full pipeline with a podcast", () => {
  it("gives the writer and checker the transcript, labelled with its basis", async () => {
    const seen: { step: string; items: { basis: string; text: string }[] }[] = [];
    const base = new MockLlm();
    const llm: LlmClient = {
      async json(step, req, cost) {
        const d = req.data as { items?: { basis: string; text: string }[]; sections?: { items: { basis: string; text: string }[] }[] };
        if (step === "write" && d.items) seen.push({ step, items: d.items });
        if (step === "check") seen.push({ step, items: d.sections!.flatMap((s) => s.items) });
        return base.json(step, req, cost);
      },
    };
    const l = ListenerInput.parse({
      displayName: "Test", context: "COO of a travel marketplace.",
      interests: [{ label: "AI agents", weight: "a_lot" }],
      sources: [source("podcast")],
    });
    const r = await runEpisode(l, { llm, tts: new MockTts(), now: NOW });

    const all = seen.flatMap((s) => s.items);
    expect(all.some((i) => i.basis === "transcript" && i.text.includes("rebuilt our search API"))).toBe(true);
    expect(all.some((i) => i.basis === "show_notes")).toBe(true);
    expect(seen.some((s) => s.step === "check" && s.items.some((i) => i.basis === "transcript"))).toBe(true);
    expect(r.sources.some((s) => s.item.basis === "transcript")).toBe(true);
  });
});
