/**
 * Picks sources from our curated catalog that match a listener's interests.
 * Used when a listener follows few feeds of their own, so every episode still has good material.
 */

export interface CatalogSource {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  feedUrl: string | null;
  categories: string[];
  /** Our quality score for the source, 0–1. */
  trust: number;
}

export interface InterestPick {
  categoryId: string | null;
  weight: "a_lot" | "some" | "a_little" | "avoid";
}

const WEIGHT_SCORE = { a_lot: 3, some: 2, a_little: 1, avoid: 0 } as const;

/**
 * Feeds only (no books). Sources in an avoided category are never picked.
 * Balanced across interests: in each round, an "a lot" topic takes 3 sources, "some" 2, "a little" 1,
 * each topic taking its best sources (by our trust score) first.
 */
export function pickDiscoverySources(catalog: CatalogSource[], interests: InterestPick[], max: number, skipIds: Set<string> = new Set()): CatalogSource[] {
  const weight = new Map<string, number>();
  const avoided = new Set<string>();
  for (const i of interests) {
    if (!i.categoryId) continue;
    if (i.weight === "avoid") avoided.add(i.categoryId);
    else weight.set(i.categoryId, Math.max(weight.get(i.categoryId) ?? 0, WEIGHT_SCORE[i.weight]));
  }
  const usable = catalog.filter((s) => s.feedUrl && s.kind !== "book" && !skipIds.has(s.id) && !s.categories.some((c) => avoided.has(c)));
  // One queue per interest: sources whose main category is that interest, best first.
  const topics = [...weight.entries()].sort((a, b) => b[1] - a[1]);
  const queues = topics.map(([cat]) => usable.filter((s) => s.categories[0] === cat).sort((a, b) => b.trust - a.trust));

  const picked: CatalogSource[] = [];
  const seen = new Set<string>();
  while (picked.length < max && queues.some((q) => q.length)) {
    topics.forEach(([, w], t) => {
      for (let n = 0; n < w && picked.length < max; n++) {
        const next = queues[t]!.shift();
        if (next && !seen.has(next.id)) { seen.add(next.id); picked.push(next); }
      }
    });
  }
  return picked;
}
