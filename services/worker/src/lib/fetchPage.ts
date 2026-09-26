/**
 * Fetch one web page or transcript file, with safety limits.
 * The URLs come from third-party feeds, so we only allow public http(s) hosts, cap the size and time,
 * and accept text types only.
 */
import { LIMITS } from "@briefcast/shared";

export interface FetchedPage {
  contentType: string;
  body: string;
}

export type PageFetcher = (url: string) => Promise<FetchedPage>;

const USER_AGENT = "BriefcastBot/0.1 (+https://briefcast.app/bot)";
const TEXT_TYPES = /^(text\/|application\/(xhtml\+xml|json|x-subrip|srt))/;

/** Blocks local and private network addresses written in the URL (not a full DNS check). */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (h.includes(":")) {
    // IPv6 literal: block loopback, unspecified, private (fc/fd), link-local (fe80) and IPv4-mapped.
    return !(h === "::1" || h === "::" || /^(fc|fd|fe80|::ffff:)/.test(h));
  }
  const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

/** Read the body, but stop at maxBytes so a huge page cannot fill memory. */
async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

export const httpFetchPage: PageFetcher = async (url) => {
  if (!isPublicHttpUrl(url)) throw new Error("URL not allowed");
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html, text/plain, text/vtt, application/json;q=0.9, */*;q=0.1" },
    redirect: "follow",
    signal: AbortSignal.timeout(LIMITS.pageFetchTimeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!isPublicHttpUrl(res.url || url)) throw new Error("Redirect not allowed");
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (contentType && !TEXT_TYPES.test(contentType)) throw new Error(`Not text: ${contentType}`);
  return { contentType, body: await readLimited(res, LIMITS.pageMaxBytes) };
};
