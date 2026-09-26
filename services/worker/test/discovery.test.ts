import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./helpers/db";

// Building the test database takes a few seconds, so it happens in beforeAll (like the other DB tests).
let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
});

describe("seed catalog", () => {
  it("every discovery source has a reason and at least one proof link", async () => {
    const r = await db.query<{ total: number; ok: number }>(
      `select count(*)::int as total,
              count(*) filter (where why <> '' and jsonb_array_length(evidence) > 0 and evidence->0->>'url' like 'http%')::int as ok
       from sources where is_discovery`,
    );
    expect(r.rows[0]!.total).toBeGreaterThan(50);
    expect(r.rows[0]!.ok).toBe(r.rows[0]!.total);
  });
});
