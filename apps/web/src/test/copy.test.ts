import { describe, it, expect } from "vitest";
import { formatTime, PROFILE_PROMPT } from "../copy";

describe("copy helpers", () => {
  it("formats times", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(61.9)).toBe("1:01");
    expect(formatTime(900)).toBe("15:00");
  });
  it("the profile prompt asks the assistant to leave out sensitive data", () => {
    expect(PROFILE_PROMPT).toMatch(/Do NOT include passwords/);
  });
});
