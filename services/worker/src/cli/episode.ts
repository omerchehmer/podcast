/**
 * Make one episode from a profile file, on your computer.
 *
 *   pnpm episode --profile examples/profile.example.json            real run (needs API keys)
 *   pnpm episode --profile examples/profile.example.json --mock     offline dry run, no keys needed
 *
 * Options:
 *   --mock                 use the offline LLM and no voice (tests the flow and cost estimate)
 *   --no-audio             real LLM, but skip the voice step (cheaper while tuning prompts)
 *   --minutes 10           override length
 *   --format conversation  override format (solo | conversation)
 *   --type deep_dive       override episode type (mix | deep_dive)
 *   --out out/             output folder
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ListenerInput } from "@briefcast/shared";
import { AnthropicLlm } from "../providers/llm";
import { MockLlm } from "../providers/mockLlm";
import { MockTts, OpenAiTts } from "../providers/tts";
import { runEpisode, type EpisodeResult } from "../pipeline/run";
import { httpFetchPage } from "../lib/fetchPage";
import { scrubSensitive } from "../lib/scrub";

const { values } = parseArgs({
  options: {
    profile: { type: "string", default: "examples/profile.example.json" },
    mock: { type: "boolean", default: false },
    "no-audio": { type: "boolean", default: false },
    minutes: { type: "string" },
    format: { type: "string" },
    type: { type: "string" },
    out: { type: "string", default: "out" },
  },
});

async function main() {
  process.env.LOG_LEVEL ??= "quiet";
  const profilePath = resolve(values.profile!);
  const raw = JSON.parse(await readFile(profilePath, "utf8"));

  // Relative file feeds in the profile are resolved from the profile's folder.
  for (const s of raw.sources ?? []) {
    if (s.feedUrl?.startsWith("./")) s.feedUrl = pathToFileURL(resolve(dirname(profilePath), s.feedUrl)).href;
  }
  const listener = ListenerInput.parse(raw);
  if (values.minutes) listener.settings.lengthMinutes = Number(values.minutes);
  if (values.format) listener.settings.format = values.format as "solo" | "conversation";
  if (values.type) listener.settings.episodeType = values.type as "mix" | "deep_dive";
  // Same rule as the app: sensitive data is removed from the profile before use.
  listener.context = scrubSensitive(listener.context).text;

  if (!values.mock) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.BRIEFCAST_ANTHROPIC_API_KEY) fail("ANTHROPIC_API_KEY (or BRIEFCAST_ANTHROPIC_API_KEY) is not set. Use --mock for a dry run, or see docs/SETUP_GUIDE.md.");
    if (!values["no-audio"] && !process.env.OPENAI_API_KEY) fail("OPENAI_API_KEY is not set. Use --no-audio to skip the voice step.");
  }
  const llm = values.mock ? new MockLlm() : new AnthropicLlm();
  const tts = values.mock || values["no-audio"] ? new MockTts() : new OpenAiTts();

  const started = Date.now();
  const result = await runEpisode(listener, {
    llm, tts,
    // The dry run stays fully offline; real runs read the full article of picked items.
    fetchPage: values.mock ? undefined : httpFetchPage,
    onStep: (s) => console.error(`… ${s}`),
  });
  const dir = join(values.out!, new Date().toISOString().replace(/[:.]/g, "-"));
  await save(dir, result);
  printSummary(result, dir, (Date.now() - started) / 1000);
}

async function save(dir: string, r: EpisodeResult) {
  await mkdir(dir, { recursive: true });
  const { audio, ...rest } = r;
  await writeFile(join(dir, "episode.json"), JSON.stringify(rest, null, 2));
  await writeFile(join(dir, "script.md"), scriptMarkdown(r));
  if (audio) await writeFile(join(dir, "episode.mp3"), audio);
}

function scriptMarkdown(r: EpisodeResult): string {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const out = [`# ${r.title}`, "", r.summary, ""];
  for (const sec of r.sections) {
    const ch = r.chapters.find((c) => c.index === sec.section.index);
    out.push(`## ${sec.section.title}  (${ch ? fmt(ch.startSec) : "?"})`, "");
    for (const l of sec.lines) out.push(`**${l.speaker}:** ${l.text}`, "");
  }
  out.push("## Sources", "");
  for (const s of r.sources) out.push(`- [${s.id}] ${s.source} — ${s.title}${s.url ? ` (${s.url})` : ""}`);
  if (r.issues.length) {
    out.push("", "## Check findings", "");
    for (const i of r.issues) out.push(`- section ${i.sectionIndex}: ${i.type} — ${i.detail}${i.fixed ? " (fixed)" : ""}`);
  }
  return out.join("\n") + "\n";
}

function printSummary(r: EpisodeResult, dir: string, seconds: number) {
  const mins = (r.durationSec / 60).toFixed(1);
  console.log(`
Episode: ${r.title}
Length:  ${mins} min (target ${(r.targetSeconds / 60).toFixed(0)} min, ${r.durationMeasured ? "measured" : "estimated"}) ${r.withinTarget ? "✓ within 10%" : "✗ outside 10%"}
Words:   ${r.wordCount} (target ${r.targetWords})
Chapters: ${r.chapters.length}   Sources used: ${r.sources.length}   Check findings: ${r.issues.length}
Cost:    $${r.cost.totalUsd.toFixed(3)}  ${Object.entries(r.cost.byStep).map(([k, v]) => `${k} $${v.toFixed(3)}`).join(", ")}
Time:    ${seconds.toFixed(0)} s
Saved:   ${dir}/ (script.md, episode.json${r.audio ? ", episode.mp3" : ""})`);
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
