/**
 * Step 3 — Plan: an LLM makes the outline, then code sets exact word budgets per section.
 */
import type { ListenerInput } from "@briefcast/shared";
import { ideasForMix, splitBudget } from "../lib/length";
import type { CostTracker } from "../lib/cost";
import type { LlmClient } from "../providers/llm";
import { PLAN_SYSTEM } from "../prompts";
import { listenerBrief, type RankOutput } from "./rank";
import { EpisodePlan } from "./schemas";

export type PlannedSection = EpisodePlan["sections"][number] & { index: number; targetWords: number };
export interface Plan {
  title: string;
  summary: string;
  sections: PlannedSection[];
}

export class PlanError extends Error {}

export async function plan(
  ranked: RankOutput,
  listener: ListenerInput,
  totalWords: number,
  llm: LlmClient,
  cost: CostTracker,
): Promise<Plan> {
  const s = listener.settings;
  const type = listener.deepDiveRequest ? "deep_dive" : s.episodeType;
  const ideas = type === "mix" ? Math.min(ideasForMix(s.lengthMinutes), Math.max(1, ranked.items.length)) : 1;

  const result = await llm.json(
    "plan",
    {
      system: PLAN_SYSTEM,
      task:
        type === "mix"
          ? `Plan a "mix" episode with exactly ${ideas} idea sections. Total length about ${totalWords} spoken words.`
          : `Plan a "deep_dive" episode. Total length about ${totalWords} spoken words.`,
      data: {
        episodeType: type,
        format: s.format,
        tone: s.tone,
        language: s.language,
        lengthMinutes: s.lengthMinutes,
        changeNote: listener.preferences.lastChangeNote || null,
        listener: listenerBrief(listener),
        items: ranked.items.map((i) => ({
          id: i.id, source: i.sourceTitle, title: i.title, summary: i.summary, whyItMatters: i.whyItMatters, topicTags: i.topicTags,
        })),
      },
      schema: EpisodePlan,
      maxTokens: 8000,
    },
    cost,
  );

  return finalizePlan(result, ranked, totalWords);
}

/** Validate the outline and give each section its word budget. Exported for tests. */
export function finalizePlan(result: EpisodePlan, ranked: RankOutput, totalWords: number): Plan {
  const known = new Set(ranked.items.map((i) => i.id));
  const sections = result.sections.map((sec) => ({ ...sec, sourceIds: sec.sourceIds.filter((id) => known.has(id)) }));
  if (!sections.some((x) => x.kind === "idea")) throw new PlanError("Plan has no idea sections");
  const orphan = sections.find((x) => x.kind === "idea" && x.sourceIds.length === 0);
  if (orphan) throw new PlanError(`Idea section "${orphan.title}" has no valid sources`);

  const weights = sections.map((x) => Math.min(3, Math.max(0.3, x.weight || 1)));
  const budgets = splitBudget(totalWords, weights);
  return {
    title: result.title,
    summary: result.summary,
    sections: sections.map((x, index) => ({ ...x, index, targetWords: budgets[index]! })),
  };
}
