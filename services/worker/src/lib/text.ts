/** Small text helpers used across the pipeline. */
import { createHash } from "node:crypto";

export function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Source tags look like [S3] or [S3, S7]. They are for fact checking and are never spoken. */
const TAG_RE = /\s?\[S\d+(?:\s*,\s*S\d+)*\]/g;

export function stripSourceTags(text: string): string {
  return text.replace(TAG_RE, "").replace(/\s+([.,!?;:])/g, "$1").trim();
}

export function sourceTagsIn(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g)) {
    for (const id of m[1]!.split(",")) ids.add(id.trim());
  }
  return [...ids];
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
  "&rsquo;": "'", "&lsquo;": "'", "&rdquo;": '"', "&ldquo;": '"', "&mdash;": "—", "&ndash;": "–", "&hellip;": "…",
};

/** Turn feed HTML into plain text. Drops scripts, styles and tags; decodes common entities. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&[a-z]+;|&#39;/gi, (e) => ENTITIES[e.toLowerCase()] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
}

export function truncateWords(text: string, max: number): string {
  const words = text.split(/\s+/);
  return words.length <= max ? text : words.slice(0, max).join(" ") + " …";
}

export function contentHash(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
}

/** Lower-case words of 3+ letters, for simple keyword matching. */
export function keywords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w)));
}
const STOP = new Set(
  "the and for with that this from are was were have has had not but you your our their they them his her its into about over more most than then what when where which while who why how all any can will just also out new one two".split(" "),
);

/** Find quotes in the script ("…") that are longer than the allowed number of words. */
export function longQuotes(text: string, maxWords: number): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/["“]([^"”]+)["”]/g)) {
    if (wordCount(m[1]!) > maxWords) out.push(m[1]!);
  }
  return out;
}
