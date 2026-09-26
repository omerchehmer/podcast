import { describe, it, expect } from "vitest";
import { LIMITS } from "@briefcast/shared";
import type { CollectedItem } from "../src/pipeline/collect";
import { extractArticle, readFullText } from "../src/pipeline/fulltext";
import { isPublicHttpUrl, type PageFetcher } from "../src/lib/fetchPage";
import { wordCount } from "../src/lib/text";

const para = (n: number, word = "insight") => `<p>${Array.from({ length: n }, (_, i) => `${word}${i}`).join(" ")}.</p>`;

function item(over: Partial<CollectedItem> = {}): CollectedItem {
  return {
    id: "S1", sourceTitle: "Blog", sourceKind: "rss", trust: 1, title: "A title",
    url: "https://example.com/post", summary: "Short teaser.", excerpt: "Short teaser.", hash: "h", ...over,
  };
}

describe("extractArticle", () => {
  it("keeps the article paragraphs and drops menus, scripts and footers", () => {
    const html = `<html><body>
      <nav><p>Home About Contact Subscribe Login Search Menu Pricing Careers Blog</p></nav>
      <script>var tracking = "do not read this out loud in the episode please";</script>
      <article><h1>Title</h1>${para(40, "core")}${para(40, "more")}<p>Share</p></article>
      <footer><p>Copyright notice with enough words to look like a real paragraph here.</p></footer>
    </body></html>`;
    const text = extractArticle(html);
    expect(text).toContain("core0");
    expect(text).toContain("more39");
    expect(text).not.toMatch(/tracking|Subscribe|Copyright|Share/);
  });

  it("falls back to <main>, then to the whole body", () => {
    expect(extractArticle(`<body><main>${para(70, "m")}</main><p>outside words that should not be here at all</p></body>`)).not.toContain("outside");
    expect(extractArticle(`<body><div>${"plain ".repeat(80)}</div></body>`)).toContain("plain");
  });
});

describe("readFullText", () => {
  const pages = (map: Record<string, string | Error>): PageFetcher & { calls: string[] } => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      const v = map[url];
      if (v === undefined || v instanceof Error) throw v ?? new Error("404");
      return { contentType: "text/html", body: v };
    }) as PageFetcher & { calls: string[] };
    f.calls = calls;
    return f;
  };

  it("replaces a short feed teaser with the article text, capped in length", async () => {
    const fetch = pages({ "https://example.com/post": `<article>${para(600, "a")}${para(600, "b")}</article>` });
    const [out] = await readFullText([item()], fetch);
    expect(out!.excerpt).toContain("a0");
    expect(wordCount(out!.excerpt)).toBeLessThanOrEqual(LIMITS.fullTextMaxWords + 1);
    expect(out!.summary).toContain("a0"); // the one-line teaser is replaced too
  });

  it("keeps the feed text when the page is shorter (paywall) or the fetch fails", async () => {
    const long = item({ excerpt: "feed text ".repeat(40), url: "https://example.com/paywall" });
    const broken = item({ url: "https://example.com/broken" });
    const fetch = pages({ "https://example.com/paywall": "<p>Subscribe to read this article today.</p>", "https://example.com/broken": new Error("timeout") });
    const out = await readFullText([long, broken], fetch);
    expect(out[0]!.excerpt).toBe(long.excerpt);
    expect(out[1]!.excerpt).toBe(broken.excerpt);
  });

  it("does not fetch when the feed already has the full article", async () => {
    const fetch = pages({});
    await readFullText([item({ excerpt: "word ".repeat(LIMITS.fullTextBelowWords) })], fetch);
    expect(fetch.calls).toEqual([]);
  });

  it("never fetches pages for podcast episodes (they use transcripts instead)", async () => {
    const fetch = pages({ "https://pod.example/1": `<article>${para(500)}</article>` });
    const out = await readFullText([item({ sourceKind: "podcast", basis: "show_notes", url: "https://pod.example/1" })], fetch);
    expect(out[0]!.excerpt).toBe("Short teaser.");
    expect(fetch.calls).toEqual([]);
  });
});

describe("isPublicHttpUrl", () => {
  it("allows public web pages and blocks local or private addresses", () => {
    for (const ok of ["https://example.com/a", "http://news.site.org", "https://fcbarcelona.com", "https://8.8.8.8/x"]) expect(isPublicHttpUrl(ok)).toBe(true);
    for (const bad of [
      "file:///etc/passwd", "ftp://example.com", "http://localhost:3000", "http://127.0.0.1", "http://10.0.0.5",
      "http://192.168.1.1", "http://172.20.0.1", "http://169.254.169.254/latest", "http://[::1]/", "http://[fd00::1]/", "not a url",
    ]) expect(isPublicHttpUrl(bad)).toBe(false);
  });
});
