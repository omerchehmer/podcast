/** Suggested sources on the Sources screen: grouped by kind, best matches for the user's interests first. */
import type { Category, Interest, SourceOption } from "./api/types";

export const SUGGESTION_GROUPS: { title: string; kinds: SourceOption["kind"][] }[] = [
  { title: "Podcasts", kinds: ["podcast"] },
  { title: "Websites and newsletters", kinds: ["rss", "website", "newsletter_email", "youtube"] },
  { title: "Books", kinds: ["book"] },
];

const WEIGHT_SCORE: Record<string, number> = { a_lot: 3, some: 2, a_little: 1 };

/**
 * Score each suggestion by the user's topic interests: "a lot" counts more than "a little".
 * Suggestions that touch an avoided topic get -1 and are never shown. Best matches first.
 */
export function rankSuggestions(list: SourceOption[], interests: Interest[], cats: Category[]) {
  const weight = new Map(interests.filter((i) => i.categoryId).map((i) => [i.categoryId!, i.weight] as const));
  const names = new Map(cats.map((c) => [c.id, c.name] as const));
  return list
    .map((d) => {
      const avoided = d.categories.some((c) => weight.get(c) === "avoid");
      const score = avoided ? -1 : d.categories.reduce((sum, c) => sum + (WEIGHT_SCORE[weight.get(c) ?? ""] ?? 0), 0);
      return { ...d, score, topics: d.categories.map((c) => names.get(c) ?? c) };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
