import { describe, it, expect } from "vitest";
import { PreferenceState } from "@briefcast/shared";
import { computeUpdates, summarize } from "../src/learning/learn";
import { MockLlm } from "../src/providers/mockLlm";
import { CostTracker } from "../src/lib/cost";
import { decryptText, encryptText, byteaToBuffer, bufferToBytea } from "../src/lib/crypto";
import { randomBytes } from "node:crypto";

const prefs = PreferenceState.parse({});
const interests = [
  { id: "i1", label: "leadership", learnedWeight: 1 },
  { id: "i2", label: "markets", learnedWeight: 1 },
];
const sources = [{ sourceId: "s1", trust: 0.8 }];

describe("learning loop rules", () => {
  it("moves topic weights and source trust with thumbs", () => {
    const u = computeUpdates(prefs, interests, sources, [{
      episodeTitle: "E1", stars: 4, quickTags: [], note: null,
      segments: [
        { title: "Leadership lessons", topicTags: ["leadership"], thumb: 1, goDeeper: false, sourceIds: ["s1"] },
        { title: "Stock markets today", topicTags: ["markets"], thumb: -1, goDeeper: false, sourceIds: [] },
      ],
    }]);
    expect(u.interests.find((i) => i.id === "i1")!.learnedWeight).toBeCloseTo(1.1);
    expect(u.interests.find((i) => i.id === "i2")!.learnedWeight).toBeCloseTo(0.9);
    expect(u.sources[0]!.trust).toBeCloseTo(0.85);
    expect(u.signals).toEqual(expect.arrayContaining(["more about leadership", "less about markets"]));
  });

  it("uses quick options, with limits", () => {
    const many = Array.from({ length: 10 }, () => ({
      episodeTitle: "E", stars: 2, quickTags: ["too_long", "too_basic"], note: null, segments: [],
    }));
    const u = computeUpdates(prefs, interests, sources, many);
    expect(u.preferences.lengthBiasSeconds).toBe(-180); // never more than 3 minutes shorter
    expect(u.preferences.depth).toBe(1);
  });

  it("treats 'go deeper' as a strong like", () => {
    const u = computeUpdates(prefs, interests, sources, [{
      episodeTitle: "E", stars: null, quickTags: [], note: null,
      segments: [{ title: "Leadership and trust", topicTags: [], thumb: null, goDeeper: true, sourceIds: [] }],
    }]);
    expect(u.interests.find((i) => i.id === "i1")!.learnedWeight).toBeCloseTo(1.15);
  });

  it("writes a change note from the signals", async () => {
    const s = await summarize("", [], ["more about leadership"], new MockLlm(), new CostTracker());
    expect(s.changeNote).toContain("leadership");
  });
});

describe("profile encryption", () => {
  it("round-trips and fails with the wrong key", () => {
    const k = randomBytes(32).toString("base64");
    const enc = encryptText("I lead a team of 40.", k);
    expect(decryptText(byteaToBuffer(bufferToBytea(enc)), k)).toBe("I lead a team of 40.");
    expect(() => decryptText(enc, randomBytes(32).toString("base64"))).toThrow();
  });
});
