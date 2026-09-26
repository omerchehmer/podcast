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
  /** Podcast transcripts are long. Writing and fact checks use at most this many words of one. */
  maxTranscriptWords: 3000,
  /** Quotes must be short. */
  maxQuoteWords: 25,
  /** Cost target and hard stop per episode, in USD. */
  targetCostPer20MinUsd: 0.5,
  hardCostCapUsd: 1.5,
  /** Start generating this many minutes before the delivery time. */
  generationLeadMinutes: 60,
  /** Retries for a failed episode job. */
  maxJobAttempts: 3,
  /** Keep source text used for fact checks this many days, then delete it. */
  sourceExcerptRetentionDays: 30,
} as const;
