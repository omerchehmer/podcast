/**
 * Make the 10-second voice previews shown in onboarding and settings.
 *   pnpm voice:previews              → all voices, skips files that already exist
 *   pnpm voice:previews --force      → make all again (for example after changing the sample text)
 *   pnpm voice:previews --only marin → one voice
 *
 * Needs OPENAI_API_KEY. Files go to apps/web/public/voices/<id>.mp3 and ship with the web app.
 * With ffmpeg installed, each file is cut to 10 seconds with a short fade out.
 * Cost: about $0.01 for all voices.
 */
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VOICE_PREVIEW, VOICES } from "@briefcast/shared";
import { OpenAiTts } from "../providers/tts";
import { CostTracker } from "../lib/cost";

const { values } = parseArgs({ options: { force: { type: "boolean", default: false }, only: { type: "string" } } });

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not set.");
  process.exit(1);
}

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../apps/web/public");
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
if (!hasFfmpeg) console.warn("ffmpeg not found: files are not cut to 10 seconds (the app still stops at 10 seconds).");

const tts = new OpenAiTts();
const cost = new CostTracker();
const voices = VOICES.filter((v) => !values.only || v.id === values.only);
if (!voices.length) {
  console.error(`No voice with id "${values.only}".`);
  process.exit(1);
}

for (const v of voices) {
  const file = join(outDir, VOICE_PREVIEW.path(v.id));
  if (existsSync(file) && !values.force) {
    console.log(`${v.id}: exists, skipped`);
    continue;
  }
  mkdirSync(dirname(file), { recursive: true });
  const audio = await tts.synthesize(
    { text: VOICE_PREVIEW.text(v.name), voice: v.providerVoiceId, instructions: "Warm, natural podcast host. Relaxed pace." },
    cost,
  );
  if (hasFfmpeg) {
    const raw = `${file}.raw.mp3`;
    const s = VOICE_PREVIEW.seconds;
    writeFileSync(raw, audio);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-t", String(s), "-af", `afade=t=out:st=${s - 0.5}:d=0.5`, "-b:a", "96k", `${file}.tmp.mp3`]);
    renameSync(`${file}.tmp.mp3`, file);
    rmSync(raw);
  } else {
    writeFileSync(file, audio);
  }
  console.log(`${v.id}: ${file}`);
}
console.log(`Cost: about $${cost.totalUsd.toFixed(3)}`);
