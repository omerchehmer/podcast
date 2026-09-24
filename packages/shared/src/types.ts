/**
 * Shared data types for the app and the worker.
 * zod schemas validate data at the edges (API input, files, LLM output).
 */
import { z } from "zod";

export const Frequency = z.enum(["weekdays", "daily", "custom"]);
export const EpisodeFormat = z.enum(["solo", "conversation"]);
export const EpisodeType = z.enum(["mix", "deep_dive"]);
export const Tone = z.enum(["direct", "calm"]);
export const InterestWeight = z.enum(["a_lot", "some", "a_little", "avoid"]);
export const SourceKind = z.enum(["podcast", "rss", "website", "newsletter_email", "youtube", "book"]);
export const QuickTag = z.enum([
  "too_long",
  "too_short",
  "too_basic",
  "too_technical",
  "too_much_news",
  "not_about_my_work",
]);

export type Frequency = z.infer<typeof Frequency>;
export type EpisodeFormat = z.infer<typeof EpisodeFormat>;
export type EpisodeType = z.infer<typeof EpisodeType>;
export type Tone = z.infer<typeof Tone>;
export type InterestWeight = z.infer<typeof InterestWeight>;
export type SourceKind = z.infer<typeof SourceKind>;
export type QuickTag = z.infer<typeof QuickTag>;

/** Numeric value of each weight, used in ranking. "avoid" removes items. */
export const WEIGHT_VALUE: Record<InterestWeight, number> = {
  a_lot: 1.0,
  some: 0.6,
  a_little: 0.3,
  avoid: 0,
};

export const PodcastSettings = z.object({
  frequency: Frequency.default("weekdays"),
  /** 1 = Monday … 7 = Sunday. Used when frequency is "custom". */
  customDays: z.array(z.number().int().min(1).max(7)).default([]),
  /** Local time "HH:MM". */
  deliveryTime: z.string().regex(/^\d{2}:\d{2}$/).default("07:30"),
  /** IANA time zone, for example "Asia/Jerusalem". */
  timeZone: z.string().default("UTC"),
  lengthMinutes: z.number().int().min(5).max(30).default(15),
  format: EpisodeFormat.default("solo"),
  voiceA: z.string().default("marin"),
  voiceB: z.string().default("cedar"),
  episodeType: EpisodeType.default("mix"),
  tone: Tone.default("direct"),
  language: z.string().default("en"),
});
export type PodcastSettings = z.infer<typeof PodcastSettings>;

export const Interest = z.object({
  label: z.string().min(1),
  weight: InterestWeight.default("some"),
  /** Changed by feedback. 1 = no change. */
  learnedWeight: z.number().min(0).max(2).default(1),
});
export type Interest = z.infer<typeof Interest>;

export const SourceRef = z.object({
  kind: SourceKind,
  title: z.string(),
  url: z.string().optional(),
  feedUrl: z.string().optional(),
  /** 0–1. User-added sources start at 1.0, system-added at 0.6. */
  trust: z.number().min(0).max(1).default(1),
});
export type SourceRef = z.infer<typeof SourceRef>;

/** What the learning loop has learned. The planner reads plannerSummary. */
export const PreferenceState = z.object({
  /** -1 = keep it basic, +1 = expert level. */
  depth: z.number().min(-1).max(1).default(0),
  /** -1 = more news, +1 = more ideas and analysis. */
  newsVsIdeas: z.number().min(-1).max(1).default(0.3),
  /** 0 = general, 1 = connect strongly to the listener's work. */
  workRelevance: z.number().min(0).max(1).default(0.7),
  /** Small correction to length, in seconds, from "too long / too short" feedback. */
  lengthBiasSeconds: z.number().int().default(0),
  plannerSummary: z.string().default(""),
  lastChangeNote: z.string().default(""),
});
export type PreferenceState = z.infer<typeof PreferenceState>;

/**
 * Everything the pipeline needs about one listener.
 * The CLI reads this from a JSON file; the worker builds it from the database.
 */
export const ListenerInput = z.object({
  userId: z.string().default("local-user"),
  displayName: z.string().default("there"),
  /** Plain-language profile from copy-paste, MCP or manual edit (already scrubbed). */
  context: z.string().default(""),
  interests: z.array(Interest).default([]),
  sources: z.array(SourceRef).default([]),
  books: z.array(z.string()).default([]),
  settings: PodcastSettings.prefault({}),
  preferences: PreferenceState.prefault({}),
  /** Topic tags of recent episodes, for the "do not repeat" rule. */
  recentTopics: z.array(z.object({ tag: z.string(), date: z.string() })).default([]),
  /** Set when the user tapped "Go deeper" on an idea. */
  deepDiveRequest: z
    .object({ title: z.string(), mainIdea: z.string(), sourceUrls: z.array(z.string()).default([]) })
    .optional(),
});
export type ListenerInput = z.infer<typeof ListenerInput>;
