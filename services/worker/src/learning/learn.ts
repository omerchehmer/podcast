/**
 * The learning loop. After feedback, we change a few simple numbers (rules, easy to explain),
 * then a cheap LLM rewrites the short summary the planner reads and the one-line change note.
 *
 * Small steps with limits, so one bad day does not ruin the profile.
 */
import type { PreferenceState, QuickTag } from "@briefcast/shared";
import { keywords } from "../lib/text";
import type { CostTracker } from "../lib/cost";
import type { LlmClient } from "../providers/llm";
import { LEARN_SYSTEM } from "../prompts";
import { LearnSummary } from "../pipeline/schemas";

export interface SegmentFeedback {
  title: string;
  topicTags: string[];
  thumb: -1 | 1 | null;
  goDeeper: boolean;
  /** Database ids of the sources used in this segment. */
  sourceIds: string[];
}

export interface FeedbackInput {
  episodeTitle: string;
  stars: number | null;
  quickTags: string[];
  note: string | null;
  segments: SegmentFeedback[];
}

export interface InterestRow { id: string; label: string; learnedWeight: number }
export interface UserSourceRow { sourceId: string; trust: number }

export interface Updates {
  preferences: PreferenceState;
  interests: InterestRow[];
  sources: UserSourceRow[];
  /** Short plain notes on what changed, for the LLM that writes the change note. */
  signals: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

const TAG_RULES: Record<QuickTag, (p: PreferenceState) => [PreferenceState, string]> = {
  too_long: (p) => [{ ...p, lengthBiasSeconds: clamp(p.lengthBiasSeconds - 30, -180, 180) }, "a bit shorter"],
  too_short: (p) => [{ ...p, lengthBiasSeconds: clamp(p.lengthBiasSeconds + 30, -180, 180) }, "a bit longer"],
  too_basic: (p) => [{ ...p, depth: round2(clamp(p.depth + 0.2, -1, 1)) }, "more depth"],
  too_technical: (p) => [{ ...p, depth: round2(clamp(p.depth - 0.2, -1, 1)) }, "simpler explanations"],
  too_much_news: (p) => [{ ...p, newsVsIdeas: round2(clamp(p.newsVsIdeas + 0.2, -1, 1)) }, "fewer news updates, more ideas"],
  not_about_my_work: (p) => [{ ...p, workRelevance: round2(clamp(p.workRelevance + 0.15, 0, 1)) }, "more about your work"],
};

export function computeUpdates(
  preferences: PreferenceState,
  interests: InterestRow[],
  sources: UserSourceRow[],
  feedback: FeedbackInput[],
): Updates {
  let prefs = { ...preferences };
  const ints = interests.map((i) => ({ ...i }));
  const srcs = new Map(sources.map((s) => [s.sourceId, { ...s }]));
  const signals: string[] = [];

  for (const fb of feedback) {
    for (const tag of fb.quickTags) {
      const rule = TAG_RULES[tag as QuickTag];
      if (!rule) continue;
      const [next, signal] = rule(prefs);
      prefs = next;
      signals.push(signal);
    }
    for (const seg of fb.segments) {
      if (seg.thumb === null && !seg.goDeeper) continue;
      // "Go deeper" counts as a strong thumbs up.
      const delta = seg.goDeeper ? 1.5 : seg.thumb!;
      const segKw = keywords(`${seg.title} ${seg.topicTags.join(" ")}`);
      for (const i of ints) {
        if ([...keywords(i.label)].some((w) => segKw.has(w))) {
          i.learnedWeight = round2(clamp(i.learnedWeight + 0.1 * delta, 0.3, 2));
          signals.push(delta > 0 ? `more about ${i.label}` : `less about ${i.label}`);
        }
      }
      for (const id of seg.sourceIds) {
        const s = srcs.get(id);
        if (s) s.trust = round2(clamp(s.trust + 0.05 * delta, 0.2, 1));
      }
    }
  }
  return { preferences: prefs, interests: ints, sources: [...srcs.values()], signals: [...new Set(signals)] };
}

/** Ask the LLM for the planner summary and the change note. */
export async function summarize(
  previousSummary: string,
  recentFeedback: FeedbackInput[],
  signals: string[],
  llm: LlmClient,
  cost: CostTracker,
): Promise<LearnSummary> {
  const out = await llm.json(
    "learn",
    {
      system: LEARN_SYSTEM,
      task: "Update the planner summary and write the change note.",
      data: {
        previousSummary: previousSummary || "(none)",
        changesFromRules: signals,
        recentFeedback: recentFeedback.slice(-10).map((f) => ({
          episode: f.episodeTitle,
          stars: f.stars,
          quickTags: f.quickTags,
          note: f.note,
          liked: f.segments.filter((s) => s.thumb === 1).map((s) => s.title),
          disliked: f.segments.filter((s) => s.thumb === -1).map((s) => s.title),
          wantsDeeper: f.segments.filter((s) => s.goDeeper).map((s) => s.title),
        })),
      },
      schema: LearnSummary,
      maxTokens: 1500,
    },
    cost,
  );
  return { plannerSummary: out.plannerSummary.slice(0, 1200), changeNote: out.changeNote.slice(0, 140) };
}
