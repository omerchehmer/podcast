/**
 * Audio helpers for podcast transcription: download an episode, then cut it into small
 * mono parts that the speech-to-text API accepts (max 25 MB / 25 minutes per request).
 */
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { copyFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Podcasts are rarely over 300 MB; anything bigger is probably video or a broken link. */
const MAX_DOWNLOAD_BYTES = 400 * 1024 * 1024;

export async function download(url: string, file: string): Promise<void> {
  if (url.startsWith("file://")) return copyFile(fileURLToPath(url), file);
  const res = await fetch(url, {
    headers: { "user-agent": "BriefcastBot/0.1 (+https://briefcast.app/bot)" },
    redirect: "follow",
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!res.ok || !res.body) throw new Error(`audio HTTP ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_DOWNLOAD_BYTES) throw new Error("audio file too large");
  let bytes = 0;
  const body = Readable.fromWeb(res.body as never);
  body.on("data", (c: Buffer) => {
    bytes += c.length;
    if (bytes > MAX_DOWNLOAD_BYTES) body.destroy(new Error("audio file too large"));
  });
  await pipeline(body, createWriteStream(file));
}

export async function durationMinutes(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const sec = Number(stdout.trim());
  if (!Number.isFinite(sec) || sec <= 0) throw new Error("could not read audio length");
  return sec / 60;
}

/**
 * Cut the first `maxMinutes` into parts of `partMinutes`, as small speech-quality MP3
 * (mono, 16 kHz, 32 kbps: about 2.4 MB per 10 minutes). Returns the part files in order.
 */
export async function splitAudio(file: string, dir: string, maxMinutes: number, partMinutes: number): Promise<string[]> {
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", file, "-t", String(Math.round(maxMinutes * 60)),
    "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
    "-f", "segment", "-segment_time", String(partMinutes * 60), "-reset_timestamps", "1",
    join(dir, "part%03d.mp3"),
  ], { maxBuffer: 10 * 1024 * 1024 });
  const parts = (await readdir(dir)).filter((f) => /^part\d{3}\.mp3$/.test(f)).sort().map((f) => join(dir, f));
  // ffmpeg can leave a tiny last part (a fraction of a second); it has no words, so skip it.
  const sizes = await Promise.all(parts.map((p) => stat(p).then((s) => s.size)));
  return parts.filter((_, i) => sizes[i]! > 2000);
}
