/** The real backend: Supabase (database with RLS, storage, Edge Functions). */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Api, Category, EpisodeDetail, EpisodeSummary, FeedbackInput, Interest, MySource, PodcastHit, Profile, Settings, SourceOption,
} from "./types";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

const toSummary = (e: Row): EpisodeSummary => ({
  id: e.id, status: e.status, title: e.title, summary: e.summary, changeNote: e.change_note,
  episodeType: e.episode_type, scheduledFor: e.scheduled_for, durationSec: e.actual_seconds, error: e.error,
});

export class SupabaseApi implements Api {
  readonly mode = "live" as const;
  private db: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.db = createClient(url, anonKey);
  }

  private async uid(): Promise<string> {
    const { data } = await this.db.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new Error("Not signed in");
    return id;
  }

  private async fn<T>(name: string, init: { method?: string; body?: unknown; query?: string } = {}): Promise<T> {
    const { data, error } = await this.db.functions.invoke(name + (init.query ?? ""), {
      method: (init.method ?? "POST") as "POST",
      body: init.body as Record<string, unknown> | undefined,
    });
    if (error) throw new Error(error.message);
    return data as T;
  }

  // ---------- account ----------

  async isSignedIn() {
    const { data } = await this.db.auth.getSession();
    return !!data.session;
  }

  async joinWithInvite(code: string) {
    // The demo uses anonymous accounts, unlocked with an invite code.
    if (!(await this.isSignedIn())) {
      const { error } = await this.db.auth.signInAnonymously();
      if (error) return "Could not sign in. Please try again.";
    }
    const { data, error } = await this.db.rpc("redeem_invite", { invite: code });
    if (error) return "Something went wrong. Please try again.";
    if (!data) return "This invite code is not valid, or it was already used.";
    return null;
  }

  async signOut() {
    await this.db.auth.signOut();
  }

  async deleteAccount() {
    await this.fn("delete-account");
    await this.db.auth.signOut();
  }

  // ---------- profile and settings ----------

  async getProfile(): Promise<Profile> {
    const p = must(await this.db.from("profiles").select("*").eq("user_id", await this.uid()).single()) as Row;
    return { displayName: p.display_name ?? "", timeZone: p.time_zone, onboardingDone: !!p.onboarding_done_at, hasAccess: p.access_override };
  }

  async saveProfile(p: Partial<Pick<Profile, "displayName" | "timeZone" | "onboardingDone">>) {
    const row: Row = {};
    if (p.displayName !== undefined) row.display_name = p.displayName;
    if (p.timeZone !== undefined) row.time_zone = p.timeZone;
    if (p.onboardingDone) row.onboarding_done_at = new Date().toISOString();
    must(await this.db.from("profiles").update(row).eq("user_id", await this.uid()));
  }

  async getSettings(): Promise<Settings> {
    const s = must(await this.db.from("podcast_settings").select("*").eq("user_id", await this.uid()).single()) as Row;
    return {
      frequency: s.frequency, customDays: s.custom_days, deliveryTime: String(s.delivery_time).slice(0, 5),
      lengthMinutes: s.length_minutes, format: s.format, voiceA: s.voice_a_id, voiceB: s.voice_b_id,
      episodeType: s.episode_type, tone: s.tone, language: s.episode_language,
    };
  }

  async saveSettings(s: Settings) {
    must(await this.db.from("podcast_settings").update({
      frequency: s.frequency, custom_days: s.customDays, delivery_time: s.deliveryTime, length_minutes: s.lengthMinutes,
      format: s.format, voice_a_id: s.voiceA, voice_b_id: s.voiceB, episode_type: s.episodeType, tone: s.tone,
      episode_language: s.language,
    }).eq("user_id", await this.uid()));
  }

  // ---------- interests ----------

  async getCategories(): Promise<Category[]> {
    return must(await this.db.from("topic_categories").select("id, name").order("sort")) as Category[];
  }

  async getInterests(): Promise<Interest[]> {
    const rows = must(await this.db.from("interests").select("*").eq("user_id", await this.uid()).order("created_at")) as Row[];
    return rows.map((r) => ({ label: r.label, weight: r.user_weight, categoryId: r.category_id, learnedWeight: r.learned_weight }));
  }

  /** Upsert by label, so learned weights are kept; delete the ones that were removed. */
  async saveInterests(list: Interest[]) {
    const uid = await this.uid();
    const current = await this.getInterests();
    const keep = new Set(list.map((i) => i.label));
    const removed = current.filter((c) => !keep.has(c.label)).map((c) => c.label);
    if (removed.length) must(await this.db.from("interests").delete().eq("user_id", uid).in("label", removed));
    if (list.length) {
      must(await this.db.from("interests").upsert(
        list.map((i) => ({ user_id: uid, label: i.label, user_weight: i.weight, category_id: i.categoryId ?? null })),
        { onConflict: "user_id,label" },
      ));
    }
  }

  // ---------- sources ----------

  async getDiscoverySources(): Promise<SourceOption[]> {
    let res = await this.db.from("sources")
      .select("id, kind, title, url, discovery_categories, why, evidence, discovery_trust")
      .eq("is_discovery", true).order("discovery_trust", { ascending: false });
    // Until migration 20260925000001 is applied, the reason columns do not exist yet.
    if (res.error) res = await this.db.from("sources").select("id, kind, title, url, discovery_categories").eq("is_discovery", true).order("title") as typeof res;
    const rows = must(res) as Row[];
    return rows.map((r) => ({
      id: r.id, kind: r.kind, title: r.title, url: r.url, categories: r.discovery_categories,
      why: r.why, evidence: r.evidence ?? [], quality: r.discovery_trust,
    }));
  }

  async getMySources(): Promise<MySource[]> {
    const uid = await this.uid();
    let res = await this.db.from("user_sources")
      .select("source_id, added_by, trust, sources(id, kind, title, url, discovery_categories, why, evidence)").eq("user_id", uid);
    if (res.error) res = await this.db.from("user_sources").select("source_id, added_by, trust, sources(id, kind, title, url, discovery_categories)").eq("user_id", uid) as typeof res;
    const rows = must(res) as Row[];
    return rows.map((r) => ({
      id: r.sources.id, kind: r.sources.kind, title: r.sources.title, url: r.sources.url, categories: r.sources.discovery_categories,
      why: r.sources.why, evidence: r.sources.evidence ?? [], addedBy: r.added_by, trust: r.trust,
    }));
  }

  async followSource(id: string) {
    must(await this.db.from("user_sources").upsert({ user_id: await this.uid(), source_id: id, added_by: "user" }, { onConflict: "user_id,source_id" }));
  }

  async addSource(s: { kind: MySource["kind"]; title: string; url?: string; feedUrl?: string }) {
    must(await this.db.rpc("add_source", { kind: s.kind, title: s.title, url: s.url ?? null, feed_url: s.feedUrl ?? null }));
  }

  async removeSource(id: string) {
    must(await this.db.from("user_sources").delete().eq("user_id", await this.uid()).eq("source_id", id));
  }

  async searchPodcasts(q: string): Promise<PodcastHit[]> {
    const r = await this.fn<{ results: PodcastHit[] }>("podcast-search", { method: "GET", query: `?q=${encodeURIComponent(q)}` });
    return r.results;
  }

  // ---------- personal context ----------

  async getContext() {
    return (await this.fn<{ text: string }>("context", { method: "GET" })).text;
  }

  async saveContext(text: string, origin: "paste" | "manual") {
    return this.fn<{ text: string; removed: string[] }>("context", { method: "PUT", body: { text, origin } });
  }

  async deleteContext() {
    await this.fn("context", { method: "DELETE" });
  }

  // ---------- episodes ----------

  async requestEpisodeNow() {
    const { data, error } = await this.db.rpc("request_episode_now");
    if (error) {
      if (/already being made/.test(error.message)) throw new Error("An episode is already being made. It will be ready soon.");
      if (/daily limit/.test(error.message)) throw new Error("You reached today's limit of 3 extra episodes.");
      if (/no access/.test(error.message)) throw new Error("You need an invite to get more episodes.");
      throw new Error("Could not start a new episode.");
    }
    // Wake the worker now instead of waiting for the hourly run. Not critical if it fails.
    this.fn("kick-worker").catch(() => undefined);
    return data as string;
  }

  async listEpisodes(): Promise<EpisodeSummary[]> {
    const rows = must(await this.db.from("episodes").select("*").order("scheduled_for", { ascending: false }).limit(100)) as Row[];
    return rows.map(toSummary);
  }

  async getEpisode(id: string): Promise<EpisodeDetail> {
    const e = must(await this.db.from("episodes")
      .select("*, episode_segments(*), episode_sources(segment_id, source_items(title, url, sources(title)))")
      .eq("id", id).single()) as Row;
    let audioUrl: string | null = null;
    if (e.audio_path) {
      const { data } = await this.db.storage.from("episodes").createSignedUrl(e.audio_path, 6 * 3600);
      audioUrl = data?.signedUrl ?? null;
    }
    return {
      ...toSummary(e),
      segments: (e.episode_segments as Row[]).sort((a, b) => a.idx - b.idx).map((s) => ({
        id: s.id, idx: s.idx, kind: s.kind, title: s.title, mainIdea: s.main_idea, question: s.question, startSec: s.start_sec, endSec: s.end_sec,
      })),
      sources: (e.episode_sources as Row[]).map((s) => ({
        title: s.source_items.title, url: s.source_items.url, source: s.source_items.sources?.title ?? "", segmentId: s.segment_id,
      })),
      transcript: e.transcript ?? [],
      audioUrl,
    };
  }

  // ---------- feedback ----------

  async getFeedback(episodeId: string): Promise<FeedbackInput | null> {
    const f = must(await this.db.from("feedback").select("*, segment_feedback(*)").eq("episode_id", episodeId).maybeSingle()) as Row | null;
    if (!f) return null;
    return {
      stars: f.stars, quickTags: f.quick_tags, note: f.note ?? "",
      segments: (f.segment_feedback as Row[]).map((s) => ({ segmentId: s.segment_id, thumb: s.thumb, goDeeper: s.go_deeper })),
    };
  }

  async saveFeedback(episodeId: string, f: FeedbackInput) {
    const uid = await this.uid();
    const row = must(await this.db.from("feedback").upsert(
      { episode_id: episodeId, user_id: uid, stars: f.stars, quick_tags: f.quickTags, note: f.note || null },
      { onConflict: "episode_id,user_id" },
    ).select("id").single()) as Row;
    const segs = f.segments.filter((s) => s.thumb !== null || s.goDeeper);
    must(await this.db.from("segment_feedback").delete().eq("feedback_id", row.id));
    if (segs.length) {
      must(await this.db.from("segment_feedback").insert(
        segs.map((s) => ({ feedback_id: row.id, segment_id: s.segmentId, thumb: s.thumb, go_deeper: s.goDeeper })),
      ));
    }
  }

  async logListen(episodeId: string, event: Parameters<Api["logListen"]>[1], positionSec: number) {
    await this.db.from("listen_events").insert({ user_id: await this.uid(), episode_id: episodeId, event, position_sec: positionSec });
  }

  async report(episodeId: string, reason: "wrong_fact" | "harmful" | "other", note: string) {
    must(await this.db.from("episode_reports").insert({ episode_id: episodeId, user_id: await this.uid(), reason, note }));
  }
}
