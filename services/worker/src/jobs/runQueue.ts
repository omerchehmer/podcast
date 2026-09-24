/**
 * One worker run. Used by the scheduled GitHub Action (demo) and later by a hosted worker.
 *
 *   1. put stuck jobs back in the queue
 *   2. create episodes for users whose delivery time is close
 *   3. learn from new feedback (so the next episode already uses it)
 *   4. make every queued episode, a few at a time
 *
 * Needs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CONTEXT_ENCRYPTION_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY
 */
import { LIMITS } from "@briefcast/shared";
import { Repo, serviceClient, type EpisodeRow } from "../db/repo";
import { AnthropicLlm, type LlmClient } from "../providers/llm";
import { OpenAiTts, type TtsClient } from "../providers/tts";
import { runEpisode, NotEnoughContentError } from "../pipeline/run";
import { computeUpdates, summarize } from "../learning/learn";
import { CostCapExceeded, CostTracker } from "../lib/cost";
import { log } from "../lib/log";

const CONCURRENCY = 3;
/** Stop taking new jobs after this long, so one run never overlaps the next hourly run for long. */
const MAX_RUN_MS = 45 * 60 * 1000;

export async function learnFromFeedback(repo: Repo, llm: LlmClient): Promise<number> {
  const users = await repo.usersWithNewFeedback();
  for (const uid of users) {
    try {
      const input = await repo.loadLearningInput(uid);
      const updates = computeUpdates(input.preferences, input.interests, input.sources, input.newFeedback);
      const summary = await summarize(input.preferences.plannerSummary, input.recentFeedback, updates.signals, llm, new CostTracker());
      await repo.saveLearning(
        uid,
        { ...updates.preferences, plannerSummary: summary.plannerSummary, lastChangeNote: summary.changeNote },
        updates.interests,
        updates.sources,
      );
      log.info("learned", { userId: uid, feedbackCount: input.newFeedback.length });
    } catch (e) {
      log.error("learning failed", { userId: uid, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return users.length;
}

export async function processEpisode(repo: Repo, ep: EpisodeRow, llm: LlmClient, tts: TtsClient): Promise<void> {
  try {
    const listener = await repo.loadListener(ep);
    const result = await runEpisode(listener, { llm, tts, onStep: (s) => repo.setStatus(ep.id, s) });
    await repo.publish(ep, result);
    log.info("episode ready", { episodeId: ep.id, seconds: result.durationSec, usd: result.cost.totalUsd });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Some errors will not get better with a retry.
    const final = e instanceof NotEnoughContentError || e instanceof CostCapExceeded || ep.attempts >= LIMITS.maxJobAttempts;
    const code = e instanceof NotEnoughContentError ? "not_enough_content" : e instanceof CostCapExceeded ? "cost_cap" : "error";
    log.error("episode failed", { episodeId: ep.id, attempt: ep.attempts, final, error: msg });
    await repo.setStatus(ep.id, final ? "failed" : "queued", `${code}: ${msg}`.slice(0, 300));
  }
}

export async function runQueue(repo: Repo, llm: LlmClient, tts: TtsClient): Promise<{ made: number }> {
  const started = Date.now();
  await repo.requeueStale();
  const created = await repo.createDueEpisodes(90);
  const learned = await learnFromFeedback(repo, llm);
  log.info("run start", { created, learned });

  let made = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (Date.now() - started < MAX_RUN_MS) {
        const ep = await repo.claimNext();
        if (!ep) return;
        await processEpisode(repo, ep, llm, tts);
        made++;
      }
    }),
  );
  log.info("run done", { made, seconds: Math.round((Date.now() - started) / 1000) });
  return { made };
}

// Run directly: `pnpm worker:run`
if (import.meta.url === `file://${process.argv[1]}`) {
  runQueue(new Repo(serviceClient()), new AnthropicLlm(), new OpenAiTts()).catch((e) => {
    log.error("run crashed", { error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  });
}
