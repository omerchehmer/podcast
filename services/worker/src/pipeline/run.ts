/**
 * The full episode pipeline: collect → rank → plan → write → check → voice.
 * Publishing (storage, database, push) is done by the caller, so the same code runs in the CLI
 * and in the queue worker.
 */
import { LIMITS, VOICES, ListenerInput } from "@briefcast/shared";
import { CostTracker, type CostEntry } from "../lib/cost";
import { targetWords, withinTolerance } from "../lib/length";
import { sourceTagsIn } from "../lib/text";
import { log } from "../lib/log";
import type { LlmClient } from "../providers/llm";
import type { TtsClient } from "../providers/tts";
import { collect, type CollectedItem } from "./collect";
import { rank } from "./rank";
import { addTranscripts } from "./transcript";
import { plan, type Plan } from "./plan";
import { writeScript, sectionWords, type WrittenSection } from "./write";
import { check, type CheckIssue } from "./check";
import { voice, type Chapter, type TranscriptLine } from "./voice";

export type Step = "collecting" | "ranking" | "planning" | "writing" | "checking" | "voicing";

export interface RunDeps {
  llm: LlmClient;
  tts: TtsClient;
  now?: Date;
  /** Items to use instead of fetching feeds (tests, or items already in the database). */
  items?: CollectedItem[];
  onStep?: (step: Step) => void | Promise<void>;
}

export interface EpisodeSource {
  id: string;
  source: string;
  title: string;
  url?: string;
  /** Chapter indexes where this source is used. */
  usedIn: number[];
  /** Kept so the worker can save the item to the database. */
  item: CollectedItem;
}

export interface EpisodeResult {
  title: string;
  summary: string;
  changeNote: string;
  episodeType: "mix" | "deep_dive";
  targetSeconds: number;
  durationSec: number;
  durationMeasured: boolean;
  withinTarget: boolean;
  wordCount: number;
  targetWords: number;
  plan: Plan;
  sections: WrittenSection[];
  chapters: Chapter[];
  transcript: TranscriptLine[];
  sources: EpisodeSource[];
  issues: CheckIssue[];
  cost: { totalUsd: number; byStep: Record<string, number>; entries: CostEntry[] };
  audio: Buffer | null;
}

export class NotEnoughContentError extends Error {}

export async function runEpisode(input: ListenerInput, deps: RunDeps): Promise<EpisodeResult> {
  const listener = ListenerInput.parse(input);
  const now = deps.now ?? new Date();
  const cost = new CostTracker();
  const step = async (s: Step) => {
    log.info("step", { step: s, userId: listener.userId });
    await deps.onStep?.(s);
  };

  const s = listener.settings;
  const targetSeconds = s.lengthMinutes * 60 + listener.preferences.lengthBiasSeconds;
  const wpm = VOICES.find((v) => v.id === s.voiceA)?.wordsPerMinute ?? LIMITS.defaultWordsPerMinute;
  // The intro sound and gaps take a few seconds, so the words get slightly less time.
  const words = targetWords(Math.max(60, targetSeconds - 8), wpm);

  await step("collecting");
  const lookback = s.frequency === "custom" && s.customDays.length <= 2 ? LIMITS.lookbackDaysWeekly : LIMITS.lookbackDaysDaily;
  const collected = deps.items ?? (await collect(listener.sources, { now, lookbackDays: lookback }));

  await step("ranking");
  const ranked = await rank(collected, listener, deps.llm, cost, now);
  if (ranked.items.length === 0) throw new NotEnoughContentError("No usable items from the sources");

  await step("planning");
  const outline = await plan(ranked, listener, words, deps.llm, cost);

  await step("writing");
  // Only now read podcast transcripts: only for the items the plan really uses.
  const usedIds = new Set(outline.sections.flatMap((x) => x.sourceIds));
  const items = await addTranscripts(ranked.items, usedIds, { llm: deps.llm, cost });
  const written = await writeScript(outline, items, listener, deps.llm, cost);

  await step("checking");
  const checked = await check(written, items, listener.context, deps.llm, cost);

  await step("voicing");
  const audio = await voice(checked.sections, listener, deps.tts, cost);

  const wordTotal = checked.sections.reduce((a, x) => a + sectionWords(x.lines), 0);
  const withinTarget = audio.measured
    ? withinTolerance(audio.durationSec, targetSeconds)
    : withinTolerance(wordTotal, words);

  return {
    title: outline.title,
    summary: outline.summary,
    changeNote: listener.preferences.lastChangeNote,
    episodeType: listener.deepDiveRequest ? "deep_dive" : s.episodeType,
    targetSeconds,
    durationSec: audio.durationSec,
    durationMeasured: audio.measured,
    withinTarget,
    wordCount: wordTotal,
    targetWords: words,
    plan: outline,
    sections: checked.sections,
    chapters: audio.chapters,
    transcript: audio.transcript,
    sources: usedSources(checked.sections, items),
    issues: checked.issues,
    cost: { totalUsd: round4(cost.totalUsd), byStep: cost.byStep(), entries: cost.entries },
    audio: audio.audio,
  };
}

/** Only sources that are actually tagged in the final script, for the "Sources" screen. */
export function usedSources(sections: WrittenSection[], items: CollectedItem[]): EpisodeSource[] {
  const used = new Map<string, Set<number>>();
  for (const sec of sections) {
    for (const id of sourceTagsIn(sec.lines.map((l) => l.text).join(" "))) {
      if (!used.has(id)) used.set(id, new Set());
      used.get(id)!.add(sec.section.index);
    }
  }
  return items
    .filter((i) => used.has(i.id))
    .map((i) => ({
      id: i.id, source: i.sourceTitle, title: i.title, url: i.url,
      usedIn: [...used.get(i.id)!].sort((a, b) => a - b), item: i,
    }));
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
