/**
 * Everything the screens need from the backend. Two implementations:
 * - supabaseApi.ts: the real backend
 * - mockApi.ts: sample data in memory (preview mode, no backend needed)
 */
import type { EpisodeFormat, EpisodeType, Frequency, InterestWeight, QuickTag, SourceKind, Tone } from "@briefcast/shared";

export interface Profile {
  displayName: string;
  timeZone: string;
  onboardingDone: boolean;
  hasAccess: boolean;
}

export interface Settings {
  frequency: Frequency;
  customDays: number[];
  deliveryTime: string; // "07:30"
  lengthMinutes: number;
  format: EpisodeFormat;
  voiceA: string;
  voiceB: string;
  episodeType: EpisodeType;
  tone: Tone;
  language: string;
}

export interface Interest {
  label: string;
  weight: InterestWeight;
  categoryId?: string | null;
  /** Learned from feedback. >1 means "more", <1 means "less". Read-only. */
  learnedWeight?: number;
}

export interface Category { id: string; name: string }

export interface SourceOption {
  id: string;
  kind: SourceKind;
  title: string;
  url?: string | null;
  categories: string[];
}

export interface MySource extends SourceOption {
  addedBy: "user" | "system";
  trust: number;
}

export interface PodcastHit { title: string; author: string; feedUrl: string; image?: string }

export type EpisodeStatus = "queued" | "collecting" | "ranking" | "planning" | "writing" | "checking" | "voicing" | "ready" | "failed";

export interface EpisodeSummary {
  id: string;
  status: EpisodeStatus;
  title: string | null;
  summary: string | null;
  changeNote: string | null;
  episodeType: EpisodeType;
  scheduledFor: string;
  durationSec: number | null;
  error: string | null;
}

export interface Segment {
  id: string;
  idx: number;
  kind: "intro" | "idea" | "recap" | "questions";
  title: string;
  mainIdea: string | null;
  question: string | null;
  startSec: number | null;
  endSec: number | null;
}

export interface EpisodeSourceLink { title: string; source: string; url: string | null; segmentId: string | null }

export interface TranscriptLine { speaker: "HOST_A" | "HOST_B"; text: string; startSec: number; endSec: number }

export interface EpisodeDetail extends EpisodeSummary {
  segments: Segment[];
  sources: EpisodeSourceLink[];
  transcript: TranscriptLine[];
  audioUrl: string | null;
}

export interface FeedbackInput {
  stars: number | null;
  quickTags: QuickTag[];
  note: string;
  segments: { segmentId: string; thumb: -1 | 1 | null; goDeeper: boolean }[];
}

export type ListenEvent = "start" | "progress" | "complete" | "chapter_jump" | "speed_change";

export interface Api {
  readonly mode: "live" | "preview";

  isSignedIn(): Promise<boolean>;
  /** Signs in with an invite code. Returns an error message, or null when it worked. */
  joinWithInvite(code: string): Promise<string | null>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;

  getProfile(): Promise<Profile>;
  saveProfile(p: Partial<Pick<Profile, "displayName" | "timeZone" | "onboardingDone">>): Promise<void>;

  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;

  getCategories(): Promise<Category[]>;
  getInterests(): Promise<Interest[]>;
  saveInterests(list: Interest[]): Promise<void>;

  getDiscoverySources(): Promise<SourceOption[]>;
  getMySources(): Promise<MySource[]>;
  followSource(id: string): Promise<void>;
  addSource(s: { kind: SourceKind; title: string; url?: string; feedUrl?: string }): Promise<void>;
  removeSource(id: string): Promise<void>;
  searchPodcasts(q: string): Promise<PodcastHit[]>;

  getContext(): Promise<string>;
  /** Returns the saved text (sensitive data removed) and what was removed. */
  saveContext(text: string, origin: "paste" | "manual"): Promise<{ text: string; removed: string[] }>;
  deleteContext(): Promise<void>;

  requestEpisodeNow(): Promise<string>;
  listEpisodes(): Promise<EpisodeSummary[]>;
  getEpisode(id: string): Promise<EpisodeDetail>;

  getFeedback(episodeId: string): Promise<FeedbackInput | null>;
  saveFeedback(episodeId: string, f: FeedbackInput): Promise<void>;
  logListen(episodeId: string, event: ListenEvent, positionSec: number): Promise<void>;
  report(episodeId: string, reason: "wrong_fact" | "harmful" | "other", note: string): Promise<void>;
}
