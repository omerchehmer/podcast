/**
 * Step 2 — Rank: remove duplicates, score items with simple rules, then let a cheap LLM pick the best.
 */
import { LIMITS, WEIGHT_VALUE, type ListenerInput } from "@briefcast/shared";
import { keywords } from "../lib/text";
import type { CostTracker } from "../lib/cost";
import type { LlmClient } from "../providers/llm";
import { RANK_SYSTEM } from "../prompts";
import { RankResult } from "./schemas";
import type { CollectedItem } from "./collect";

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Same URL, same hash, or very similar titles → keep only the one from the most trusted source. */
export function dedupe(items: CollectedItem[]): CollectedItem[] {
  const sorted = [...items].sort((a, b) => b.trust - a.trust);
  const kept: { item: CollectedItem; kw: Set<string> }[] = [];
  for (const item of sorted) {
    const kw = keywords(item.title);
    const dup = kept.some(
      (k) => k.item.hash === item.hash || (item.url && k.item.url === item.url) || jaccard(k.kw, kw) >= 0.7,
    );
    if (!dup) kept.push({ item, kw });
  }
  return kept.map((k) => k.item);
}

export interface ScoredItem {
  item: CollectedItem;
  score: number;
}

/**
 * Rule-based score = topic match × source trust × freshness.
 * Items that match an "avoid" topic are removed. Recently covered topics get a lower score.
 */
export function scoreItems(items: CollectedItem[], listener: ListenerInput, now: Date): ScoredItem[] {
  const interests = listener.interests.map((i) => ({ kw: keywords(i.label), weight: WEIGHT_VALUE[i.weight] * i.learnedWeight, avoid: i.weight === "avoid" }));
  const cutoff = now.getTime() - LIMITS.noRepeatDays * 24 * 3600 * 1000;
  const recent = new Set(
    listener.recentTopics.filter((t) => new Date(t.date).getTime() >= cutoff).flatMap((t) => [...keywords(t.tag)]),
  );
  const deepDiveKw = listener.deepDiveRequest ? keywords(`${listener.deepDiveRequest.title} ${listener.deepDiveRequest.mainIdea}`) : null;

  const out: ScoredItem[] = [];
  for (const item of items) {
    const kw = keywords(`${item.title} ${item.summary}`);
    if (interests.some((i) => i.avoid && [...i.kw].some((w) => kw.has(w)))) continue;

    let match = 0.15; // small base, so trusted sources still count when no keyword matches
    for (const i of interests) {
      if (i.avoid) continue;
      const hits = [...i.kw].filter((w) => kw.has(w)).length;
      if (hits > 0) match += i.weight * (hits / i.kw.size);
    }
    if (deepDiveKw) match += 2 * jaccard(deepDiveKw, kw) + (listener.deepDiveRequest!.sourceUrls.includes(item.url ?? "") ? 3 : 0);

    const ageDays = item.publishedAt ? (now.getTime() - new Date(item.publishedAt).getTime()) / 86_400_000 : 3;
    const freshness = 1 / (1 + Math.max(0, ageDays) / 3);
    const repeatPenalty = !deepDiveKw && [...kw].some((w) => recent.has(w)) ? 0.5 : 1;
    // headline-only items are weaker; a podcast with a transcript has substance even if its show notes are short
    const substance = !item.transcript && item.excerpt.split(/\s+/).length < 25 ? 0.7 : 1;

    out.push({ item, score: match * (0.5 + item.trust) * freshness * repeatPenalty * substance });
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface RankOutput {
  items: (CollectedItem & { whyItMatters: string; topicTags: string[] })[];
}

export async function rank(
  collected: CollectedItem[],
  listener: ListenerInput,
  llm: LlmClient,
  cost: CostTracker,
  now: Date,
): Promise<RankOutput> {
  const candidates = scoreItems(dedupe(collected), listener, now).slice(0, 40).map((s, i) => ({ ...s.item, id: `S${i + 1}` }));
  if (candidates.length === 0) return { items: [] };

  const result = await llm.json(
    "rank",
    {
      system: RANK_SYSTEM,
      task: `Pick up to ${LIMITS.maxItemsForPlanner} items for today's episode.`,
      data: {
        listener: listenerBrief(listener),
        candidates: candidates.map((c) => ({ id: c.id, source: c.sourceTitle, title: c.title, summary: c.summary, published: c.publishedAt })),
      },
      schema: RankResult,
      maxTokens: 4000,
    },
    cost,
  );

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const picked = result.picks
    .filter((p) => byId.has(p.id))
    .slice(0, LIMITS.maxItemsForPlanner)
    .map((p, i) => ({ ...byId.get(p.id)!, id: `S${i + 1}`, whyItMatters: p.whyItMatters, topicTags: p.topicTags.slice(0, 3) }));
  return { items: picked };
}

/** The part of the listener input the LLM steps see. */
export function listenerBrief(l: ListenerInput) {
  return {
    firstName: l.displayName,
    profile: l.context || "(no profile given)",
    interests: l.interests.filter((i) => i.weight !== "avoid").map((i) => ({ topic: i.label, weight: i.weight })),
    avoidTopics: l.interests.filter((i) => i.weight === "avoid").map((i) => i.label),
    books: l.books,
    recentTopics: l.recentTopics.map((t) => t.tag),
    feedbackSummary: l.preferences.plannerSummary || "(no feedback yet)",
    depth: l.preferences.depth,
    newsVsIdeas: l.preferences.newsVsIdeas,
    workRelevance: l.preferences.workRelevance,
    deepDiveRequest: l.deepDiveRequest ?? null,
  };
}
