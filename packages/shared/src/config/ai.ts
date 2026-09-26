/**
 * AI model and voice provider choices.
 * To switch a model or provider, change it here. Prices are used only for cost logging;
 * check the providers' price pages from time to time and update them.
 */

export type PipelineStep = "rank" | "plan" | "write" | "check" | "scrub" | "learn";

/** Which Claude model runs each step. Cheap model for sorting/checking, stronger model for writing. */
export const LLM_MODELS: Record<PipelineStep, string> = {
  rank: "claude-haiku-4-5",
  plan: "claude-sonnet-5",
  write: "claude-sonnet-5",
  check: "claude-haiku-4-5",
  scrub: "claude-haiku-4-5",
  learn: "claude-haiku-4-5",
};

/** USD per 1 million tokens. Cache reads cost ~10% of input, cache writes ~125%. */
export const LLM_PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
};
export const CACHE_READ_FACTOR = 0.1;
export const CACHE_WRITE_FACTOR = 1.25;

export type TtsProvider = "openai" | "elevenlabs" | "mock";

export const TTS = {
  /** Default provider. ElevenLabs is kept for a possible premium plan (too expensive for the $0.50 target). */
  provider: "openai" as TtsProvider,
  openai: {
    model: "gpt-4o-mini-tts",
    /** Approximate USD per minute of audio, for cost logging. */
    usdPerMinute: 0.015,
    format: "mp3" as const,
  },
  elevenlabs: {
    model: "eleven_multilingual_v2",
    /** Approximate USD per 1,000 characters. */
    usdPer1kChars: 0.15,
  },
};

export interface VoiceOption {
  id: string;
  provider: TtsProvider;
  providerVoiceId: string;
  name: string;
  description: string;
  /** Measured speaking speed. The worker updates this after real episodes. */
  wordsPerMinute: number;
  /** Extra speaking style for this voice, added to the TTS instructions (gpt-4o-mini-tts). */
  style?: string;
}

/** Voices shown in onboarding. Each has a 10-second preview file in storage: voices/<id>.mp3 */
export const VOICES: VoiceOption[] = [
  { id: "marin", provider: "openai", providerVoiceId: "marin", name: "Marin", description: "Warm and clear", wordsPerMinute: 160 },
  { id: "cedar", provider: "openai", providerVoiceId: "cedar", name: "Cedar", description: "Calm and deep", wordsPerMinute: 155 },
  { id: "coral", provider: "openai", providerVoiceId: "coral", name: "Coral", description: "Bright and friendly", wordsPerMinute: 165 },
  { id: "sage", provider: "openai", providerVoiceId: "sage", name: "Sage", description: "Steady and thoughtful", wordsPerMinute: 158 },
  { id: "ash", provider: "openai", providerVoiceId: "ash", name: "Ash", description: "Direct and confident", wordsPerMinute: 162 },
  {
    id: "onyx", provider: "openai", providerVoiceId: "onyx", name: "Onyx", description: "Deep and inspiring", wordsPerMinute: 175,
    style: "Voice style: an inspiring mentor giving a keynote. Warm, confident and full of conviction. "
      + "Lift your energy on the key ideas and use short pauses before them. Sincere and human, never salesy or over the top.",
  },
];

export const DEFAULT_VOICES = { solo: "marin", hostA: "marin", hostB: "cedar" } as const;

/**
 * Thinking effort per step ("low" | "medium" | "high"). Lower effort = cheaper and faster.
 * Haiku does not take an effort setting, so those steps are undefined.
 */
export const LLM_EFFORT: Record<PipelineStep, "low" | "medium" | "high" | undefined> = {
  rank: undefined,
  plan: "medium",
  write: "medium",
  check: undefined,
  scrub: undefined,
  learn: undefined,
};
