import { describe, it, expect } from "vitest";
import { rankSuggestions } from "../suggestions";
import type { SourceOption } from "../api/types";

const list: SourceOption[] = [
  { id: "1", kind: "podcast", title: "Travel Show", categories: ["travel"] },
  { id: "2", kind: "book", title: "Strategy Book", categories: ["strategy"] },
  { id: "3", kind: "rss", title: "AI and Strategy", categories: ["ai", "strategy"] },
  { id: "4", kind: "rss", title: "Science Site", categories: ["science"] },
];
const cats = [{ id: "travel", name: "Travel industry" }, { id: "strategy", name: "Strategy" }];

describe("suggested sources", () => {
  it("puts the best matches first and hides avoided topics", () => {
    const r = rankSuggestions(list, [
      { label: "Travel industry", weight: "a_lot", categoryId: "travel" },
      { label: "Strategy", weight: "a_little", categoryId: "strategy" },
      { label: "AI", weight: "avoid", categoryId: "ai" },
    ], cats);
    expect(r.map((d) => [d.title, d.score])).toEqual([
      ["Travel Show", 3], ["Strategy Book", 1], ["Science Site", 0], ["AI and Strategy", -1],
    ]);
    expect(r[0]!.topics).toEqual(["Travel industry"]);
  });

  it("without interests, everything scores 0 (all are shown)", () => {
    expect(rankSuggestions(list, [], cats).every((d) => d.score === 0)).toBe(true);
  });
});
