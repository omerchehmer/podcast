/**
 * Database access for the worker (Supabase, service role).
 * The service role skips RLS, so every query here filters by user_id on purpose.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ListenerInput, type PreferenceState } from "@briefcast/shared";
import { byteaToBuffer, decryptText } from "../lib/crypto";
import type { EpisodeResult, Step } from "../pipeline/run";
import type { FeedbackInput, InterestRow, UserSourceRow } from "../learning/learn";

export interface EpisodeRow {
  id: string;
  user_id: string;
  status: string;
  trigger: string;
  episode_type: "mix" | "deep_dive";
  format: "solo" | "conversation";
  tone: "direct" | "calm";
  language: string;
  target_seconds: number;
  deep_dive_of_segment_id: string | null;
  attempts: number;
}

export function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Throws with a short message when Supabase returns an error. */
function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export class Repo {
  constructor(private db: SupabaseClient) {}

  // ---------- queue ----------

  async requeueStale(): Promise<void> {
    must(await this.db.rpc("requeue_stale_episodes"), "requeue_stale_episodes");
  }

  async createDueEpisodes(leadMinutes: number): Promise<number> {
    const rows = must(
      await this.db.rpc("create_due_episodes", { now_ts: new Date().toISOString(), lead: `${leadMinutes} minutes` }),
      "create_due_episodes",
    ) as unknown[];
    return rows.length;
  }

  async claimNext(): Promise<EpisodeRow | null> {
    const rows = must(await this.db.rpc("claim_next_episode"), "claim_next_episode") as EpisodeRow[];
    return rows[0] ?? null;
  }

  async setStatus(episodeId: string, status: Step | "queued" | "failed", error?: string): Promise<void> {
    must(await this.db.from("episodes").update({ status, ...(error !== undefined ? { error } : {}) }).eq("id", episodeId), "set status");
  }

  // ---------- load everything the pipeline needs ----------

  async loadListener(ep: EpisodeRow): Promise<ListenerInput> {
    const uid = ep.user_id;
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const [profile, settings, interests, userSources, ctx, prefs, recent] = await Promise.all([
      this.db.from("profiles").select("display_name, time_zone").eq("user_id", uid).single(),
      this.db.from("podcast_settings").select("*").eq("user_id", uid).single(),
      this.db.from("interests").select("label, user_weight, learned_weight").eq("user_id", uid),
      this.db.from("user_sources").select("source_id, trust, muted, sources(kind, title, url, feed_url)").eq("user_id", uid).eq("muted", false),
      this.db.from("listener_context").select("ciphertext").eq("user_id", uid).eq("is_current", true).maybeSingle(),
      this.db.from("preference_state").select("*").eq("user_id", uid).single(),
      this.db
        .from("episode_segments")
        .select("topic_tags, episodes!episode_segments_episode_id_fkey!inner(user_id, scheduled_for, status)")
        .eq("episodes.user_id", uid)
        .eq("episodes.status", "ready")
        .gte("episodes.scheduled_for", since),
    ]);
    const p = must(profile, "profile") as { display_name: string | null; time_zone: string };
    const s = must(settings, "settings") as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const pr = must(prefs, "preferences") as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const us = must(userSources, "user sources") as unknown as {
      source_id: string; trust: number;
      sources: { kind: string; title: string; url: string | null; feed_url: string | null };
    }[];
    const c = must(ctx, "context") as { ciphertext: string } | null;
    const rec = must(recent, "recent topics") as unknown as { topic_tags: string[]; episodes: { scheduled_for: string } }[];

    const deepDive = ep.deep_dive_of_segment_id ? await this.loadDeepDive(ep.deep_dive_of_segment_id) : undefined;

    return ListenerInput.parse({
      userId: uid,
      displayName: p.display_name || "there",
      context: c ? decryptText(byteaToBuffer(c.ciphertext)) : "",
      interests: (must(interests, "interests") as { label: string; user_weight: string; learned_weight: number }[]).map((i) => ({
        label: i.label, weight: i.user_weight, learnedWeight: i.learned_weight,
      })),
      sources: us.filter((u) => u.sources.kind !== "book").map((u) => ({
        id: u.source_id, kind: u.sources.kind, title: u.sources.title,
        url: u.sources.url ?? undefined, feedUrl: u.sources.feed_url ?? undefined, trust: u.trust,
      })),
      books: us.filter((u) => u.sources.kind === "book").map((u) => u.sources.title),
      settings: {
        frequency: s.frequency,
        customDays: s.custom_days,
        deliveryTime: String(s.delivery_time).slice(0, 5),
        timeZone: p.time_zone,
        lengthMinutes: s.length_minutes,
        // format, type, tone and language come from the episode row (copied when it was queued)
        format: ep.format,
        voiceA: s.voice_a_id,
        voiceB: s.voice_b_id,
        episodeType: ep.episode_type,
        tone: ep.tone,
        language: ep.language,
      },
      preferences: {
        depth: pr.depth, newsVsIdeas: pr.news_vs_ideas, workRelevance: pr.work_relevance,
        lengthBiasSeconds: pr.length_bias_seconds, plannerSummary: pr.planner_summary, lastChangeNote: pr.last_change_note,
      },
      recentTopics: rec.flatMap((r) => r.topic_tags.map((tag) => ({ tag, date: r.episodes.scheduled_for }))),
      deepDiveRequest: deepDive,
    });
  }

  private async loadDeepDive(segmentId: string) {
    const seg = must(
      await this.db.from("episode_segments").select("title, main_idea").eq("id", segmentId).single(),
      "deep dive segment",
    ) as { title: string; main_idea: string | null };
    const src = must(
      await this.db.from("episode_sources").select("source_items(url)").eq("segment_id", segmentId),
      "deep dive sources",
    ) as unknown as { source_items: { url: string | null } }[];
    return {
      title: seg.title,
      mainIdea: seg.main_idea ?? seg.title,
      sourceUrls: src.map((s) => s.source_items.url).filter((u): u is string => !!u),
    };
  }

  // ---------- publish ----------

  async publish(ep: EpisodeRow, r: EpisodeResult): Promise<void> {
    let audioPath: string | null = null;
    if (r.audio) {
      audioPath = `${ep.user_id}/${ep.id}.mp3`;
      must(
        await this.db.storage.from("episodes").upload(audioPath, r.audio, { contentType: "audio/mpeg", upsert: true }),
        "upload audio",
      );
    }

    // chapters
    const segRows = must(
      await this.db
        .from("episode_segments")
        .insert(
          r.sections.map((s) => {
            const ch = r.chapters.find((c) => c.index === s.section.index);
            return {
              episode_id: ep.id, idx: s.section.index, kind: s.section.kind, title: s.section.title,
              main_idea: s.section.mainIdea, question: s.section.question || null, topic_tags: s.section.topicTags,
              start_sec: ch?.startSec ?? null, end_sec: ch?.endSec ?? null,
            };
          }),
        )
        .select("id, idx"),
      "insert segments",
    ) as { id: string; idx: number }[];
    const segId = new Map(segRows.map((x) => [x.idx, x.id]));

    // sources: save the items (deduplicated per source), then link them to the episode
    const withSource = r.sources.filter((s) => s.item.sourceId);
    if (withSource.length) {
      const items = must(
        await this.db
          .from("source_items")
          .upsert(
            withSource.map((s) => ({
              source_id: s.item.sourceId, title: s.item.title, url: s.item.url ?? null,
              published_at: s.item.publishedAt ?? null, summary: s.item.summary, body_excerpt: s.item.excerpt,
              content_hash: s.item.hash,
            })),
            { onConflict: "source_id,content_hash" },
          )
          .select("id, content_hash, source_id"),
        "upsert source items",
      ) as { id: string; content_hash: string; source_id: string }[];
      const itemId = new Map(items.map((i) => [`${i.source_id}:${i.content_hash}`, i.id]));
      must(
        await this.db.from("episode_sources").upsert(
          withSource.map((s) => ({
            episode_id: ep.id,
            segment_id: segId.get(s.usedIn[0]!) ?? null,
            source_item_id: itemId.get(`${s.item.sourceId}:${s.item.hash}`),
          })),
          { onConflict: "episode_id,source_item_id" },
        ),
        "link sources",
      );
    }

    must(
      await this.db.from("cost_log").insert(
        r.cost.entries.map((e) => ({
          episode_id: ep.id, step: e.step, provider: e.provider, model: e.model,
          input_tokens: e.inputTokens, output_tokens: e.outputTokens, cache_read_tokens: e.cacheReadTokens,
          characters: e.characters, usd: e.usd,
        })),
      ),
      "cost log",
    );

    must(
      await this.db
        .from("episodes")
        .update({
          status: "ready", title: r.title, summary: r.summary, change_note: r.changeNote || null,
          audio_path: audioPath, actual_seconds: Math.round(r.durationSec), transcript: r.transcript,
          plan: { plan: r.plan, issues: r.issues, withinTarget: r.withinTarget, wordCount: r.wordCount },
          cost_usd: r.cost.totalUsd, published_at: new Date().toISOString(), error: null,
        })
        .eq("id", ep.id),
      "finish episode",
    );

    // The change note is shown once, on this episode.
    if (r.changeNote) {
      must(await this.db.from("preference_state").update({ last_change_note: "" }).eq("user_id", ep.user_id), "clear change note");
    }
  }

  // ---------- learning ----------

  /** Users who gave feedback after their preferences were last updated. */
  async usersWithNewFeedback(): Promise<string[]> {
    const prefs = must(await this.db.from("preference_state").select("user_id, updated_at"), "preference_state") as {
      user_id: string; updated_at: string;
    }[];
    const out: string[] = [];
    for (const p of prefs) {
      const r = await this.db.from("feedback").select("id", { count: "exact", head: true })
        .eq("user_id", p.user_id).gt("updated_at", p.updated_at);
      if ((r.count ?? 0) > 0) out.push(p.user_id);
    }
    return out;
  }

  async loadLearningInput(uid: string) {
    const [prefs, interests, sources, feedback] = await Promise.all([
      this.db.from("preference_state").select("*").eq("user_id", uid).single(),
      this.db.from("interests").select("id, label, learned_weight").eq("user_id", uid),
      this.db.from("user_sources").select("source_id, trust").eq("user_id", uid),
      this.db
        .from("feedback")
        .select(`updated_at, stars, quick_tags, note, episodes(title),
                 segment_feedback(thumb, go_deeper, episode_segments(id, title, topic_tags, episode_sources(source_items(source_id))))`)
        .eq("user_id", uid)
        .order("updated_at", { ascending: true })
        .limit(30),
    ]);
    const pr = must(prefs, "preferences") as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const lastUpdate = new Date(pr.updated_at).getTime();
    type Fb = {
      updated_at: string; stars: number | null; quick_tags: string[]; note: string | null; episodes: { title: string | null };
      segment_feedback: { thumb: -1 | 1 | null; go_deeper: boolean;
        episode_segments: { title: string; topic_tags: string[]; episode_sources: { source_items: { source_id: string } }[] } }[];
    };
    const all = (must(feedback, "feedback") as unknown as Fb[]).map((f) => ({
      isNew: new Date(f.updated_at).getTime() > lastUpdate,
      input: {
        episodeTitle: f.episodes?.title ?? "",
        stars: f.stars,
        quickTags: f.quick_tags,
        note: f.note,
        segments: f.segment_feedback.map((sf) => ({
          title: sf.episode_segments.title,
          topicTags: sf.episode_segments.topic_tags,
          thumb: sf.thumb,
          goDeeper: sf.go_deeper,
          sourceIds: sf.episode_segments.episode_sources.map((es) => es.source_items.source_id),
        })),
      } satisfies FeedbackInput,
    }));
    const preferences: PreferenceState = {
      depth: pr.depth, newsVsIdeas: pr.news_vs_ideas, workRelevance: pr.work_relevance,
      lengthBiasSeconds: pr.length_bias_seconds, plannerSummary: pr.planner_summary, lastChangeNote: pr.last_change_note,
    };
    return {
      preferences,
      interests: (must(interests, "interests") as { id: string; label: string; learned_weight: number }[]).map((i) => ({
        id: i.id, label: i.label, learnedWeight: i.learned_weight,
      })) as InterestRow[],
      sources: (must(sources, "user sources") as { source_id: string; trust: number }[]).map((s) => ({
        sourceId: s.source_id, trust: s.trust,
      })) as UserSourceRow[],
      newFeedback: all.filter((f) => f.isNew).map((f) => f.input),
      recentFeedback: all.map((f) => f.input),
    };
  }

  async saveLearning(uid: string, prefs: PreferenceState, interests: InterestRow[], sources: UserSourceRow[]): Promise<void> {
    for (const i of interests) {
      must(await this.db.from("interests").update({ learned_weight: i.learnedWeight }).eq("id", i.id).eq("user_id", uid), "interest");
    }
    for (const s of sources) {
      must(await this.db.from("user_sources").update({ trust: s.trust }).eq("user_id", uid).eq("source_id", s.sourceId), "source trust");
    }
    // Updating preference_state also moves its updated_at, which marks this feedback as processed.
    must(
      await this.db.from("preference_state").update({
        depth: prefs.depth, news_vs_ideas: prefs.newsVsIdeas, work_relevance: prefs.workRelevance,
        length_bias_seconds: prefs.lengthBiasSeconds, planner_summary: prefs.plannerSummary, last_change_note: prefs.lastChangeNote,
      }).eq("user_id", uid),
      "preferences",
    );
  }
}
