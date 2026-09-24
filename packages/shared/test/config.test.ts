import { describe, it, expect } from "vitest";
import { DEFAULT_VOICES, LLM_MODELS, LLM_PRICES, ListenerInput, PodcastSettings, VOICES } from "../src";

describe("config", () => {
  it("has a price for every model in use (needed for cost logs)", () => {
    for (const m of Object.values(LLM_MODELS)) expect(LLM_PRICES[m]).toBeDefined();
  });
  it("default voices exist", () => {
    for (const v of Object.values(DEFAULT_VOICES)) expect(VOICES.some((x) => x.id === v)).toBe(true);
  });
  it("settings have safe defaults", () => {
    expect(PodcastSettings.parse({})).toMatchObject({ frequency: "weekdays", lengthMinutes: 15, format: "solo", episodeType: "mix" });
    expect(ListenerInput.parse({}).settings.language).toBe("en");
  });
});
