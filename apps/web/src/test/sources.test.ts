import { describe, it, expect } from "vitest";
import { groupByInterests } from "../components/editors";
import type { SourceOption } from "../api";

const cats = [{ id: "travel", name: "Travel industry" }, { id: "ai", name: "AI and technology" }, { id: "markets", name: "Markets and economy" }];
const src = (id: string, categories: string[], quality: number, kind: SourceOption["kind"] = "rss"): SourceOption =>
  ({ id, kind, title: id, categories, quality, why: "because", evidence: [] });

describe("groupByInterests", () => {
  it("orders groups by interest strength, hides avoided topics, and puts the rest under Other topics", () => {
    const catalog = [
      src("ai-news", ["ai"], 0.9), src("travel-book", ["travel"], 1, "book"), src("travel-low", ["travel"], 0.7),
      src("travel-top", ["travel"], 0.9), src("markets-ai", ["markets", "ai"], 0.8), src("health", ["health"], 0.9),
    ];
    const groups = groupByInterests(catalog, [
      { label: "AI and technology", weight: "some", categoryId: "ai" },
      { label: "Travel industry", weight: "a_lot", categoryId: "travel" },
      { label: "Markets and economy", weight: "avoid", categoryId: "markets" },
    ], cats);
    expect(groups.map((g) => g.key)).toEqual(["travel", "ai", "other"]);
    expect(groups[0]!.items.map((s) => s.id)).toEqual(["travel-top", "travel-low", "travel-book"]);
    expect(groups[1]!.items.map((s) => s.id)).toEqual(["ai-news"]);
    expect(groups[2]!.items.map((s) => s.id)).toEqual(["health"]);
  });

  it("uses the second topic when the main topic is not an interest", () => {
    const groups = groupByInterests([src("x", ["strategy", "ai"], 0.9)], [{ label: "AI and technology", weight: "some", categoryId: "ai" }], cats);
    expect(groups[0]!.key).toBe("ai");
  });
});
