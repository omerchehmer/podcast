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

/** Offset of a time zone from UTC at a given moment, in ms. */
function tzOffsetMs(at: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(new Date(at)).map((x) => [x.type, x.value]),
  );
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(at / 1000) * 1000;
}

/**
 * When the next scheduled episode is due, following the same rules as the server
 * (weekdays = Mon–Fri, in the listener's time zone). Null when no day is chosen.
 */
export function nextEpisodeAt(
  s: { frequency: "weekdays" | "daily" | "custom"; customDays: number[]; deliveryTime: string },
  timeZone: string,
  now = new Date(),
): Date | null {
  const [hh, mm] = s.deliveryTime.split(":").map(Number);
  for (let d = 0; d <= 7; d++) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
        .formatToParts(new Date(now.getTime() + d * 86_400_000)).map((x) => [x.type, x.value]),
    );
    const isoDow = DAYS.indexOf(p.weekday ?? "") + 1;
    const ok = s.frequency === "daily" || (s.frequency === "weekdays" ? isoDow <= 5 : s.customDays.includes(isoDow));
    if (!ok) continue;
    const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hh, mm);
    let at = wall - tzOffsetMs(wall, timeZone);
    at = wall - tzOffsetMs(at, timeZone); // second pass for days when the clock changes
    if (at > now.getTime()) return new Date(at);
  }
  return null;
}

/** "today at 07:30", "tomorrow at 07:30" or "Monday 28 September at 07:30", in the listener's time zone. */
export function nextEpisodeLabel(at: Date, timeZone: string, now = new Date()): string {
  const day = (t: Date) => t.toLocaleDateString("en-CA", { timeZone });
  const time = at.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
  if (day(at) === day(now)) return `today at ${time}`;
  if (day(at) === day(new Date(now.getTime() + 86_400_000))) return `tomorrow at ${time}`;
  return `${at.toLocaleDateString("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long" })} at ${time}`;
}
