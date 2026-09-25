/**
 * Writes the discovery catalog (sources.json) into seed.sql, between the CATALOG markers.
 * Run after editing sources.json:  node supabase/catalog/build-seed.mjs
 * Safe to run the SQL again on a live database: it updates existing rows and turns off
 * catalog sources that are no longer in the list (listeners who follow them keep them).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "sources.json"), "utf8"));
const seedPath = join(here, "../seed.sql");

const CATEGORIES = new Set(["ai", "leadership", "strategy", "markets", "product", "startups", "travel", "geopolitics", "science", "health", "careers", "climate"]);
const q = (v) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `'{${a.join(",")}}'`;

const titles = new Set();
for (const s of catalog) {
  if (!["rss", "podcast", "book"].includes(s.kind)) throw new Error(`bad kind: ${s.title}`);
  if (s.kind !== "book" && !/^https?:\/\//.test(s.feed_url ?? "")) throw new Error(`feed needs a feed_url: ${s.title}`);
  if (!s.categories.length || s.categories.some((c) => !CATEGORIES.has(c))) throw new Error(`bad categories: ${s.title}`);
  if (!s.why || !s.evidence?.length) throw new Error(`needs why and evidence: ${s.title}`);
  if (titles.has(s.title)) throw new Error(`duplicate: ${s.title}`);
  titles.add(s.title);
}

const lines = [
  "-- Generated from supabase/catalog/sources.json by build-seed.mjs. Edit the JSON, not this block.",
  "update sources set is_discovery = false where is_discovery and owner_user_id is null;",
];
for (const s of catalog) {
  const vals = `${q(s.title)}, ${q(s.url)}, true, ${arr(s.categories)}, ${q(s.why)}, ${q(JSON.stringify(s.evidence))}::jsonb, ${s.trust}`;
  if (s.kind === "book") {
    lines.push(
      `update sources set is_discovery = true, url = ${q(s.url)}, discovery_categories = ${arr(s.categories)}, why = ${q(s.why)}, ` +
        `evidence = ${q(JSON.stringify(s.evidence))}::jsonb, discovery_trust = ${s.trust} where kind = 'book' and owner_user_id is null and title = ${q(s.title)};`,
      `insert into sources (kind, title, url, is_discovery, discovery_categories, why, evidence, discovery_trust) select 'book', ${vals} ` +
        `where not exists (select 1 from sources where kind = 'book' and owner_user_id is null and title = ${q(s.title)});`,
    );
  } else {
    lines.push(
      `insert into sources (kind, feed_url, title, url, is_discovery, discovery_categories, why, evidence, discovery_trust) values ` +
        `('${s.kind}', ${q(s.feed_url)}, ${vals}) on conflict (feed_url) where feed_url is not null and owner_user_id is null do update set ` +
        `kind = excluded.kind, title = excluded.title, url = excluded.url, is_discovery = true, discovery_categories = excluded.discovery_categories, ` +
        `why = excluded.why, evidence = excluded.evidence, discovery_trust = excluded.discovery_trust;`,
    );
  }
}

const START = "-- CATALOG START";
const END = "-- CATALOG END";
const seed = readFileSync(seedPath, "utf8");
const a = seed.indexOf(START), b = seed.indexOf(END);
if (a < 0 || b < 0) throw new Error("CATALOG markers not found in seed.sql");
writeFileSync(seedPath, seed.slice(0, a + START.length) + "\n" + lines.join("\n") + "\n" + seed.slice(b));
console.log(`catalog: ${catalog.length} sources written to seed.sql`);
