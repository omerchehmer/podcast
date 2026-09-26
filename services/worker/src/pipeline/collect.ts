/**
 * Step 1 — Collect: read new items from the listener's feeds.
 * Supports RSS 2.0, RSS 1.0 (RDF) and Atom. A feed URL can also be a local file (file://…) for tests.
 */
import { XMLParser } from "fast-xml-parser";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { SourceRef } from "@briefcast/shared";
import { contentHash, htmlToText, truncateWords } from "../lib/text";
import { log } from "../lib/log";
import { pickTranscript, type TranscriptLink } from "./transcript";

/**
 * What the item text really is. The writer must be honest about it:
 * - "text": the article or post itself
 * - "show_notes": only the description a podcast wrote for an episode (nobody listened to it)
 * - "transcript": the words spoken in the episode
 */
export type ItemBasis = "text" | "show_notes" | "transcript";

export interface CollectedItem {
  /** Short id used in prompts and source tags, for example "S3". Set by the ranker. */
  id: string;
  /** Database id of the source, when known. */
  sourceId?: string;
  sourceTitle: string;
  sourceKind: SourceRef["kind"];
  trust: number;
  title: string;
  url?: string;
  publishedAt?: string;
  /** Short summary, max ~60 words. */
  summary: string;
  /** Cleaned text for writing and fact checks, max ~400 words (longer for transcripts). Never read out in full. */
  excerpt: string;
  hash: string;
  /** What the excerpt is. Missing on older items = "text". */
  basis?: ItemBasis;
  /** Transcript link from the feed, for podcast episodes that have one. */
  transcript?: TranscriptLink;
  /** true when the excerpt holds only the first part of a long transcript. */
  transcriptPartial?: boolean;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  cdataPropName: false,
  processEntities: true,
});

const USER_AGENT = "BriefcastBot/0.1 (+https://briefcast.app/bot)";

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** Get plain text from a parsed XML node, which may be a string or {#text}. */
function txt(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"]);
  return "";
}

function atomLink(v: unknown): string | undefined {
  for (const l of asArray(v as Record<string, string> | Record<string, string>[])) {
    if (typeof l === "string") return l;
    if (!l["@rel"] || l["@rel"] === "alternate") return l["@href"];
  }
  return undefined;
}

export interface RawItem {
  title: string;
  url?: string;
  publishedAt?: string;
  html: string;
  /** true when the item has an audio file (a podcast episode), even in a feed added as plain RSS. */
  audio?: boolean;
  /** Link to the episode's audio file, for speech-to-text. */
  audioUrl?: string;
  /** Length from <itunes:duration>, when the feed gives it. */
  durationMin?: number;
  transcript?: TranscriptLink;
}

function transcriptLinks(v: unknown): TranscriptLink[] {
  return asArray(v as Record<string, string> | Record<string, string>[])
    .filter((t) => t && typeof t === "object" && t["@url"])
    .map((t) => ({ url: t["@url"]!, type: t["@type"] ?? "" }));
}

/** "3600", "60:00" or "1:00:00" → minutes. */
export function durationMinutes(v: string): number | undefined {
  const s = v.trim();
  if (!s) return undefined;
  const parts = s.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  const sec = parts.reduce((a, n) => a * 60 + n, 0);
  return sec > 0 ? sec / 60 : undefined;
}

function audioUrl(v: unknown): string | undefined {
  const e = asArray(v as Record<string, string> | Record<string, string>[]).find(
    (e) => e && typeof e === "object" && e["@url"] && (/^(audio|video)\//i.test(e["@type"] ?? "") || /\.(mp3|m4a|aac|ogg|opus|wav)(\?|$)/i.test(e["@url"])),
  );
  return e?.["@url"];
}

export function parseFeed(xml: string): RawItem[] {
  const doc = parser.parse(xml);
  const rssItems = asArray(doc?.rss?.channel?.item);
  const rdfItems = asArray(doc?.["rdf:RDF"]?.item);
  const atomEntries = asArray(doc?.feed?.entry);

  const out: RawItem[] = [];
  for (const it of [...rssItems, ...rdfItems]) {
    out.push({
      title: txt(it.title),
      url: txt(it.link) || txt(it.guid) || undefined,
      publishedAt: txt(it.pubDate) || txt(it["dc:date"]) || undefined,
      html: txt(it["content:encoded"]) || txt(it.description) || txt(it["itunes:summary"]),
      audio: !!audioUrl(it.enclosure),
      audioUrl: audioUrl(it.enclosure),
      durationMin: durationMinutes(txt(it["itunes:duration"])),
      transcript: pickTranscript(transcriptLinks(it["podcast:transcript"])),
    });
  }
  for (const e of atomEntries) {
    out.push({
      title: txt(e.title),
      url: atomLink(e.link),
      publishedAt: txt(e.published) || txt(e.updated) || undefined,
      html: txt(e.content) || txt(e.summary),
    });
  }
  return out.filter((i) => i.title);
}

export async function loadFeed(feedUrl: string): Promise<string> {
  if (feedUrl.startsWith("file://")) return readFile(fileURLToPath(feedUrl), "utf8");
  const res = await fetch(feedUrl, {
    headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function toCollected(raw: RawItem, source: SourceRef): CollectedItem {
  const text = htmlToText(raw.html);
  const published = raw.publishedAt ? new Date(raw.publishedAt) : undefined;
  return {
    id: "",
    sourceId: source.id,
    sourceTitle: source.title,
    sourceKind: source.kind,
    trust: source.trust,
    title: htmlToText(raw.title),
    url: raw.url,
    publishedAt: published && !isNaN(published.getTime()) ? published.toISOString() : undefined,
    summary: truncateWords(text, 60),
    excerpt: truncateWords(text, 400),
    hash: contentHash(raw.url ?? "", raw.title),
    basis: source.kind === "podcast" || raw.audio ? "show_notes" : "text",
    transcript: raw.transcript,
  };
}

/** How an item is shown to the writer and the checker. "basis" tells them what the text really is. */
export function itemForLlm(i: CollectedItem, field: "summary" | "excerpt") {
  // The short summary always comes from the feed, so for a podcast it is show notes, even when we have a transcript.
  const basis = field === "summary" && i.basis === "transcript" ? "show_notes" : (i.basis ?? "text");
  return {
    id: i.id,
    source: i.sourceTitle,
    title: i.title,
    basis,
    ...(basis === "transcript" && i.transcriptPartial ? { partial: true } : {}),
    text: i[field],
  };
}

export interface CollectOptions {
  now: Date;
  lookbackDays: number;
  /** Items without a date are kept (some feeds have none) unless this is false. */
  keepUndated?: boolean;
}

/** Fetch all feeds in parallel. A broken feed is logged and skipped; it never stops the episode. */
export async function collect(sources: SourceRef[], opts: CollectOptions): Promise<CollectedItem[]> {
  const since = opts.now.getTime() - opts.lookbackDays * 24 * 3600 * 1000;
  const feeds = sources.filter((s) => s.feedUrl);
  const results = await Promise.allSettled(
    feeds.map(async (s) => parseFeed(await loadFeed(s.feedUrl!)).map((r) => toCollected(r, s))),
  );
  const items: CollectedItem[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else log.warn("feed failed", { source: feeds[i]!.title, error: String(r.reason) });
  });
  return items.filter((it) => {
    if (!it.publishedAt) return opts.keepUndated !== false;
    const t = new Date(it.publishedAt).getTime();
    return t >= since && t <= opts.now.getTime() + 3600_000;
  });
}
