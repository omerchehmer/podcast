/** Tracks the cost of every LLM and TTS call for one episode. */
import { CACHE_READ_FACTOR, CACHE_WRITE_FACTOR, LLM_PRICES, LIMITS } from "@briefcast/shared";

export interface CostEntry {
  step: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  characters: number;
  usd: number;
}

export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export class CostCapExceeded extends Error {}

export class CostTracker {
  readonly entries: CostEntry[] = [];
  constructor(private readonly capUsd: number = LIMITS.hardCostCapUsd) {}

  addLlm(step: string, model: string, usage: LlmUsage): CostEntry {
    const price = LLM_PRICES[model] ?? { input: 5, output: 25 }; // unknown model: assume expensive
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    const usd =
      (usage.input_tokens * price.input +
        cacheRead * price.input * CACHE_READ_FACTOR +
        cacheWrite * price.input * CACHE_WRITE_FACTOR +
        usage.output_tokens * price.output) /
      1_000_000;
    return this.push({
      step, provider: "anthropic", model,
      inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
      cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, characters: 0, usd,
    });
  }

  addTts(provider: string, model: string, characters: number, usd: number): CostEntry {
    return this.push({
      step: "voice", provider, model, inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheWriteTokens: 0, characters, usd,
    });
  }

  get totalUsd(): number {
    return this.entries.reduce((a, e) => a + e.usd, 0);
  }

  byStep(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.entries) out[e.step] = (out[e.step] ?? 0) + e.usd;
    return out;
  }

  private push(e: CostEntry): CostEntry {
    this.entries.push(e);
    if (this.totalUsd > this.capUsd) {
      throw new CostCapExceeded(`Episode cost $${this.totalUsd.toFixed(2)} is over the cap of $${this.capUsd}`);
    }
    return e;
  }
}
