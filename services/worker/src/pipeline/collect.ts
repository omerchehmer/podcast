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
  /** Cleaned text for writing and fact checks, max ~400 words. Never read out in full. */
  excerpt: string;
  hash: string;
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

async function loadFeed(feedUrl: string): Promise<string> {
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
