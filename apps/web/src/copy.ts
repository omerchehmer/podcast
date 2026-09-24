/** Texts used in several screens. Simple English on purpose. */
import { APP } from "@briefcast/shared";

export const PROFILE_PROMPT = `Please write a short profile of me for a personal podcast app called ${APP.name}. The app uses it to make a daily audio episode that connects ideas to my real situation.

Include:
- My role, my company and its industry (in general words)
- My current goals and my biggest challenges
- The topics I care about most, and topics I do not care about
- How I like to learn (for example: practical examples, big ideas, data, stories)
- My level in my main topics (beginner, experienced, expert)

Write it in simple English, in the first person ("I am…"), in about 150–250 words.
Do NOT include passwords, financial account details, health information, family names, ID numbers, or other sensitive personal data.`;

export const STEP_LABELS: Record<string, string> = {
  queued: "Waiting to start",
  collecting: "Reading your sources",
  ranking: "Choosing the best ideas for you",
  planning: "Planning the episode",
  writing: "Writing the script",
  checking: "Checking facts against the sources",
  voicing: "Recording the voice",
  ready: "Ready",
};

export const QUICK_TAGS = [
  ["too_long", "Too long"],
  ["too_short", "Too short"],
  ["too_basic", "Too basic"],
  ["too_technical", "Too technical"],
  ["too_much_news", "Too much news"],
  ["not_about_my_work", "Not enough about my work"],
] as const;

export const LANGUAGES = [
  ["en", "English"], ["he", "Hebrew"], ["es", "Spanish"], ["pt", "Portuguese"], ["fr", "French"], ["de", "German"],
  ["it", "Italian"], ["ru", "Russian"], ["ar", "Arabic"], ["th", "Thai"], ["id", "Indonesian"], ["ja", "Japanese"],
] as const;

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function friendlyDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
