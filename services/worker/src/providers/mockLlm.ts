/**
 * Offline stand-in for Claude. Produces valid, predictable output for every step, so we can
 * test the whole pipeline (and the length control) without an API key or network.
 * The text is placeholder text — it is not meant to sound good.
 */
import type { z } from "zod";
import type { PipelineStep } from "@briefcast/shared";
import type { CostTracker } from "../lib/cost";
import type { LlmClient, LlmRequest } from "./llm";
import { renderUserMessage } from "./llm";

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function linesOfWords(target: number, opener: string, format: string, tag?: string) {
  const filler = "This is placeholder text so the test can check length, chapters and sources.".split(" ");
  const words = `${opener}${tag ? ` [${tag}]` : ""}.`.split(" ");
  // tags are not counted as words
  let count = words.filter((w) => !/^\[S\d+\]\.?$/.test(w)).length;
  const lines: { speaker: "HOST_A" | "HOST_B"; text: string }[] = [{ speaker: "HOST_A", text: words.join(" ") }];
  let buf: string[] = [];
  let speaker: "HOST_A" | "HOST_B" = format === "conversation" ? "HOST_B" : "HOST_A";
  while (count < target) {
    buf.push(filler[buf.length % filler.length]!);
    count++;
    if (buf.length >= 30 || count >= target) {
      lines.push({ speaker, text: buf.join(" ") });
      buf = [];
      if (format === "conversation") speaker = speaker === "HOST_A" ? "HOST_B" : "HOST_A";
    }
  }
  return lines;
}

export class MockLlm implements LlmClient {
  /** Every call is recorded, so tests can look at what the pipeline sent. */
  readonly calls: { step: PipelineStep; task: string; data: unknown; userMessage: string }[] = [];

  async json<S extends z.ZodType>(step: PipelineStep, req: LlmRequest<S>, cost: CostTracker): Promise<z.infer<S>> {
    const userMessage = renderUserMessage(req.task, req.data);
    this.calls.push({ step, task: req.task, data: req.data, userMessage });
    const inputTokens = Math.ceil((req.system.length + userMessage.length) / 4);
    const out = this.answer(step, req);
    cost.addLlm(step, step === "plan" || step === "write" ? "claude-sonnet-5" : "claude-haiku-4-5", {
      input_tokens: inputTokens,
      output_tokens: Math.ceil(JSON.stringify(out).length / 4),
    });
    return req.schema.parse(out) as z.infer<S>;
  }

  private answer(step: PipelineStep, req: LlmRequest<z.ZodType>): unknown {
    const d = req.data as Any;
    const target = Number(/(\d+) (spoken )?words/.exec(req.task.split("Rewrite it to").pop()!)?.[1] ?? 100);
    switch (step) {
      case "rank":
        return {
          picks: d.candidates.slice(0, 15).map((c: Any) => ({
            id: c.id, whyItMatters: `Useful for your work: ${c.title}`, topicTags: [String(c.title).split(" ")[0]!.toLowerCase()],
          })),
        };
      case "plan": {
        const items: Any[] = d.items;
        const sec = (kind: string, title: string, ids: string[], weight: number) => ({
          kind, title, mainIdea: `Main idea: ${title}`, whyItMattersToListener: "It links to your goals.",
          counterView: kind === "idea" ? "Some experts disagree." : "", question: kind === "intro" ? "" : "What would you do?",
          sourceIds: ids, topicTags: [title.toLowerCase()], weight,
        });
        if (d.episodeType === "deep_dive") {
          const ids = items.slice(0, 3).map((i) => i.id);
          return {
            title: "Deep dive: one idea", summary: "One idea in depth.",
            sections: [sec("intro", "Today", [], 0.5), sec("idea", "The facts", ids, 2), sec("idea", "The other side", ids, 2),
              sec("idea", "What it means for you", ids, 2), sec("idea", "Your options", ids, 2), sec("questions", "Questions for today", [], 1)],
          };
        }
        const n = Number(/exactly (\d+) idea/.exec(req.task)?.[1] ?? 3);
        return {
          title: "Your daily mix", summary: "A few ideas for today.",
          sections: [sec("intro", "Today", [], 0.5), ...items.slice(0, n).map((i) => sec("idea", String(i.title).slice(0, 40), [i.id], 2)), sec("recap", "Pick one", [], 1)],
        };
      }
      case "write": {
        if (d.lines) {
          // length adjustment call: rebuild at the new target
          return { lines: linesOfWords(target, "Adjusted section", d.format) };
        }
        const s = d.section as Any;
        return { lines: linesOfWords(target, `${s.title}: ${s.mainIdea}`, d.format, s.sourceIds[0]) };
      }
      case "check":
        return { sections: d.sections.map((s: Any) => ({ index: s.index, ok: true, problems: [], fixedLines: [] })) };
      default:
        throw new Error(`MockLlm has no answer for step ${step}`);
    }
  }
}
