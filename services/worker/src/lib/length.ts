/** Length control: turn minutes into word budgets and check the result. */
import { LIMITS } from "@briefcast/shared";

export function targetWords(seconds: number, wordsPerMinute: number = LIMITS.defaultWordsPerMinute): number {
  return Math.round((seconds / 60) * wordsPerMinute);
}

export function withinTolerance(actual: number, target: number, tolerance: number = LIMITS.lengthTolerance): boolean {
  return Math.abs(actual - target) <= target * tolerance;
}

/**
 * Split a word budget over sections by weight. Rounds so the parts add up exactly.
 * Example: 1600 words, weights [1, 3, 3, 3, 1] → [145, 436, 436, 437, 146]
 */
export function splitBudget(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  // give the leftover words to the sections with the biggest fractional part
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    out[i]! += 1;
    rest -= 1;
  }
  return out;
}

/** How many ideas fit in a Mix episode of this length. */
export function ideasForMix(minutes: number): number {
  if (minutes <= 5) return 2;
  if (minutes <= 10) return 3;
  if (minutes <= 20) return 4;
  return 5;
}
