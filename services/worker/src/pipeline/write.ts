/**
 * Step 4 — Write: one LLM call per section (in parallel), then fix the length if needed.
 */
import { LIMITS, VOICES, type ListenerInput } from "@briefcast/shared";
import { wordCount } from "../lib/text";
import { withinTolerance } from "../lib/length";
import type { CostTracker } from "../lib/cost";
import type { LlmClient } from "../providers/llm";
import { ADJUST_SYSTEM, WRITE_SYSTEM } from "../prompts";
import { itemForLlm, type CollectedItem } from "./collect";
import type { Plan, PlannedSection } from "./plan";
import { SectionScript, type ScriptLine } from "./schemas";

export interface WrittenSection {
  section: PlannedSection;
  lines: ScriptLine[];
}

export function sectionWords(lines: ScriptLine[]): number {
  return lines.reduce((a, l) => a + wordCount(l.text.replace(/\[S\d+(?:\s*,\s*S\d+)*\]/g, "")), 0);
}

function hostNames(listener: ListenerInput) {
  const name = (id: string) => VOICES.find((v) => v.id === id)?.name ?? id;
  return listener.settings.format === "conversation"
    ? { HOST_A: name(listener.settings.voiceA), HOST_B: name(listener.settings.voiceB) }
    : { HOST_A: name(listener.settings.voiceA) };
}

function itemsFor(section: PlannedSection, items: CollectedItem[]) {
  const ids = new Set(section.sourceIds);
  // intro and recap may refer to anything in the episode, but only need short summaries
  const wide = section.kind !== "idea";
  return items
    .filter((i) => wide || ids.has(i.id))
    .map((i) => itemForLlm(i, wide ? "summary" : "excerpt"));
}

/** Solo episodes have one voice: force every line to HOST_A. */
function normalizeSpeakers(lines: ScriptLine[], listener: ListenerInput): ScriptLine[] {
  if (listener.settings.format === "solo") return lines.map((l) => ({ ...l, speaker: "HOST_A" }));
  return lines;
}

export async function writeScript(
  p: Plan,
  items: CollectedItem[],
  listener: ListenerInput,
  llm: LlmClient,
  cost: CostTracker,
): Promise<WrittenSection[]> {
  const outline = p.sections.map((s) => ({ index: s.index, kind: s.kind, title: s.title, mainIdea: s.mainIdea }));
  const common = {
    format: listener.settings.format,
    tone: listener.settings.tone,
    language: listener.settings.language,
    hosts: hostNames(listener),
    listenerFirstName: listener.displayName,
    listenerProfile: listener.context || "(no profile given)",
    changeNote: listener.preferences.lastChangeNote || null,
    episodeTitle: p.title,
    outline,
  };

  const written = await Promise.all(
    p.sections.map(async (section) => {
      const out = await llm.json(
        "write",
        {
          system: WRITE_SYSTEM,
          task: `Write section ${section.index} ("${section.title}"). Target: ${section.targetWords} spoken words.`,
          data: { ...common, section, items: itemsFor(section, items) },
          schema: SectionScript,
          maxTokens: 8000,
        },
        cost,
      );
      return { section, lines: normalizeSpeakers(out.lines, listener) };
    }),
  );

  return fixLength(written, items, listener, llm, cost);
}

/**
 * If the whole script is outside ±10% of the target, rewrite the sections that are furthest off.
 * At most two rounds, so cost stays under control.
 */
export async function fixLength(
  sections: WrittenSection[],
  items: CollectedItem[],
  listener: ListenerInput,
  llm: LlmClient,
  cost: CostTracker,
  rounds = 2,
): Promise<WrittenSection[]> {
  let current = sections;
  const target = current.reduce((a, s) => a + s.section.targetWords, 0);
  for (let round = 0; round < rounds; round++) {
    const total = current.reduce((a, s) => a + sectionWords(s.lines), 0);
    if (withinTolerance(total, target, LIMITS.lengthTolerance * 0.8)) break; // aim a bit inside the limit

    // sections more than 15% off their own target
    const off = current.filter((s) => !withinTolerance(sectionWords(s.lines), s.section.targetWords, 0.15));
    if (off.length === 0) break;
    const fixed = await Promise.all(
      off.map(async (s) => {
        const out = await llm.json(
          "write",
          {
            system: ADJUST_SYSTEM,
            task: `This section has ${sectionWords(s.lines)} words. Rewrite it to ${s.section.targetWords} words.`,
            data: { format: listener.settings.format, lines: s.lines, items: itemsFor(s.section, items) },
            schema: SectionScript,
            maxTokens: 8000,
          },
          cost,
        );
        return { section: s.section, lines: normalizeSpeakers(out.lines, listener) };
      }),
    );
    const byIndex = new Map(fixed.map((f) => [f.section.index, f]));
    current = current.map((s) => byIndex.get(s.section.index) ?? s);
  }
  return current;
}
