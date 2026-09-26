import { describe, it, expect } from "vitest";
import { nextEpisodeAt, nextEpisodeLabel } from "../copy";

const TZ = "Asia/Jerusalem";
const at730 = { customDays: [], deliveryTime: "07:30:00" };

describe("next episode time", () => {
  // Saturday 26 Sep 2026, 13:43 in Israel
  const sat = new Date("2026-09-26T10:43:00Z");

  it("weekdays skip the weekend and wait for Monday", () => {
    const at = nextEpisodeAt({ ...at730, frequency: "weekdays" }, TZ, sat)!;
    expect(at.toISOString()).toBe("2026-09-28T04:30:00.000Z");
    expect(nextEpisodeLabel(at, TZ, sat)).toBe("Monday 28 September at 07:30");
  });

  it("every day means tomorrow morning", () => {
    const at = nextEpisodeAt({ ...at730, frequency: "daily" }, TZ, sat)!;
    expect(at.toISOString()).toBe("2026-09-27T04:30:00.000Z");
    expect(nextEpisodeLabel(at, TZ, sat)).toBe("tomorrow at 07:30");
  });

  it("before the delivery time, it is today", () => {
    const early = new Date("2026-09-27T03:00:00Z"); // Sunday 06:00 in Israel
    const at = nextEpisodeAt({ ...at730, frequency: "daily" }, TZ, early)!;
    expect(nextEpisodeLabel(at, TZ, early)).toBe("today at 07:30");
  });

  it("custom days and no days", () => {
    expect(nextEpisodeAt({ ...at730, frequency: "custom", customDays: [7] }, TZ, sat)!.toISOString()).toBe("2026-09-27T04:30:00.000Z");
    expect(nextEpisodeAt({ ...at730, frequency: "custom", customDays: [] }, TZ, sat)).toBeNull();
  });

  it("handles the clock change (Israel leaves summer time on 25 Oct 2026)", () => {
    const at = nextEpisodeAt({ ...at730, frequency: "daily" }, TZ, new Date("2026-10-24T12:00:00Z"))!;
    expect(at.toISOString()).toBe("2026-10-25T05:30:00.000Z");
  });
});
