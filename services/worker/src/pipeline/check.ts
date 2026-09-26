/**
 * Step 5 — Check: rule checks in code, then an LLM checks facts against the sources.
 */
import { LIMITS } from "@briefcast/shared";
import { longQuotes, sourceTagsIn } from "../lib/text";
import { scrubSensitive } from "../lib/scrub";
import type { CostTracker } from "../lib/cost";
import type { LlmClient } from "../providers/llm";
import { CHECK_SYSTEM } from "../prompts";
import { itemForLlm, type CollectedItem } from "./collect";
import { CheckResult } from "./schemas";
import type { WrittenSection } from "./write";

export interface CheckIssue {
  sectionIndex: number;
  type: string;
  detail: string;
  fixed: boolean;
}

/** Problems we can find without an LLM. */
export function ruleCheck(sections: WrittenSection[], items: CollectedItem[]): CheckIssue[] {
  const known = new Set(items.map((i) => i.id));
  const issues: CheckIssue[] = [];
  for (const s of sections) {
    const text = s.lines.map((l) => l.text).join("\n");
    for (const id of sourceTagsIn(text)) {
      if (!known.has(id)) issues.push({ sectionIndex: s.section.index, type: "unknown_source", detail: `Tag ${id} is not a known item`, fixed: false });
    }
    for (const q of longQuotes(text, LIMITS.maxQuoteWords)) {
      issues.push({ sectionIndex: s.section.index, type: "long_quote", detail: `Quote of ${q.split(/\s+/).length} words`, fixed: false });
    }
    if (scrubSensitive(text).removed.length > 0) {
      issues.push({ sectionIndex: s.section.index, type: "sensitive_data", detail: "Contact or ID data in script", fixed: false });
    }
  }
  return issues;
}

export async function check(
  sections: WrittenSection[],
  items: CollectedItem[],
  listenerProfile: string,
  llm: LlmClient,
  cost: CostTracker,
): Promise<{ sections: WrittenSection[]; issues: CheckIssue[] }> {
  const ruleIssues = ruleCheck(sections, items);
  const result = await llm.json(
    "check",
    {
      system: CHECK_SYSTEM,
      task: "Check every section. Return one result per section, in the same order.",
      data: {
        listenerProfile: listenerProfile || "(none)",
        ruleFindings: ruleIssues.map(({ sectionIndex, type, detail }) => ({ sectionIndex, type, detail })),
        sections: sections.map((s) => ({
          index: s.section.index,
          lines: s.lines,
          items: items
            .filter((i) => s.section.kind !== "idea" || s.section.sourceIds.includes(i.id))
            .map((i) => itemForLlm(i, "excerpt")),
        })),
      },
      schema: CheckResult,
      maxTokens: 16000,
    },
    cost,
  );

  const byIndex = new Map(result.sections.map((r) => [r.index, r]));
  const issues: CheckIssue[] = [];
  const out = sections.map((s) => {
    const r = byIndex.get(s.section.index);
    const useFix = !!r && !r.ok && r.fixedLines.length > 0;
    for (const p of r?.problems ?? []) issues.push({ sectionIndex: s.section.index, type: p.type, detail: p.detail, fixed: useFix });
    return useFix ? { section: s.section, lines: r!.fixedLines } : s;
  });

  // Last safety net: anything the rules still find after the fix is removed by code.
  for (const s of out) {
    s.lines = s.lines.map((l) => ({ ...l, text: scrubSensitive(l.text).text.replace(/\[removed\]/g, "") }));
    const known = new Set(items.map((i) => i.id));
    s.lines = s.lines.map((l) => ({
      ...l,
      text: l.text.replace(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g, (m, ids: string) => {
        const valid = ids.split(",").map((x) => x.trim()).filter((x) => known.has(x));
        return valid.length ? `[${valid.join(", ")}]` : "";
      }),
    }));
  }
  for (const ri of ruleIssues) issues.push({ ...ri, fixed: true });
  return { sections: out, issues };
}
