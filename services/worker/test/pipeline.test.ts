import { describe, it, expect } from "vitest";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { ListenerInput } from "@briefcast/shared";
import { collect, parseFeed } from "../src/pipeline/collect";
import { dedupe, scoreItems } from "../src/pipeline/rank";
import { finalizePlan, PlanError } from "../src/pipeline/plan";
import { runEpisode } from "../src/pipeline/run";
import { MockLlm } from "../src/providers/mockLlm";
import { MockTts } from "../src/providers/tts";
import type { LlmClient } from "../src/providers/llm";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (f: string) => pathToFileURL(join(here, "fixtures", f)).href;
const NOW = new Date("2026-09-24T08:00:00Z");

function listener(overrides: Record<string, unknown> = {}) {
  return ListenerInput.parse({
    displayName: "Test",
    context: "COO of a travel marketplace. Goal: move faster with AI. Call me at +972 54 123 4567.",
    interests: [
      { label: "AI agents", weight: "a_lot" },
      { label: "leadership", weight: "some" },
      { label: "celebrity gossip", weight: "avoid" },
    ],
    sources: [
      { kind: "rss", title: "Sample Tech Weekly", feedUrl: fixture("tech.rss.xml"), trust: 1 },
      { kind: "rss", title: "Sample Leadership Notes", feedUrl: fixture("leadership.atom.xml"), trust: 0.8 },
    ],
    ...overrides,
  });
}

describe("collect", () => {
  it("parses RSS and Atom", () => {
    expect(parseFeed(readFileSync(join(here, "fixtures/tech.rss.xml"), "utf8"))).toHaveLength(5);
    const atom = parseFeed(readFileSync(join(here, "fixtures/leadership.atom.xml"), "utf8"));
    expect(atom.map((a) => a.url)).toEqual(["https://example.org/single-threaded-owners", "https://example.org/questions"]);
  });

  it("keeps only recent items and cleans HTML", async () => {
    const items = await collect(listener().sources, { now: NOW, lookbackDays: 7 });
    expect(items.find((i) => i.title.includes("Old story"))).toBeUndefined();
    const ai = items.find((i) => i.url === "https://example.com/ai-agents-travel")!;
    expect(ai.excerpt).toContain("AI agents now book about 5 percent");
    expect(ai.excerpt).not.toContain("<");
  });

  it("skips a broken feed without failing", async () => {
    const sources = [...listener().sources, { kind: "rss" as const, title: "Broken", feedUrl: fixture("missing.xml"), trust: 1 }];
    const items = await collect(sources, { now: NOW, lookbackDays: 7 });
    expect(items.length).toBeGreaterThan(0);
  });
});

describe("rank", () => {
  it("removes near-duplicate titles and avoided topics", async () => {
    const items = await collect(listener().sources, { now: NOW, lookbackDays: 7 });
    const unique = dedupe(items);
    expect(unique.filter((i) => i.title.includes("AI agents")).length).toBe(1);
    const scored = scoreItems(unique, listener(), NOW);
    expect(scored.find((s) => s.item.title.includes("gossip"))).toBeUndefined();
    expect(scored[0]!.item.title).toMatch(/AI agents/); // strongest interest comes first
  });

  it("lowers topics covered in the last 14 days", async () => {
    const items = dedupe(await collect(listener().sources, { now: NOW, lookbackDays: 7 }));
    const fresh = scoreItems(items, listener(), NOW).find((s) => s.item.title.includes("AI agents"))!.score;
    const repeated = scoreItems(items, listener({ recentTopics: [{ tag: "agents", date: "2026-09-20" }] }), NOW)
      .find((s) => s.item.title.includes("AI agents"))!.score;
    expect(repeated).toBeLessThan(fresh);
  });
});

describe("plan validation", () => {
  const ranked = { items: [{ id: "S1" } as never] };
  const sec = (kind: "intro" | "idea" | "recap", ids: string[]) => ({
    kind, title: "t", mainIdea: "m", whyItMattersToListener: "w", counterView: "", question: "", sourceIds: ids, topicTags: [], weight: 1,
  });
  it("drops unknown source ids and rejects ideas without sources", () => {
    expect(() => finalizePlan({ title: "x", summary: "y", sections: [sec("idea", ["S9"])] }, ranked, 1000)).toThrow(PlanError);
    const p = finalizePlan({ title: "x", summary: "y", sections: [sec("intro", []), sec("idea", ["S1", "S9"])] }, ranked, 1000);
    expect(p.sections[1]!.sourceIds).toEqual(["S1"]);
    expect(p.sections.reduce((a, s) => a + s.targetWords, 0)).toBe(1000);
  });
});

describe("full pipeline (offline)", () => {
  const deps = () => ({ llm: new MockLlm(), tts: new MockTts(), now: NOW });

  it("makes a solo Mix episode on target length, with chapters, sources and no tags in the transcript", async () => {
    const r = await runEpisode(listener(), deps());
    expect(r.withinTarget).toBe(true);
    expect(r.chapters[0]!.kind).toBe("intro");
    expect(r.chapters.at(-1)!.kind).toBe("recap");
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.transcript.some((t) => /\[S\d/.test(t.text))).toBe(false);
    expect(r.transcript.every((t) => t.speaker === "HOST_A")).toBe(true);
    expect(r.cost.totalUsd).toBeGreaterThan(0);
    expect(r.cost.totalUsd).toBeLessThan(0.5);
  });

  it.each([5, 10, 20, 30])("hits a %i-minute target within 10%%", async (minutes) => {
    const l = listener();
    l.settings.lengthMinutes = minutes;
    const r = await runEpisode(l, deps());
    expect(r.withinTarget).toBe(true);
  });

  it("reads the full article for picked items when a page fetcher is given", async () => {
    const fetched: string[] = [];
    const words = Array.from({ length: 500 }, (_, i) => `detail${i}`).join(" ");
    const fetchPage = async (url: string) => {
      fetched.push(url);
      return { contentType: "text/html", body: `<article><p>Full article text. ${words}.</p></article>` };
    };
    const r = await runEpisode(listener(), { ...deps(), fetchPage });
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.length).toBeLessThanOrEqual(15); // only picked items, not the whole feed
    expect(r.sources.some((s) => s.item.excerpt.startsWith("Full article text."))).toBe(true);
  });

  it("makes a two-host conversation", async () => {
    const l = listener();
    l.settings.format = "conversation";
    const r = await runEpisode(l, deps());
    expect(new Set(r.transcript.map((t) => t.speaker))).toEqual(new Set(["HOST_A", "HOST_B"]));
  });

  it("turns a 'go deeper' request into a deep dive", async () => {
    const l = listener({
      deepDiveRequest: { title: "Single-threaded owners", mainIdea: "One owner ships faster", sourceUrls: ["https://example.org/single-threaded-owners"] },
    });
    const r = await runEpisode(l, deps());
    expect(r.episodeType).toBe("deep_dive");
    expect(r.chapters.at(-1)!.kind).toBe("questions");
  });

  it("never sends the phone number from the profile to the model after scrubbing", async () => {
    const { scrubSensitive } = await import("../src/lib/scrub");
    const l = listener();
    l.context = scrubSensitive(l.context).text;
    const llm = new MockLlm();
    await runEpisode(l, { ...deps(), llm });
    expect(llm.calls.some((c) => c.userMessage.includes("123 4567"))).toBe(false);
  });

  it("uses the checker's fixed lines and removes unknown source tags", async () => {
    const base = new MockLlm();
    const llm: LlmClient = {
      async json(step, req, cost) {
        if (step === "write" && !(req.data as { lines?: unknown }).lines) {
          const out = (await base.json(step, req, cost)) as { lines: { speaker: string; text: string }[] };
          out.lines[0]!.text += " A made-up fact [S99].";
          return out as never;
        }
        if (step === "check") {
          const d = req.data as { sections: { index: number; lines: { speaker: string; text: string }[] }[] };
          return {
            sections: d.sections.map((s) =>
              s.index === 1
                ? { index: 1, ok: false, problems: [{ type: "unsupported_claim", detail: "claim not in source" }],
                    fixedLines: s.lines.map((l) => ({ ...l, text: l.text.replace("A made-up fact [S99].", "") })) }
                : { index: s.index, ok: true, problems: [], fixedLines: [] },
            ),
          } as never;
        }
        return base.json(step, req, cost);
      },
    };
    const r = await runEpisode(listener(), { llm, tts: new MockTts(), now: NOW });
    const text = r.sections.flatMap((s) => s.lines.map((l) => l.text)).join(" ");
    expect(text).not.toContain("S99");
    expect(r.sections[1]!.lines[0]!.text).not.toContain("made-up");
    expect(r.issues.some((i) => i.type === "unsupported_claim" && i.fixed)).toBe(true);
    expect(r.issues.some((i) => i.type === "unknown_source")).toBe(true);
  });
});
