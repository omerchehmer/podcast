/**
 * Podcast transcripts: many podcast feeds link a transcript with the Podcasting 2.0 tag
 *   <podcast:transcript url="…" type="text/vtt" />
 * We read it for the podcast items the plan uses, so the script is based on what was said in the
 * episode, not only on the show notes. No transcript, or a broken one → the item keeps its show notes.
 */
import { LIMITS } from "@briefcast/shared";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { htmlToText, truncateWords, wordCount } from "../lib/text";
import { log } from "../lib/log";
import type { CollectedItem } from "./collect";

export interface TranscriptLink {
  url: string;
  type: string;
}

/** Best formats first. Text formats are easy to clean; JSON and HTML keep speaker names more often. */
const PREFERRED = ["application/json", "text/vtt", "application/x-subrip", "application/srt", "text/srt", "text/plain", "text/html"];

export function pickTranscript(links: TranscriptLink[]): TranscriptLink | undefined {
  const rank = (t: string) => {
    const i = PREFERRED.indexOf(t.toLowerCase().split(";")[0]!.trim());
    return i === -1 ? PREFERRED.length : i;
  };
  return [...links].filter((l) => l.url).sort((a, b) => rank(a.type) - rank(b.type))[0];
}

/** Join lines of the same speaker, so "Anna: …" appears once per turn, not once per cue. */
function joinTurns(turns: { speaker?: string; text: string }[]): string {
  const out: { speaker?: string; text: string }[] = [];
  for (const t of turns) {
    const text = t.text.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.speaker === t.speaker) last.text += " " + text;
    else out.push({ speaker: t.speaker, text });
  }
  return out.map((t) => (t.speaker ? `${t.speaker}: ${t.text}` : t.text)).join("\n");
}

/** SRT and WebVTT: drop headers, cue numbers and times; keep the spoken words and <v Speaker> names. */
function cuesToText(body: string): string {
  const turns: { speaker?: string; text: string }[] = [];
  for (const block of body.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0]!)) continue;
    const at = lines.findIndex((l) => l.includes("-->"));
    for (const line of at === -1 ? lines : lines.slice(at + 1)) {
      const voice = /^<v(?:\.[^\s>]+)?\s+([^>]+)>/.exec(line);
      const plain = line.replace(/<[^>]+>/g, "").trim();
      const named = !voice && /^([A-Z][\w .'-]{0,40}):\s+(.*)$/.exec(plain);
      if (voice) turns.push({ speaker: voice[1]!.trim(), text: plain });
      else if (named) turns.push({ speaker: named[1]!.trim(), text: named[2]! });
      else turns.push({ speaker: turns[turns.length - 1]?.speaker, text: plain });
    }
  }
  return joinTurns(turns);
}

/** Podcasting 2.0 JSON: { segments: [{ speaker, body, startTime, endTime }] }. */
function jsonToText(body: string): string {
  const data = JSON.parse(body) as { segments?: { speaker?: string; body?: string }[] };
  return joinTurns((data.segments ?? []).map((s) => ({ speaker: s.speaker?.trim() || undefined, text: String(s.body ?? "") })));
}

export function transcriptToText(body: string, type: string): string {
  const t = type.toLowerCase();
  const text =
    t.includes("json") ? jsonToText(body)
    : t.includes("vtt") || t.includes("srt") || t.includes("subrip") || /^WEBVTT/.test(body) ? cuesToText(body)
    : t.includes("html") ? htmlToText(body)
    : body;
  return text.replace(/[ \t]+/g, " ").trim();
}

const MAX_BYTES = 3_000_000;

async function loadTranscript(url: string): Promise<string> {
  if (url.startsWith("file://")) return readFile(fileURLToPath(url), "utf8");
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("transcript too large");
  const body = await res.text();
  if (body.length > MAX_BYTES) throw new Error("transcript too large");
  return body;
}

/**
 * Replace the show notes with the transcript for the given items. Items without a transcript link,
 * or with a transcript that fails to load, are returned unchanged. Runs a few downloads at a time.
 */
export async function addTranscripts<T extends CollectedItem>(items: T[], onlyIds?: Set<string>): Promise<T[]> {
  const todo = items.filter((i) => i.transcript && i.basis === "show_notes" && (!onlyIds || onlyIds.has(i.id)));
  const loaded = new Map<string, T>();
  for (let n = 0; n < todo.length; n += 4) {
    await Promise.all(
      todo.slice(n, n + 4).map(async (item) => {
        try {
          const text = transcriptToText(await loadTranscript(item.transcript!.url), item.transcript!.type);
          if (wordCount(text) < 50) throw new Error("transcript is empty or too short");
          const total = wordCount(text);
          loaded.set(item.id, {
            ...item,
            basis: "transcript",
            transcriptPartial: total > LIMITS.maxTranscriptWords,
            excerpt: truncateWords(text, LIMITS.maxTranscriptWords),
          });
        } catch (e) {
          log.warn("transcript failed", { source: item.sourceTitle, error: String(e) });
        }
      }),
    );
  }
  return items.map((i) => loaded.get(i.id) ?? i);
}
