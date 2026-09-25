/**
 * LLM access for the pipeline. One small interface, two implementations:
 * - AnthropicLlm: the real Claude API (structured JSON output + prompt caching)
 * - MockLlm (mockLlm.ts): offline, for tests and dry runs
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { LLM_MODELS, LLM_EFFORT, type PipelineStep } from "@briefcast/shared";
import type { CostTracker } from "../lib/cost";

export interface LlmRequest<S extends z.ZodType> {
  /** Stable instructions. Cached, so keep them the same between calls (no dates or IDs here). */
  system: string;
  /** What to do in this call. */
  task: string;
  /** Structured input for this call. Sent as JSON after the task. */
  data: unknown;
  /** Shape of the answer. */
  schema: S;
  maxTokens?: number;
}

export interface LlmClient {
  json<S extends z.ZodType>(step: PipelineStep, req: LlmRequest<S>, cost: CostTracker): Promise<z.infer<S>>;
}

export class LlmError extends Error {}

/** Builds the user message. Shared by the real and the mock client so tests see the same shape. */
export function renderUserMessage(task: string, data: unknown): string {
  return `${task}\n\n<input>\n${JSON.stringify(data, null, 2)}\n</input>`;
}

export class AnthropicLlm implements LlmClient {
  private client: Anthropic;

  constructor(apiKey?: string) {
    // BRIEFCAST_ANTHROPIC_API_KEY is for Claude Code cloud workspaces, which reserve ANTHROPIC_API_KEY.
    const key = apiKey ?? process.env.BRIEFCAST_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    this.client = new Anthropic(key ? { apiKey: key } : {});
  }

  async json<S extends z.ZodType>(step: PipelineStep, req: LlmRequest<S>, cost: CostTracker): Promise<z.infer<S>> {
    const model = LLM_MODELS[step];
    const effort = LLM_EFFORT[step];
    const response = await this.client.messages.parse({
      model,
      max_tokens: req.maxTokens ?? 16000,
      // The system prompt is the same for every user, so it is cached across calls.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: renderUserMessage(req.task, req.data) }],
      output_config: { format: zodOutputFormat(req.schema), ...(effort ? { effort } : {}) },
    });

    cost.addLlm(step, model, response.usage);

    if (response.stop_reason === "refusal") {
      throw new LlmError(`Model declined the ${step} step`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new LlmError(`The ${step} step ran out of output tokens`);
    }
    if (response.parsed_output == null) {
      throw new LlmError(`The ${step} step returned output that did not match the schema`);
    }
    return response.parsed_output as z.infer<S>;
  }
}
