import { describe, it, expect } from "vitest";
import { htmlToText, longQuotes, sourceTagsIn, stripSourceTags, wordCount } from "../src/lib/text";
import { scrubSensitive } from "../src/lib/scrub";
import { ideasForMix, splitBudget, targetWords, withinTolerance } from "../src/lib/length";
import { CostCapExceeded, CostTracker } from "../src/lib/cost";
import { splitForTts } from "../src/providers/tts";

describe("text", () => {
  it("strips source tags before speaking", () => {
    expect(stripSourceTags("Revenue grew 20 percent [S3]. Costs fell [S1, S4].")).toBe("Revenue grew 20 percent. Costs fell.");
  });
  it("finds source tags", () => {
    expect(sourceTagsIn("a [S1] b [S2, S3] c [S1]").sort()).toEqual(["S1", "S2", "S3"]);
  });
  it("cleans HTML", () => {
    expect(htmlToText("<p>Hello &amp; welcome</p><script>x()</script><p>Bye&#39;s</p>")).toBe("Hello & welcome\nBye's");
  });
  it("finds long quotes", () => {
    const long = Array(30).fill("word").join(" ");
    expect(longQuotes(`He said "short one" and "${long}"`, 25)).toHaveLength(1);
  });
  it("counts words", () => expect(wordCount("  one two\nthree ")).toBe(3));
});

describe("sensitive data scrubber", () => {
  it("removes card numbers, IBANs, emails, phones and passwords", () => {
    const r = scrubSensitive(
      "Card 4111 1111 1111 1111, IBAN DE89 3704 0044 0532 0130 00, mail me at a.b@c.com, call +972 54 123 4567, password: hunter2",
    );
    expect(r.text).not.toMatch(/4111|DE89|a\.b@c\.com|123 4567|hunter2/);
    expect(r.removed.sort()).toEqual(["card_number", "email", "iban", "password", "phone"].sort());
  });
  it("keeps normal business text and numbers", () => {
    const text = "We grew revenue 35% in 2025 and have 1200 employees in 14 countries.";
    expect(scrubSensitive(text)).toEqual({ text, removed: [] });
  });
  it("does not treat random digit groups as cards (Luhn check)", () => {
    expect(scrubSensitive("Order 1234 5678 9012 3456").removed).not.toContain("card_number");
  });
  it("removes government IDs", () => {
    expect(scrubSensitive("My SSN is 123-45-6789").removed).toContain("government_id");
    expect(scrubSensitive("passport number X1234567").removed).toContain("government_id");
  });
});

describe("length control", () => {
  it("uses 160 words per minute", () => expect(targetWords(20 * 60)).toBe(3200));
  it("checks ±10%", () => {
    expect(withinTolerance(1080, 1000)).toBe(true);
    expect(withinTolerance(1120, 1000)).toBe(false);
  });
  it("splits a budget exactly", () => {
    const parts = splitBudget(1600, [0.5, 2, 2, 2, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1600);
    expect(parts[0]).toBeLessThan(parts[1]!);
  });
  it("fits more ideas in longer episodes", () => {
    expect(ideasForMix(5)).toBeLessThan(ideasForMix(30));
  });
});

describe("cost tracking", () => {
  it("prices Claude calls including cache reads", () => {
    const c = new CostTracker(100);
    c.addLlm("write", "claude-sonnet-5", { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000 });
    // $2 input + $1 output + $0.20 cache read
    expect(c.totalUsd).toBeCloseTo(3.2, 5);
  });
  it("stops the episode when over the hard cap", () => {
    const c = new CostTracker(0.5);
    expect(() => c.addTts("openai", "m", 1000, 0.6)).toThrow(CostCapExceeded);
  });
});

describe("TTS splitting", () => {
  it("splits long text on sentence ends under the limit", () => {
    const text = Array(300).fill("This is one sentence.").join(" ");
    const chunks = splitForTts(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1000 && c.endsWith("."))).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });
});

describe("edge function copies", () => {
  it("the Edge Function scrubber is the same code as the worker's", async () => {
    const { readFileSync } = await import("node:fs");
    const worker = readFileSync(new URL("../src/lib/scrub.ts", import.meta.url), "utf8");
    const edge = readFileSync(new URL("../../../supabase/functions/_shared/scrub.ts", import.meta.url), "utf8");
    expect(edge.split("\n").slice(1).join("\n")).toBe(worker);
  });
});
