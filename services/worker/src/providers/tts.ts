/**
 * Text-to-speech. One interface; OpenAI is the default provider (see config/ai.ts).
 */
import OpenAI from "openai";
import { TTS } from "@briefcast/shared";
import type { CostTracker } from "../lib/cost";

export interface TtsRequest {
  text: string;
  /** Provider voice ID, for example "marin". */
  voice: string;
  /** How to speak (tone, pace). Supported by gpt-4o-mini-tts. */
  instructions?: string;
}

export interface TtsClient {
  readonly name: string;
  /** Returns MP3 bytes, or null when the client does not make audio (mock). */
  synthesize(req: TtsRequest, cost: CostTracker): Promise<Buffer | null>;
}

/** OpenAI's limit per request is 4096 characters. We split long text on sentence ends. */
export const MAX_TTS_CHARS = 4000;

export function splitForTts(text: string, max = MAX_TTS_CHARS): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      chunks.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export class OpenAiTts implements TtsClient {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI(apiKey ? { apiKey } : {});
  }

  async synthesize(req: TtsRequest, cost: CostTracker): Promise<Buffer> {
    const res = await this.client.audio.speech.create({
      model: TTS.openai.model,
      voice: req.voice as "alloy",
      input: req.text,
      instructions: req.instructions,
      response_format: TTS.openai.format,
    });
    const audio = Buffer.from(await res.arrayBuffer());
    // Cost is estimated from length: ~160 words per minute.
    const minutes = req.text.split(/\s+/).length / 160;
    cost.addTts("openai", TTS.openai.model, req.text.length, minutes * TTS.openai.usdPerMinute);
    return audio;
  }
}

/** Makes no audio. Logs what the real cost would be, so dry runs still show a full cost estimate. */
export class MockTts implements TtsClient {
  readonly name = "mock";
  async synthesize(req: TtsRequest, cost: CostTracker): Promise<null> {
    const minutes = req.text.split(/\s+/).length / 160;
    cost.addTts("mock", TTS.openai.model, req.text.length, minutes * TTS.openai.usdPerMinute);
    return null;
  }
}
