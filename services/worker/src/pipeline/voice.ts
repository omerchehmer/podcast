/**
 * Step 6 — Voice: turn the script into one MP3 with exact chapter times.
 * Each line is sent to TTS (two voices for conversations). ffmpeg joins the parts,
 * adds a short intro sound and sets podcast loudness (-16 LUFS).
 * Without ffmpeg or with the mock TTS, we still return chapters, using estimated times.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { LIMITS, VOICES, type ListenerInput } from "@briefcast/shared";
import { stripSourceTags, wordCount } from "../lib/text";
import type { CostTracker } from "../lib/cost";
import { splitForTts, type TtsClient } from "../providers/tts";
import { mapLimit } from "../lib/limit";
import type { WrittenSection } from "./write";

const run = promisify(execFile);

export interface Chapter {
  index: number;
  title: string;
  kind: string;
  startSec: number;
  endSec: number;
}
export interface TranscriptLine {
  speaker: "HOST_A" | "HOST_B";
  text: string;
  startSec: number;
  endSec: number;
}
export interface VoiceResult {
  audio: Buffer | null;
  durationSec: number;
  /** true when times come from the real audio, false when estimated from word count */
  measured: boolean;
  chapters: Chapter[];
  transcript: TranscriptLine[];
}

const INTRO_SEC = 2.5;
const GAP_SEC = 0.7;

export async function hasFfmpeg(): Promise<boolean> {
  try {
    await run("ffmpeg", ["-version"]);
    await run("ffprobe", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

function voiceFor(speaker: "HOST_A" | "HOST_B", listener: ListenerInput): string {
  const id = speaker === "HOST_B" ? listener.settings.voiceB : listener.settings.voiceA;
  return VOICES.find((v) => v.id === id)?.providerVoiceId ?? id;
}

function wpmFor(listener: ListenerInput): number {
  return VOICES.find((v) => v.id === listener.settings.voiceA)?.wordsPerMinute ?? LIMITS.defaultWordsPerMinute;
}

function speakingInstructions(speaker: "HOST_A" | "HOST_B", listener: ListenerInput): string {
  const base = "Speak clearly at a steady, moderate pace for listeners who may not be native speakers. Natural podcast delivery.";
  const tone = listener.settings.tone === "direct"
    ? `${base} Confident and direct, with energy but no hype.`
    : `${base} Calm, warm and patient.`;
  const id = speaker === "HOST_B" ? listener.settings.voiceB : listener.settings.voiceA;
  const style = VOICES.find((v) => v.id === id)?.style;
  return style ? `${tone} ${style}` : tone;
}

async function durationOf(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(stdout.trim());
}

export async function voice(
  sections: WrittenSection[],
  listener: ListenerInput,
  tts: TtsClient,
  cost: CostTracker,
): Promise<VoiceResult> {
  // One TTS job per line (long lines split in chunks). Tags are removed first — they are never spoken.
  const jobs = sections.flatMap((s, si) =>
    s.lines.flatMap((l, li) =>
      splitForTts(stripSourceTags(l.text)).map((text) => ({ si, li, speaker: l.speaker, text })),
    ),
  );
  const audios = await mapLimit(jobs, 4, (j) =>
    tts.synthesize({ text: j.text, voice: voiceFor(j.speaker, listener), instructions: speakingInstructions(j.speaker, listener) }, cost));

  const canBuild = audios.every((a) => a !== null) && (await hasFfmpeg());
  if (!canBuild) return estimated(sections, listener);

  const dir = await mkdtemp(join(tmpdir(), "briefcast-"));
  try {
    // 1. write every clip, and measure each line's length
    const clipFiles = await Promise.all(
      audios.map(async (a, i) => {
        const f = join(dir, `clip-${i}.mp3`);
        await writeFile(f, a!);
        return f;
      }),
    );
    const clipDur = await Promise.all(clipFiles.map(durationOf));

    // 2. short intro sound (two soft tones) and a gap between sections
    const intro = join(dir, "intro.mp3");
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=523:duration=0.6", "-f", "lavfi", "-i", "sine=frequency=784:duration=0.9",
      "-filter_complex", "[0][1]concat=n=2:v=0:a=1,afade=t=in:d=0.1,afade=t=out:st=1.1:d=0.4,volume=0.25,apad=pad_dur=1", "-t", String(INTRO_SEC),
      "-ar", "24000", "-ac", "1", intro]);
    const gap = join(dir, "gap.mp3");
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", `anullsrc=r=24000:cl=mono`, "-t", String(GAP_SEC), gap]);

    // 3. build the concat list and compute exact times
    const list: string[] = [intro];
    let t = INTRO_SEC;
    const chapters: Chapter[] = [];
    const transcript: TranscriptLine[] = [];
    sections.forEach((s, si) => {
      if (si > 0) {
        list.push(gap);
        t += GAP_SEC;
      }
      const start = t;
      s.lines.forEach((l, li) => {
        const lineStart = t;
        jobs.forEach((j, ji) => {
          if (j.si === si && j.li === li) {
            list.push(clipFiles[ji]!);
            t += clipDur[ji]!;
          }
        });
        transcript.push({ speaker: l.speaker, text: stripSourceTags(l.text), startSec: round(lineStart), endSec: round(t) });
      });
      chapters.push({ index: s.section.index, title: s.section.title, kind: s.section.kind, startSec: round(start), endSec: round(t) });
    });

    const listFile = join(dir, "list.txt");
    await writeFile(listFile, list.map((f) => `file '${f}'`).join("\n"));
    const out = join(dir, "episode.mp3");
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-ar", "44100", "-ac", "1", "-b:a", "96k", out], { maxBuffer: 64 * 1024 * 1024 });
    const audio = await readFile(out);
    return { audio, durationSec: round(await durationOf(out)), measured: true, chapters, transcript };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Chapter and transcript times estimated from word count (mock runs, or no ffmpeg). */
export function estimated(sections: WrittenSection[], listener: ListenerInput): VoiceResult {
  const wps = wpmFor(listener) / 60;
  let t = INTRO_SEC;
  const chapters: Chapter[] = [];
  const transcript: TranscriptLine[] = [];
  sections.forEach((s, si) => {
    if (si > 0) t += GAP_SEC;
    const start = t;
    for (const l of s.lines) {
      const text = stripSourceTags(l.text);
      const d = wordCount(text) / wps;
      transcript.push({ speaker: l.speaker, text, startSec: round(t), endSec: round(t + d) });
      t += d;
    }
    chapters.push({ index: s.section.index, title: s.section.title, kind: s.section.kind, startSec: round(start), endSec: round(t) });
  });
  return { audio: null, durationSec: round(t), measured: false, chapters, transcript };
}

const round = (n: number) => Math.round(n * 10) / 10;
