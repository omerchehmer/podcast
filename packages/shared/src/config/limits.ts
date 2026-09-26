/** Numbers that control episode length, cost and scheduling. */
export const LIMITS = {
  /** Allowed episode lengths in minutes (the "20–25" option is stored as 20 with +5 flex). */
  lengthOptions: [5, 10, 15, 20, 25, 30] as const,
  /** Target spoken words per minute, before we have a measured value for a voice. */
  defaultWordsPerMinute: 160,
  /** The final audio must be within ±10% of the target length. */
  lengthTolerance: 0.1,
  /** How far back to look for new items: daily users 1–2 days, weekly users up to 7. */
  lookbackDaysDaily: 2,
  lookbackDaysWeekly: 7,
  /** Do not repeat a topic covered in the last N days, unless the user asked for a deep dive. */
  noRepeatDays: 14,
  /** How many ranked items go into the planner. */
  maxItemsForPlanner: 15,
  /** Transcripts longer than this are turned into episode notes first (a whole episode, in about 800 words). */
  digestAboveWords: 2500,
  /** Longest part of one episode we read. Longer transcripts are marked "partial". About 4 hours of talk. */
  maxTranscriptWords: 40000,
  /** Speech-to-text: longest part of one episode we transcribe, and total minutes per listener episode. */
  maxAudioMinutesPerItem: 180,
  maxAudioMinutesPerEpisode: 300,
  /** Quotes must be short. */
  maxQuoteWords: 25,
  /** Cost target and hard stop per episode, in USD. */
  targetCostPer20MinUsd: 0.5,
  hardCostCapUsd: 1.5,
  /** Start generating this many minutes before the delivery time. */
  generationLeadMinutes: 60,
  /** Retries for a failed episode job. */
  maxJobAttempts: 3,
  /** Users with fewer active feeds than this get matching discovery sources added before an episode. */
  discoveryFillUpTo: 6,
  /** Starting trust for sources we add (user-added sources start at 1.0). */
  systemSourceTrust: 0.6,
  /** Keep source text used for fact checks this many days, then delete it. */
  sourceExcerptRetentionDays: 30,
} as const;
