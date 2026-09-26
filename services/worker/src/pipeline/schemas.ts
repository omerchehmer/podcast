/**
 * Shapes of the LLM answers. Kept simple (no min/max rules) so they work with
 * Claude structured outputs. We check limits in code after parsing.
 */
import { z } from "zod";

export const RankResult = z.object({
  picks: z.array(
    z.object({
      id: z.string().describe("Item id, for example S3"),
      whyItMatters: z.string().describe("One sentence: why this matters to this listener"),
      topicTags: z.array(z.string()).describe("1-3 short topic tags"),
    }),
  ),
});
export type RankResult = z.infer<typeof RankResult>;

export const SectionKind = z.enum(["intro", "idea", "recap", "questions"]);

export const EpisodePlan = z.object({
  title: z.string().describe("Short episode title, max 8 words"),
  summary: z.string().describe("One or two sentences for the episode card"),
  sections: z.array(
    z.object({
      kind: SectionKind,
      title: z.string().describe("Chapter title, max 6 words"),
      mainIdea: z.string().describe("The one idea of this section, in one sentence"),
      whyItMattersToListener: z.string().describe("Concrete link to the listener's role, company or goals"),
      counterView: z.string().describe("The strongest counter-argument, or empty if none is needed"),
      question: z.string().describe("One question for the listener to think about, or empty"),
      sourceIds: z.array(z.string()).describe("Item ids this section uses, for example [\"S1\",\"S4\"]"),
      topicTags: z.array(z.string()),
      weight: z.number().describe("Relative length: 0.5 short, 1 normal, 2 long"),
    }),
  ),
});
export type EpisodePlan = z.infer<typeof EpisodePlan>;

export const Speaker = z.enum(["HOST_A", "HOST_B"]);

export const ScriptLine = z.object({
  speaker: Speaker,
  text: z.string().describe("Spoken text. Add [S#] tags right after facts."),
});
export type ScriptLine = z.infer<typeof ScriptLine>;

export const SectionScript = z.object({
  lines: z.array(ScriptLine),
});
export type SectionScript = z.infer<typeof SectionScript>;

export const CheckResult = z.object({
  sections: z.array(
    z.object({
      index: z.number().describe("Section index as given in the input"),
      ok: z.boolean(),
      problems: z.array(
        z.object({
          type: z.enum(["unsupported_claim", "long_quote", "sensitive_data", "unknown_source", "not_simple", "wrong_basis", "other"]),
          detail: z.string().describe("Short description. Do not repeat sensitive data here."),
        }),
      ),
      fixedLines: z.array(ScriptLine).describe("Full corrected lines when ok is false, otherwise empty"),
    }),
  ),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const TranscriptDigest = z.object({
  notes: z.string().describe("Episode notes, about 800 words. One point per line, with who said it."),
});
export type TranscriptDigest = z.infer<typeof TranscriptDigest>;

export const LearnSummary = z.object({
  plannerSummary: z.string(),
  changeNote: z.string(),
});
export type LearnSummary = z.infer<typeof LearnSummary>;
