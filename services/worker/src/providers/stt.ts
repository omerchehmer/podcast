/**
 * Speech-to-text for podcast episodes that have no transcript in their feed.
 * One interface; OpenAI is the default provider (see STT in config/ai.ts).
 */
import { createReadStream } from "node:fs";
import OpenAI from "openai";
import { STT } from "@briefcast/shared";
import type { CostTracker } from "../lib/cost";

export interface SttClient {
  readonly name: string;
  /** Transcribes one audio file (at most 25 minutes / 25 MB). */
  transcribe(file: string, minutes: number, cost: CostTracker): Promise<string>;
}

export class OpenAiStt implements SttClient {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI(apiKey ? { apiKey } : {});
  }

  async transcribe(file: string, minutes: number, cost: CostTracker): Promise<string> {
    const text = await this.client.audio.transcriptions.create({
      model: STT.model,
      file: createReadStream(file),
      response_format: "text",
    });
    cost.addStt("openai", STT.model, minutes * STT.usdPerMinute);
    return String(text);
  }
}

/** Offline stand-in: returns placeholder words and logs what the real cost would be. */
export class MockStt implements SttClient {
  readonly name = "mock";
  readonly files: string[] = [];

  async transcribe(file: string, minutes: number, cost: CostTracker): Promise<string> {
    this.files.push(file);
    cost.addStt("mock", STT.model, minutes * STT.usdPerMinute);
    // ~150 spoken words per minute, like a real conversation
    const n = Math.round(minutes * 150);
    return Array.from({ length: n }, (_, i) => (i % 12 === 11 ? "part." : `word${i}`)).join(" ");
  }
}
