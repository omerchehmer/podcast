/**
 * Step 2b — Full text: after ranking, read the whole article for each picked item.
 * Many feeds give only a title and one or two lines. For those items we open the article page and
 * keep the main text, so the planner and writer have real content and the checker has something to
 * check facts against. Only the 8–15 picked items are fetched, never the whole feed.
 * Podcasts are not touched here: their transcripts are handled in transcript.ts.
 */
import { LIMITS } from "@briefcast/shared";
import { htmlToText, truncateWords, wordCount } from "../lib/text";
import { log } from "../lib/log";
import type { PageFetcher } from "../lib/fetchPage";
import type { CollectedItem } from "./collect";

/** Parts of a page that are never the article. */
const NOISE = /<(script|style|noscript|template|svg|nav|header|footer|aside|form|button|iframe)\b[\s\S]*?<\/\1>/gi;

/** The biggest block for a tag, for example the longest <article>…</article>. */
function largestBlock(html: string, tag: string): string | undefined {
  let best: string | undefined;
  for (const m of html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))) {
    if (!best || m[1]!.length > best.length) best = m[1];
  }
  return best;
}

/** Get the main text of an article page: <article>, else <main>, else <body>; paragraphs only. */
export function extractArticle(html: string): string {
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ").replace(NOISE, " ");
  const region = largestBlock(clean, "article") ?? largestBlock(clean, "main") ?? largestBlock(clean, "body") ?? clean;
  const paragraphs = [...region.matchAll(/<(p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => htmlToText(m[2]!).replace(/\s+/g, " ").trim())
    // Short lines are menus, captions and buttons.
    .filter((t) => wordCount(t) >= 8);
  const text = paragraphs.join("\n");
  return wordCount(text) >= 60 ? text : htmlToText(region);
}

async function readPage(item: CollectedItem, fetchPage: PageFetcher): Promise<string | null> {
  // Only articles and posts. Podcast episodes ("show_notes", "transcript") have their own path.
  if ((item.basis ?? "text") !== "text" || !item.url || wordCount(item.excerpt) >= LIMITS.fullTextBelowWords) return null;
  try {
    const page = await fetchPage(item.url);
    return page.contentType === "text/plain" ? page.body : extractArticle(page.body);
  } catch (e) {
    log.warn("page fetch failed", { source: item.sourceTitle, error: String(e) });
    return null;
  }
}

/** Replace short feed text with the article text, when the full text is longer. Keeps the item order. */
export async function readFullText<T extends CollectedItem>(items: T[], fetchPage: PageFetcher): Promise<T[]> {
  const out = [...items];
  let next = 0;
  let upgraded = 0;
  const worker = async () => {
    while (next < out.length) {
      const i = next++;
      const item = out[i]!;
      const text = await readPage(item, fetchPage);
      // Paywalls and cookie walls give short junk pages: keep the feed text unless we got more.
      if (!text || wordCount(text) <= wordCount(item.excerpt)) continue;
      upgraded++;
      out[i] = {
        ...item,
        excerpt: truncateWords(text, LIMITS.fullTextMaxWords),
        summary: wordCount(item.summary) < 25 ? truncateWords(text, 60) : item.summary,
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(LIMITS.pageFetchConcurrency, out.length) }, worker));
  log.info("full text", { items: out.length, upgraded });
  return out;
}
