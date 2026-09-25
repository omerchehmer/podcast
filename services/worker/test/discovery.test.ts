import { describe, it, expect } from "vitest";
import { pickDiscoverySources, type CatalogSource } from "../src/lib/discovery";

const src = (id: string, categories: string[], trust = 0.8, kind = "rss"): CatalogSource => ({
  id, kind, title: id, url: null, feedUrl: kind === "book" ? null : `https://example.com/${id}`, categories, trust,
});

const catalog = [
  src("travel1", ["travel"], 0.9), src("travel2", ["travel"], 0.8), src("travel3", ["travel"], 0.7), src("travel4", ["travel"], 0.6),
  src("lead1", ["leadership"], 0.9), src("lead2", ["leadership", "careers"], 0.8),
  src("ai1", ["ai"], 0.9), src("ai2", ["ai", "markets"], 0.85),
  src("gossip", ["markets", "celebrity"], 1),
  src("book1", ["travel"], 1, "book"),
];

describe("pickDiscoverySources", () => {
  it("gives more slots to stronger interests and skips books", () => {
    const got = pickDiscoverySources(catalog, [
      { categoryId: "travel", weight: "a_lot" }, { categoryId: "ai", weight: "a_little" },
    ], 4).map((s) => s.id);
    expect(got).toEqual(["travel1", "travel2", "travel3", "ai1"]);
  });

  it("never picks a source from an avoided topic, and skips sources the listener already follows", () => {
    const got = pickDiscoverySources(catalog, [
      { categoryId: "markets", weight: "some" }, { categoryId: "ai", weight: "some" }, { categoryId: "celebrity", weight: "avoid" },
    ], 10, new Set(["ai1"])).map((s) => s.id);
    expect(got).toEqual(["ai2"]);
  });

  it("returns nothing without interests", () => {
    expect(pickDiscoverySources(catalog, [], 5)).toEqual([]);
  });
});

describe("seed catalog", () => {
  it("every discovery source has a reason and at least one proof link", async () => {
    const { createTestDb } = await import("./helpers/db");
    const db = await createTestDb();
    const r = await db.query<{ total: number; ok: number }>(
      `select count(*)::int as total,
              count(*) filter (where why <> '' and jsonb_array_length(evidence) > 0 and evidence->0->>'url' like 'http%')::int as ok
       from sources where is_discovery`,
    );
    expect(r.rows[0]!.total).toBeGreaterThan(50);
    expect(r.rows[0]!.ok).toBe(r.rows[0]!.total);
  });
});
